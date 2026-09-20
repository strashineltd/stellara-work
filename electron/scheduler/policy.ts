/**
 * 定时任务写操作策略：保存时校验与运行时匹配（纯函数）。
 */
import { tokenizeCommand, validateAllowedCommandEntry, isAbsolutePathArg } from '../agent/tools/shell';
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

/** 命令是否命中白名单（token 边界前缀） */
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
    if (match) return true;
  }
  return false;
}
