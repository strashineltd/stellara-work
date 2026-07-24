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
      description: '用 glob 模式搜索文件路径（如 "**/*.ts"、"src/**/*.tsx"）。返回匹配的文件相对路径列表。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 模式，如 **/*.ts' },
          cwd: { type: 'string', description: '搜索根目录（相对工作目录），可选' },
        },
        required: ['pattern'],
      },
    },
  },
];
