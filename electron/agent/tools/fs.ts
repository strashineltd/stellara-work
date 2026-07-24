import { promises as fs } from 'node:fs';
import path from 'node:path';
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
    const stat = await fs.stat(absPath);
    if (stat.size > MAX_FILE_SIZE) {
      return {
        ok: false,
        output: '',
        error: `文件过大（${stat.size} bytes > ${MAX_FILE_SIZE} bytes）`,
      };
    }
    const content = await fs.readFile(absPath, 'utf-8');
    return { ok: true, output: content };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

export async function writeFile(args: WriteFileArgs, cwd: string): Promise<ToolResult> {
  try {
    const absPath = resolvePath(args.path, cwd);
    // 路径安全检查：禁止写到工作目录之外（除非用绝对路径且显式声明）
    if (!isPathSafe(absPath, cwd) && !path.isAbsolute(args.path)) {
      return { ok: false, output: '', error: `路径超出工作目录：${args.path}` };
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, args.content, 'utf-8');
    return { ok: true, output: `已写入 ${args.path} (${args.content.length} 字符)` };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

export async function editFile(args: EditFileArgs, cwd: string): Promise<ToolResult> {
  try {
    const absPath = resolvePath(args.path, cwd);
    if (!isPathSafe(absPath, cwd) && !path.isAbsolute(args.path)) {
      return { ok: false, output: '', error: `路径超出工作目录：${args.path}` };
    }
    const original = await fs.readFile(absPath, 'utf-8');

    if (!original.includes(args.oldText)) {
      return {
        ok: false,
        output: '',
        error: `未找到要替换的文本。请检查 oldText 是否精确匹配（含缩进和换行）。`,
      };
    }

    const updated = original.replace(args.oldText, args.newText);
    if (updated === original) {
      return { ok: false, output: '', error: '替换后内容未变化' };
    }

    await fs.writeFile(absPath, updated, 'utf-8');
    return {
      ok: true,
      output: `已编辑 ${args.path}（替换 ${(original.length - updated.length) * -1} 字符）`,
    };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

function resolvePath(p: string, cwd: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p);
}

function isPathSafe(absPath: string, cwd: string): boolean {
  const rel = path.relative(cwd, absPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const fsTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个文件的全部内容。返回 utf-8 文本。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径，或绝对路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '把内容写入文件。如果文件已存在会覆盖。如果父目录不存在会自动创建。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径' },
          content: { type: 'string', description: '要写入的完整内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        '按精确文本替换来编辑文件。oldText 必须精确匹配（含缩进换行），newText 是替换后的文本。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于工作目录的文件路径' },
          oldText: { type: 'string', description: '要替换的原始文本（精确匹配）' },
          newText: { type: 'string', description: '替换后的文本' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
];
