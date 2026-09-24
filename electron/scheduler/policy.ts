/**
 * 定时任务写操作策略：保存时校验与运行时匹配（纯函数）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tokenizeCommand, validateAllowedCommandEntry, isAbsolutePathArg } from '../agent/tools/shell';
import { canonicalCwd, isWithinDir } from '../fs/path-security';
import type { ScheduledTaskPolicy } from '../../shared/ipc';

const ALLOWED_POLICY_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

export function normalizeScheduledPolicy(policy: ScheduledTaskPolicy | undefined): ScheduledTaskPolicy | undefined {
  if (!policy) return undefined;
  const allowedTools = [...new Set(policy.allowedTools)].filter((tool) => ALLOWED_POLICY_TOOLS.has(tool));
  const fileScopes = policy.fileScopes.map((scope) => scope.trim()).filter(Boolean);
  const allowedCommands = policy.allowedCommands.map((entry) => entry.trim()).filter(Boolean);
  if (allowedTools.length === 0 && fileScopes.length === 0 && allowedCommands.length === 0) return undefined;
  return { allowedTools, fileScopes, allowedCommands };
}

/** 保存时校验；返回 null 表示合法 */
export function validateTaskPolicy(policy: ScheduledTaskPolicy | undefined): string | null {
  const normalized = normalizeScheduledPolicy(policy);
  if (!normalized) return null;
  const tools = new Set(normalized.allowedTools);

  if ((tools.has('write_file') || tools.has('edit_file')) && normalized.fileScopes.length === 0) {
    return '选择写入/编辑文件后必须声明可写范围';
  }
  if (tools.has('run_command') && normalized.allowedCommands.length === 0) {
    return '选择运行命令后必须声明命令白名单';
  }
  for (const scope of normalized.fileScopes) {
    if (isAbsolutePathArg(scope) || scope.split(/[\\/]/).includes('..')) {
      return `可写范围必须是工作目录内的相对路径：${scope}`;
    }
  }
  for (const entry of normalized.allowedCommands) {
    const error = validateAllowedCommandEntry(entry);
    if (error) return `命令白名单项「${entry}」不合法：${error}`;
  }
  return null;
}

/**
 * 命令是否命中白名单。
 *
 * S5：entry 必须是 command 的 token 前缀，且前缀之后只允许旗标
 * （以 `-` 开头）或 `--` 之后的参数。避免 `npm run` 前缀匹配
 * `npm run evil`、`make` 匹配任意 target 等过宽放行。
 */
