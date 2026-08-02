import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  resolvePath,
  verifyExistingPath,
  verifyWritePath,
} from '../../fs/path-security';
import type {
  ReadFileArgs,
  WriteFileArgs,
  EditFileArgs,
  ToolResult,
  OpenAITool,
} from '../../../shared/ipc';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function readFile(args: ReadFileArgs, cwd: string): Promise<ToolResult> {
  try {
    const absPath = resolvePath(args.path, cwd);

    // 验证路径安全（含 symlink 真实路径检查）
    const check = await verifyExistingPath(absPath, cwd);
    if (!check.ok) return { ok: false, output: '', error: check.error };

    const stat = await fs.stat(absPath);
    if (stat.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        output: '',
        error: `文件过大（${stat.size} bytes > ${MAX_FILE_SIZE} bytes）`,
      };
    }
    const content = await fs.readFile(absPath, 'utf-8');

    // 行范围读取
    if (args.offset != null || args.limit != null) {
      const lines = content.split('\n');
      const totalLines = lines.length;
      const start = Math.max(1, args.offset ?? 1) - 1; // 0-indexed
      const count = args.limit ?? totalLines;
      const end = Math.min(start + count, totalLines);
      const selected = lines.slice(start, end);
      const numbered = selected.map((line, i) => `${start + i + 1}: ${line}`).join('\n');
      return {
        ok: true,
        output: `(lines ${start + 1}-${end} of ${totalLines}) ${args.path}\n${numbered}`,
      };
    }

    return { ok: true, output: content };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

export async function writeFile(args: WriteFileArgs, cwd: string): Promise<ToolResult> {
  try {
    const absPath = resolvePath(args.path, cwd);

    // 验证写入路径安全（含父目录 symlink 检查）
    const check = await verifyWritePath(absPath, cwd);
    if (!check.ok) return { ok: false, output: '', error: check.error };

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    // 读旧内容（可能不存在）
    let before: string | null = null;
    try {
      before = await fs.readFile(absPath, 'utf-8');
    } catch {
      // 文件不存在 → 新建
    }
    await fs.writeFile(absPath, args.content, 'utf-8');
    return {
      ok: true,
      output: `已写入 ${args.path} (${args.content.length} 字符)`,
      meta: { kind: 'edit', path: args.path, before, after: args.content },
    };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

export async function editFile(args: EditFileArgs, cwd: string): Promise<ToolResult> {
  try {
    const absPath = resolvePath(args.path, cwd);

    // 验证路径安全（含 symlink 真实路径检查）
    const check = await verifyExistingPath(absPath, cwd);
    if (!check.ok) return { ok: false, output: '', error: check.error };

    const original = await fs.readFile(absPath, 'utf-8');

    const occurrences = countOccurrences(original, args.oldText);
    if (occurrences === 0) {
      return {
        ok: false,
        output: '',
        error: `未找到要替换的文本。请检查 oldText 是否精确匹配（含缩进和换行）。`,
      };
    }

    if (args.replaceAll) {
      // 全局替换模式
      const updated = original.split(args.oldText).join(args.newText);
      if (updated === original) {
        return { ok: false, output: '', error: '替换后内容未变化' };
      }
      await fs.writeFile(absPath, updated, 'utf-8');
      return {
        ok: true,
        output: `已编辑 ${args.path}（替换了 ${occurrences} 处，净变化 ${updated.length - original.length} 字符）`,
        meta: { kind: 'edit', path: args.path, before: original, after: updated },
      };
    }

    // 精确单次匹配模式（默认）
    if (occurrences > 1) {
      return {
        ok: false,
        output: '',
        error: `匹配到 ${occurrences} 处。请给出更精确的 oldText（包含前后几行作为上下文），或使用 replaceAll=true 替换所有匹配。`,
      };
    }

    const updated = original.replace(args.oldText, args.newText);
    if (updated === original) {
      return { ok: false, output: '', error: '替换后内容未变化' };
    }

    await fs.writeFile(absPath, updated, 'utf-8');
    return {
      ok: true,
      output: `已编辑 ${args.path}（净变化 ${updated.length - original.length} 字符）`,
      meta: { kind: 'edit', path: args.path, before: original, after: updated },
    };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const fsTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容（最大 10MB）。支持行范围读取：指定 offset（起始行，1-indexed）和 limit（最大行数）只读取文件的一部分，适合查看大文件的特定区域。返回带行号的内容。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径' },
          offset: { type: 'number', description: '起始行号（1-indexed），从文件第几行开始读' },
          limit: { type: 'number', description: '最大读取行数' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        '把内容写入文件。如果文件已存在会覆盖。如果父目录不存在会自动创建。所有路径必须落在工作目录之内。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径' },
          content: { type: 'string', description: '要写入的完整内容' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        '按精确文本替换来编辑文件。调用前务必先用 read_file 读取文件获取准确的当前内容。oldText 必须精确匹配（含缩进换行）。默认要求恰好出现一次；设 replaceAll=true 可替换所有匹配项。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径' },
          oldText: { type: 'string', description: '要替换的原始文本（精确匹配）', minLength: 1 },
          newText: { type: 'string', description: '替换后的文本' },
          replaceAll: { type: 'boolean', description: '是否替换所有匹配项（默认 false，要求恰好 1 次匹配）' },
        },
        required: ['path', 'oldText', 'newText'],
        additionalProperties: false,
      },
    },
  },
];
