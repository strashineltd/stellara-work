import path from 'node:path';
import { isWithinDir } from '../fs/path-security';

const READ_ONLY_BLOCKED_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * 把子代理声明的 fileScopes 规范化成绝对路径前缀：
 * - glob 收敛到其所在目录（`src/**` → `<cwd>/src`）
 * - `..` 按 cwd 解析，不允许借此绕过比较
 */
export function normalizeFileScopes(cwd: string, scopes: readonly string[] | undefined): string[] {
  const normalized = new Set<string>();
  for (const raw of scopes ?? []) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const slashed = trimmed.replaceAll('\\', '/');
    const magicIndex = slashed.search(GLOB_MAGIC);
    let base = slashed;
    if (magicIndex >= 0) {
      const beforeMagic = slashed.slice(0, magicIndex);
      const lastSeparator = beforeMagic.lastIndexOf('/');
      base = lastSeparator >= 0 ? beforeMagic.slice(0, lastSeparator) : '';
    }
    const withoutTrailing = base.replace(/\/+$/, '');
    normalized.add(path.normalize(path.resolve(cwd, withoutTrailing)));
  }
  return [...normalized];
}

export function checkFileScopeViolation(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
  normalizedScopes: readonly string[],
): string | null {
  if (normalizedScopes.length === 0) return null;

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const target = typeof args.path === 'string' ? args.path.trim() : '';
    if (!target) return null;
    const absTarget = path.resolve(cwd, target);
    return normalizedScopes.some((scope) => isWithinDir(absTarget, scope))
      ? null
      : `路径 ${target} 超出子代理声明的 fileScopes（已拒绝）`;
  }

  if (toolName === 'run_command') {
    // S6：省略 cwd 时按工作目录根处理，不得跳过 fileScopes
    const target = typeof args.cwd === 'string' ? args.cwd.trim() : '';
    const effective = target === '' ? '.' : target;
    const absCwd = path.resolve(cwd, effective);
    // 仅允许 cwd 落在某个 scope 目录内（或等于 scope）；
    // 不用 isWithinDir(scope, absCwd)——那会在 scope ⊆ cwd 时放大权限
    const allowed = normalizedScopes.some(
      (scope) => absCwd === scope || isWithinDir(absCwd, scope),
    );
    return allowed ? null : `命令工作目录 ${effective} 超出子代理声明的 fileScopes（已拒绝）`;
  }

  return null;
}

/**
 * 子代理执行边界护栏：只读角色禁止写工具；build 角色的写/命令路径参数必须落在 fileScopes 内。
 */
export function createSubagentToolGuard(options: {
  readOnly: boolean;
  cwd: string;
  fileScopes?: readonly string[];
}): (name: string, args: Record<string, unknown>) => string | null {
  const normalizedScopes = normalizeFileScopes(options.cwd, options.fileScopes);
  return (name, args) => {
    if (options.readOnly && READ_ONLY_BLOCKED_TOOLS.has(name)) {
      return `只读子代理不允许执行 ${name}（已拒绝）`;
    }
    return checkFileScopeViolation(name, args, options.cwd, normalizedScopes);
  };
}