export function matchesCommandAllowlist(command: string, allowlist: readonly string[]): boolean {
  const commandTokens = tokenizeCommand(command);
  if (commandTokens.length === 0) return false;
  for (const entry of allowlist) {
    const entryTokens = tokenizeCommand(entry);
    if (entryTokens.length === 0 || entryTokens.length > commandTokens.length) continue;
    let match = true;
    for (let i = 0; i < entryTokens.length; i++) {
      if (entryTokens[i] !== commandTokens[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    if (remainingArgsAreFlagsOnly(commandTokens, entryTokens.length)) return true;
  }
  return false;
}

/** entry 前缀之后的 token 是否仅为旗标（或位于 `--` 之后） */
function remainingArgsAreFlagsOnly(commandTokens: readonly string[], fromIndex: number): boolean {
  let afterDoubleDash = false;
  for (let i = fromIndex; i < commandTokens.length; i++) {
    const tok = commandTokens[i]!;
    if (afterDoubleDash) continue;
    if (tok === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!tok.startsWith('-')) return false;
  }
  return true;
}

export interface ScheduledPolicyRuntime {
  allowedToolNames: ReadonlySet<string>;
  shouldApprove: (toolName: string) => boolean;
  /** 异步护栏：文件范围校验需要 realpath（符号链接 / 父目录解析） */
  toolGuard: (name: string, args: Record<string, unknown>) => Promise<string | null>;
}

/** 调度运行中显式拒绝的工具（与策略无关）：MCP、浏览器、子代理分派 */
export function isScheduledDeniedTool(name: string): boolean {
  return name.startsWith('mcp__') || name.startsWith('browser_') || name === 'dispatch_subagents';
}

const GLOB_MAGIC = /[*?]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** 极简 glob → RegExp：`**` 跨段、`*` 段内、`?` 单字符 */
export function globToRegExp(glob: string): RegExp {
  const parts = glob.split('/');
  let out = '^';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const last = i === parts.length - 1;
    if (part === '**') {
      out += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    out += escapeRegExp(part).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    if (!last) out += '/';
  }
  return new RegExp(out + '$');
}

/** scope 是否匹配相对路径（无通配符的 scope 按目录前缀匹配） */
export function matchesScope(relativePath: string, scope: string): boolean {
  const normalizedScope = scope.replaceAll('\\', '/').replace(/\/+$/, '');
  const normalizedPath = relativePath.replaceAll('\\', '/');
  if (!GLOB_MAGIC.test(normalizedScope)) {
    return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
  }
  return globToRegExp(normalizedScope).test(normalizedPath);
}

/** scope 的静态目录前缀（用于 cwd 校验）：截到第一个含通配符的段之前 */
function scopeDirectory(scope: string): string {
  const parts = scope.replaceAll('\\', '/').replace(/\/+$/, '').split('/');
  const staticParts: string[] = [];
  for (const part of parts) {
    if (GLOB_MAGIC.test(part)) break;
    staticParts.push(part);
  }
  return staticParts.join('/');
}

/** 目标的真实路径：存在则 realpath；不存在则取最近存在祖先的 realpath 拼接缺失段 */
async function resolveRealTarget(absPath: string): Promise<string | null> {
  const missing: string[] = [];
  let current = absPath;
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = await fs.realpath(current);
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.push(path.basename(current));
      current = parent;
    }
  }
  return null;
}

/**
 * 校验写入路径是否落于任务声明的范围。
 * 与文件工具使用同一路径解析（不 trim）；对真实路径（穿透符号链接）做范围匹配。
 */
export async function checkScheduledFilePath(
  rawPath: string,
  cwd: string,
  fileScopes: readonly string[],
): Promise<string | null> {
  if (fileScopes.length === 0) return '任务未声明可写范围（已拒绝）';
  if (!rawPath) return '缺少 path（已拒绝）';
  const resolved = path.resolve(cwd, rawPath);
  const realTarget = await resolveRealTarget(resolved);
  if (!realTarget) return `无法解析路径（已拒绝）：${rawPath}`;
  const realCwd = await canonicalCwd(cwd);
  if (!isWithinDir(realTarget, realCwd)) return `路径超出工作目录（已拒绝）：${rawPath}`;
  const relative = path.relative(realCwd, realTarget);
  if (!fileScopes.some((scope) => matchesScope(relative, scope))) {
    return `路径 ${rawPath} 超出任务声明的可写范围（已拒绝）`;
  }
  return null;
}

/**
 * 校验 run_command 的 cwd 是否落于声明范围。
 * S6：未提供 cwd 时按工作目录根 `.` 处理——若声明了 fileScopes，
 * 根目录通常不在范围内，必须拒绝，避免脚本在根上写穿范围。
 */
export async function checkScheduledCommandCwd(
  rawCwd: string | undefined,
  cwd: string,
  fileScopes: readonly string[],
): Promise<string | null> {
  if (fileScopes.length === 0) return null;
  const effective = rawCwd === undefined || rawCwd === '' ? '.' : rawCwd;
  const resolved = path.resolve(cwd, effective);
  const realTarget = await resolveRealTarget(resolved);
  if (!realTarget) return `无法解析命令 cwd（已拒绝）：${effective}`;
  const realCwd = await canonicalCwd(cwd);
  if (!isWithinDir(realTarget, realCwd) && realTarget !== realCwd) {
    return `命令 cwd ${effective} 超出工作目录（已拒绝）`;
  }
  const relative = path.relative(realCwd, realTarget);
  const allowed = fileScopes.some((scope) => {
    const dir = scopeDirectory(scope);
    // 无静态前缀的 glob（如 `**`）覆盖整个工作区
    if (!dir) return true;
    return relative === dir || relative.startsWith(`${dir}/`) || (relative === '' && (dir === '' || dir === '.'));
  });
  if (!allowed) {
    return rawCwd === undefined || rawCwd === ''
      ? '命令未指定 cwd 且默认工作目录根不在任务可写范围内（已拒绝）'
      : `命令 cwd ${effective} 超出任务声明的可写范围（已拒绝）`;
  }
  return null;
}

/**
 * 把任务策略翻译成运行时三件套（工具过滤集合 + 审批器 + 护栏）。
 * 无策略：空集合 + 恒拒绝 + 空范围护栏（危险工具也不会被注入）。
 */
export function buildScheduledPolicyRuntime(
  policy: ScheduledTaskPolicy | undefined,
  cwd: string,
): ScheduledPolicyRuntime {
  const normalized = normalizeScheduledPolicy(policy);
  const allowedToolNames = new Set<string>(normalized?.allowedTools ?? []);
  const allowedCommands = normalized?.allowedCommands ?? [];
  const fileScopes = normalized?.fileScopes ?? [];

  return {
    allowedToolNames,
    shouldApprove: (toolName) => allowedToolNames.has(toolName),
    toolGuard: async (name, args) => {
      if (isScheduledDeniedTool(name)) {
        return `工具 ${name} 不支持在调度任务中使用（已拒绝）`;
      }
      if (name === 'write_file' || name === 'edit_file') {
        const target = typeof args.path === 'string' ? args.path : '';
        return checkScheduledFilePath(target, cwd, fileScopes);
      }
      if (name === 'run_command') {
        const command = typeof args.command === 'string' ? args.command : '';
        if (!matchesCommandAllowlist(command, allowedCommands)) {
          return '命令不在任务白名单内（已拒绝）';
        }
        return checkScheduledCommandCwd(typeof args.cwd === 'string' ? args.cwd : undefined, cwd, fileScopes);
      }
      return null;
    },
  };
}
