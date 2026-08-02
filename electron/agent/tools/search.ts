import fg from 'fast-glob';
import path from 'node:path';
import type { SearchFilesArgs, ToolResult, OpenAITool } from '../../../shared/ipc';

export async function searchFiles(args: SearchFilesArgs, cwd: string): Promise<ToolResult> {
  try {
    const searchRoot = args.cwd ? path.resolve(cwd, args.cwd) : cwd;
    const files = await fg(args.pattern, {
      cwd: searchRoot,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/release/**'],
      onlyFiles: true,
      dot: false,
    });
    return {
      ok: true,
      output: files.length === 0 ? '(无匹配)' : files.slice(0, 200).join('\n'),
    };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const searchTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '用 glob 模式搜索文件路径（仅匹配文件名，不搜索文件内容）。自动忽略 node_modules/.git/dist/build/release 目录。最多返回 200 条结果。如需搜索文件内容请用 search_content 工具。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
          cwd: { type: 'string', description: '搜索根目录（相对工作目录），可选' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
];
