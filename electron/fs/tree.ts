import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FsNode } from '../../shared/ipc';

/**
 * 跳过列表：
 * - node_modules / .git / .stellara / dist / release / out
 * - 隐藏文件（.xxx）除了 .gitignore / .env / .editorconfig
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.stellara', 'dist', 'release', 'out', 'build', '.next', '.cache',
]);
const ALLOW_DOT = new Set([
  '.gitignore', '.env', '.env.example', '.editorconfig', '.eslintrc', '.prettierrc',
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TEXT_BYTES = 100 * 1024; // 预览截断

/**
 * 列目录树（深度限制 + 跳过无用目录）
 * - maxDepth=1：只列根
 * - maxDepth=2：根 + 1 层子目录
 * - 默认 4 层
 */
export async function listTree(cwd: string, maxDepth = 4): Promise<FsNode> {
  return buildNode(path.resolve(cwd), 0, maxDepth);
}

async function buildNode(absPath: string, depth: number, maxDepth: number): Promise<FsNode> {
  const name = path.basename(absPath) || absPath;
  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) {
    return { name, path: absPath, type: 'file', size: stat.size };
  }
  const node: FsNode = { name, path: absPath, type: 'dir' };
  if (depth >= maxDepth) {
    return node;
  }
  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const children: FsNode[] = [];
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (e.name.startsWith('.') && !ALLOW_DOT.has(e.name)) continue;
    const childPath = path.join(absPath, e.name);
    children.push(await buildNode(childPath, depth + 1, maxDepth));
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children = children;
  return node;
}

/**
 * 读文件内容（限制大小 + 越权检查）
 * - workDir 是允许的根目录，被读路径必须在其下
 * - 默认截断到 100KB
 * - 拒绝 > 10MB 的文件
 */
export async function readFileContent(
  workDir: string,
  filePath: string,
  maxBytes = MAX_TEXT_BYTES,
): Promise<{ content: string; size: number; truncated: boolean }> {
  const root = path.resolve(workDir);
  const resolved = path.resolve(filePath);
  // 越权检查：resolved 必须在 root 之内
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径超出允许范围：${resolved}`);
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`不是文件：${resolved}`);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`文件过大（${stat.size} bytes > ${MAX_FILE_SIZE} bytes）`);
  }
  const all = await fs.readFile(resolved, 'utf-8');
  const size = Buffer.byteLength(all, 'utf-8');
  if (all.length > maxBytes) {
    return { content: all.slice(0, maxBytes), size, truncated: true };
  }
  return { content: all, size, truncated: false };
}
