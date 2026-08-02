import path from 'node:path';
import type { OpenAITool, ToolResult, FsNode } from '../../../shared/ipc';
import type { ListFilesArgs } from '../../../shared/ipc';
import { listTree } from '../../fs/tree';

function formatTree(node: FsNode, prefix = ''): string {
  const lines: string[] = [];
  const isDir = node.type === 'dir';
  const displayName = isDir ? `${node.name}/` : node.name;
  lines.push(`${prefix}${displayName}`);

  if (node.children && node.children.length > 0) {
    const childPrefix = prefix + '  ';
    for (const child of node.children) {
      lines.push(formatTree(child, childPrefix));
    }
  }

  return lines.join('\n');
}

export async function listFiles(args: ListFilesArgs, cwd: string): Promise<ToolResult> {
  try {
    const targetPath = args.path ? path.resolve(cwd, args.path) : cwd;
    // 安全检查
    const rel = path.relative(cwd, targetPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, output: '', error: `路径超出工作目录：${args.path}` };
    }

    const maxDepth = args.maxDepth ?? 2;
    const tree = await listTree(targetPath, maxDepth);
    return {
      ok: true,
      output: formatTree(tree),
    };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export const listFilesTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description:
        '列出工作目录下的文件和目录树。可指定子目录路径和最大深度（默认 2）。自动跳过 node_modules/.git/dist/build 等忽略目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要列出的子目录（相对工作目录），可选，默认根目录' },
          maxDepth: { type: 'number', description: '最大深度，默认 2' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];
