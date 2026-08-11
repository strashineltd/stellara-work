import fg from 'fast-glob';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OpenAITool, ToolResult } from '../../../shared/ipc';
import type { SearchContentArgs } from '../../../shared/ipc';
import { isWithinDir, canonicalCwd } from '../../fs/path-security';
import { isAbsolutePathArg } from './shell';

const MAX_MATCHES = 200;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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

export async function searchContent(args: SearchContentArgs, cwd: string): Promise<ToolResult> {
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

    const query = args.query;
    const caseSensitive = args.caseSensitive ?? true;
    const useRegex = args.regex ?? false;

    // 构建匹配函数
    let matchFn: (line: string) => boolean;
    if (useRegex) {
      try {
        const flags = caseSensitive ? '' : 'i';
        const re = new RegExp(query, flags);
        matchFn = (line) => re.test(line);
      } catch {
        return { ok: false, output: '', error: `无效的正则表达式: ${query}` };
      }
    } else {
      const matchQuery = caseSensitive ? query : query.toLowerCase();
      matchFn = (line) => {
        const testLine = caseSensitive ? line : line.toLowerCase();
        return testLine.includes(matchQuery);
      };
    }

    const results: string[] = [];
    let totalMatches = 0;

    for (const file of files.slice(0, 200)) {
      if (totalMatches >= MAX_MATCHES) break;

      const absPath = path.join(searchRoot, file);
      let stat;
      try {
        stat = await fs.stat(absPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SIZE) continue;

      let content: string;
      try {
        content = await fs.readFile(absPath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (totalMatches >= MAX_MATCHES) break;
        const line = lines[i]!;
        if (matchFn(line)) {
          results.push(`${file}:${i + 1}: ${line.trim().slice(0, 200)}`);
          totalMatches++;
        }
      }
    }

    return {
      ok: true,
      output: results.length === 0 ? '(无匹配)' : results.join('\n'),
    };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export const grepTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_content',
      description:
        '在文件内容中搜索匹配的文本行（类似 grep）。指定文件 glob 模式 + 搜索文本，返回匹配的行和行号。最多返回 200 条匹配，跳过 >10MB 的文件。支持正则表达式（设 regex=true）。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '文件 glob 模式，如 **/*.ts' },
          query: { type: 'string', description: '要搜索的文本或正则表达式' },
          caseSensitive: { type: 'boolean', description: '大小写敏感，默认 true' },
          regex: { type: 'boolean', description: '是否使用正则表达式匹配（默认 false）' },
          cwd: { type: 'string', description: '搜索根目录（相对工作目录），可选' },
        },
        required: ['pattern', 'query'],
        additionalProperties: false,
      },
    },
  },
];
