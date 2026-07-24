import type { OpenAITool, ToolName, ToolArgs, ToolResult } from '../../../shared/ipc';
import { readFile, writeFile, editFile, fsTools } from './fs';
import { runCommand, shellTools } from './shell';
import { searchFiles, searchTools } from './search';

export { fsTools, shellTools, searchTools };

export const allTools: OpenAITool[] = [...fsTools, ...shellTools, ...searchTools];

/**
 * Plan 模式工具集：只读 + 搜索
 * 在 plan 模式下，agent 不能直接修改文件或执行命令，只能：
 * 1. 读文件
 * 2. 搜索文件
 * 这样让 agent 先分析、给出计划，等用户批准再切到 build 模式执行
 */
export const planModeTools: OpenAITool[] = [
  fsTools.find((t) => t.function.name === 'read_file')!,
  searchTools[0],
];

export async function invokeTool(
  name: ToolName,
  args: ToolArgs,
  cwd: string,
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return readFile(args as { path: string }, cwd);
    case 'write_file':
      return writeFile(args as { path: string; content: string }, cwd);
    case 'edit_file':
      return editFile(
        args as { path: string; oldText: string; newText: string },
        cwd,
      );
    case 'run_command':
      return runCommand(
        args as { command: string; timeoutMs?: number },
        cwd,
      );
    case 'search_files':
      return searchFiles(args as { pattern: string; cwd?: string }, cwd);
    default: {
      const exhaustive: never = name;
      throw new Error(`未知 tool：${exhaustive}`);
    }
  }
}
