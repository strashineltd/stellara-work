import fg from 'fast-glob';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { OpenAITool, ToolResult } from '../../../shared/ipc';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_INCLUDE = '**/*.{ts,tsx,js,jsx,py,swift,go,rs,java}';

export interface SearchSymbolArgs {
  symbol: string;
  include?: string;
  contextLines?: number;
  limit?: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchSymbol(args: SearchSymbolArgs, cwd: string): Promise<ToolResult> {
  try {
    const symbol = args.symbol;
    const contextLines = args.contextLines ?? 2;
    const limit = args.limit ?? 30;
    if (!symbol || !symbol.trim()) {
      return { ok: false, output: '', error: 'symbol 不能为空' };
    }
    if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 10) {
      return { ok: false, output: '', error: `contextLines 必须在 0-10 之间，收到: ${contextLines}` };
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, output: '', error: `limit 必须在 1-100 之间，收到: ${limit}` };
    }

    const include = args.include ?? DEFAULT_INCLUDE;
    const files = await fg(include, {
      cwd,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/release/**'],
      onlyFiles: true,
      dot: false,
    });

    const esc = escapeRegExp(symbol);
    const definitionRe = new RegExp(
      `(function\\s+${esc}|const\\s+${esc}|class\\s+${esc}|def\\s+${esc}|func\\s+${esc}|interface\\s+${esc}|enum\\s+${esc}|type\\s+${esc}|import[^\\n]*${esc}|${esc}\\s*[:=(])`,
    );

    const results: string[] = [];
    let totalMatches = 0;

    for (const file of files.slice(0, 200)) {
      if (totalMatches >= limit) break;

      const absPath = path.join(cwd, file);
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
        if (totalMatches >= limit) break;
        const line = lines[i]!;
        if (!definitionRe.test(line)) continue;

        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        for (let j = start; j < end; j++) {
          const contentLine = lines[j]!.trim().slice(0, 200);
          results.push(j === i ? `${file}:${i + 1}: ${contentLine}` : contentLine);
        }
        totalMatches++;
      }
    }

    return {
      ok: true,
      output: results.length === 0 ? '(未找到符号)' : results.join('\n'),
    };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export const searchSymbolTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'search_symbol',
      description:
        '在代码文件中定位符号（函数/类/接口/import/变量等）的定义位置。按定义模式匹配（function/const/class/def/func/interface/enum/type/import/赋值），返回路径:行号及上下文。',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '要定位的符号名，如 handleSend' },
          include: { type: 'string', description: `文件 glob 模式，默认 ${DEFAULT_INCLUDE}` },
          contextLines: { type: 'number', description: '匹配行前后上下文行数，默认 2（0-10）' },
          limit: { type: 'number', description: '最大返回匹配数，默认 30（1-100）' },
        },
        required: ['symbol'],
        additionalProperties: false,
      },
    },
  },
];
