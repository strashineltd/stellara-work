import fg from 'fast-glob';
import path from 'node:path';
import type { SearchFilesArgs, ToolResult, OpenAITool } from '../../../shared/ipc';
import { isWithinDir, canonicalCwd } from '../../fs/path-security';
import { isAbsolutePathArg } from './shell';

/**
 * 校验并解析 cwd 参数（与 shell.ts 的 validateCwdArg 一致）：
 * - undefined/空 → 工作目录根
 * - 绝对路径 → 拒绝（返回 null）
 * - 解析后越出工作目录（.. 越界） → 拒绝（返回 null）
 * - realpath 后越出工作目录（symlink 逃逸） → 拒绝（返回 null）
 * 成功返回规范化后的绝对路径。
 */
async function validateCwdArg(cwd: string | undefined, root: string): Promise<string | null> {
  if (cwd === undefined || cwd === '') return path.normalize(root);
  if (isAbsolutePathArg(cwd)) return null;
  const resolved = path.resolve(root, cwd);
  if (!isWithinDir(resolved, root)) return null;
  const realResolved = await canonicalCwd(resolved);
  const realRoot = await canonicalCwd(root);
  if (!isWithinDir(realResolved, realRoot)) return null;
  return resolved;
}

export async function searchFiles(args: SearchFilesArgs, cwd: string): Promise<ToolResult> {
  try {
    const searchRoot = await validateCwdArg(args.cwd, cwd);
    if (searchRoot === null) {
      const reason =
        args.cwd !== undefined && isAbsolutePathArg(args.cwd)
          ? `cwd "${args.cwd}" 是绝对路径，不允许。请使用工作目录内的相对子目录。`
          : `cwd "${args.cwd}" 超出工作目录。`;
      return { ok: false, output: '', error: reason };
    }
    // glob 结果路径相对 searchRoot，过滤基准必须与之一致（防 pattern 经 .. 逃逸）
    const files = (await fg(args.pattern, {
      cwd: searchRoot,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/release/**'],
      onlyFiles: true,
      dot: false,
    })).filter((file) => isWithinDir(path.resolve(searchRoot, file), searchRoot));
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
