import type { OpenAITool, ToolName, ToolArgs, ToolResult, ToolExecutionContext, RunCommandArgs, DispatchSubagentsArgs } from '../../../shared/ipc';
import { readFile, writeFile, editFile, fsTools } from './fs';
import { runCommand, shellTools } from './shell';
import { searchFiles, searchTools } from './search';
import { searchContent, grepTools } from './grep';
import { searchSymbol, searchSymbolTools } from './search-symbol';
import { listFiles, listFilesTools } from './list-files';
import { webFetch, webFetchTools } from './web-fetch';
import { taskComplete, taskCompleteTools } from './task-complete';
import { gitStatus, gitDiff, gitLog, gitTools } from './git';
import { memorySearch, memorySave, memoryTools } from './memory';
import { dispatchSubagents, dispatchSubagentsTools } from './dispatch-subagents';
import { mcpManager } from '../../mcp/mcp-manager';

export { fsTools, shellTools, searchTools, grepTools, searchSymbolTools, listFilesTools, webFetchTools, taskCompleteTools, gitTools, memoryTools, dispatchSubagentsTools };

export const allTools: OpenAITool[] = [
  ...fsTools,
  ...shellTools,
  ...searchTools,
  ...grepTools,
  ...searchSymbolTools,
  ...listFilesTools,
  ...webFetchTools,
  ...taskCompleteTools,
  ...gitTools,
  ...memoryTools,
  ...dispatchSubagentsTools,
];

/**
 * Plan 模式工具集：只读 + 搜索 + git
 */
export const planModeTools: OpenAITool[] = [
  fsTools.find((t) => t.function.name === 'read_file')!,
  searchTools[0],   // search_files
  grepTools[0],     // search_content
  searchSymbolTools[0], // search_symbol（只读）
  listFilesTools[0], // list_files
  ...gitTools,      // git 操作是只读的
  // web_fetch 不进 plan mode（会发起外部请求）
  // memory_search 也不进 plan mode
];

export async function invokeTool(
  name: ToolName,
  args: ToolArgs,
  cwd: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  // MCP 桥接：mcp__ 开头的工具名路由到 mcpManager.callTool
  if (typeof name === 'string' && name.startsWith('mcp__')) {
    return mcpManager.callTool(name, args as Record<string, unknown>);
  }

  const result = await invokeToolInternal(name, args, cwd, context);
  return result;
}

async function invokeToolInternal(
  name: ToolName,
  args: ToolArgs,
  cwd: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return readFile(args as { path: string; offset?: number; limit?: number }, cwd);
    case 'write_file':
      return writeFile(args as { path: string; content: string }, cwd);
    case 'edit_file':
      return editFile(
        args as { path: string; oldText: string; newText: string; replaceAll?: boolean },
        cwd,
      );
    case 'run_command':
      return runCommand(
        args as RunCommandArgs,
        cwd,
      );
    case 'search_files':
      return searchFiles(args as { pattern: string; cwd?: string }, cwd);
    case 'search_content':
      return searchContent(args as { pattern: string; query: string; caseSensitive?: boolean; regex?: boolean; cwd?: string }, cwd);
    case 'search_symbol':
      return searchSymbol(args as { symbol: string; include?: string; contextLines?: number; limit?: number }, cwd);
    case 'list_files':
      return listFiles(args as { path?: string; maxDepth?: number }, cwd);
    case 'web_fetch':
      return webFetch(args as { url: string; maxBytes?: number }, cwd);
    case 'task_complete':
      return taskComplete(args as { summary?: string }, cwd);
    case 'git_status':
      return gitStatus(args as Record<string, unknown>, cwd);
    case 'git_diff':
      return gitDiff(args as Record<string, unknown>, cwd);
    case 'git_log':
      return gitLog(args as Record<string, unknown>, cwd);
    case 'memory_search':
      return memorySearch(args as { query: string; limit?: number }, cwd);
    case 'memory_save':
      return memorySave(args as { content: string; kind: string; scope?: string; tags?: string[]; importance?: number }, cwd);
    case 'dispatch_subagents':
      return dispatchSubagents(args as DispatchSubagentsArgs, cwd, context);
    default:
      return { ok: false, output: '', error: `未知工具: ${name}` };
  }
}
