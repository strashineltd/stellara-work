import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalCwd, isWithinDir, resolvePath, verifyWritePath } from './path-security';
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
 * 列目录树（深度限制 + 跳过无用目录 + 跳过 symlink）
 * - maxDepth=1：只列根
 * - maxDepth=2：根 + 1 层子目录
 * - 默认 4 层
 * - 跳过符号链接（安全考虑）
 *
 * P9：同层子节点并行 stat；按 (cwd, maxDepth) 短 TTL 缓存，避免侧栏/Modal 反复全量扫盘。
 */
const TREE_CACHE_TTL_MS = 3000;
const treeCache = new Map<string, { at: number; node: FsNode }>();

export async function listTree(cwd: string, maxDepth = 4): Promise<FsNode> {
  const root = path.resolve(cwd);
  const cacheKey = `${root}::${maxDepth}`;
  const hit = treeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TREE_CACHE_TTL_MS) return hit.node;
  const realRoot = await canonicalCwd(root);
  const node = await buildNode(root, root, realRoot, 0, maxDepth);
  treeCache.set(cacheKey, { at: Date.now(), node });
  if (treeCache.size > 32) {
    const oldest = treeCache.keys().next().value;
    if (oldest) treeCache.delete(oldest);
  }
  return node;
}

/** 测试 / 写文件后失效缓存 */
export function invalidateTreeCache(workDir?: string): void {
  if (!workDir) {
    treeCache.clear();
    return;
  }
  const root = path.resolve(workDir);
  for (const key of [...treeCache.keys()]) {
    if (key.startsWith(`${root}::`)) treeCache.delete(key);
  }
}

/**
 * 懒展开：只列 dirPath 的直接子节点（深度 1），用于展开时再加载。
 */
export async function listTreeChildren(cwd: string, dirPath: string): Promise<FsNode[]> {
  const root = path.resolve(cwd);
  const target = path.resolve(dirPath);
  if (!isWithinDir(target, root) && target !== root) {
    throw new Error(`路径超出允许范围：${dirPath}`);
  }
  const realRoot = await canonicalCwd(root);
  const node = await buildNode(target, root, realRoot, 0, 1);
  return node.children ?? [];
}

async function buildNode(absPath: string, root: string, realRoot: string, depth: number, maxDepth: number): Promise<FsNode> {
  const name = path.basename(absPath) || absPath;

  // 使用 lstat 不跟随 symlink
  const stat = await fs.lstat(absPath);

  // 跳过 symlink（安全：防止遍历出工作目录）
  if (stat.isSymbolicLink()) {
    // 验证 symlink 目标是否在 root 内
    try {
      const real = await fs.realpath(absPath);
      if (!isWithinDir(real, realRoot)) {
        // symlink 指向工作目录外，显示为单一条目但不递归
        return { name, path: absPath, type: 'file', size: 0 };
      }
    } catch {
      // broken symlink，显示为单一条目
      return { name, path: absPath, type: 'file', size: 0 };
    }
    // symlink 在工作目录内，仍然不递归（安全考虑）
    return { name, path: absPath, type: 'file', size: 0 };
  }

  if (!stat.isDirectory()) {
    return { name, path: absPath, type: 'file', size: stat.size };
  }

  const node: FsNode = { name, path: absPath, type: 'dir' };
  if (depth >= maxDepth) {
    return node;
  }

  const entries = await fs.readdir(absPath, { withFileTypes: true });
  const wanted = entries.filter((e) => {
    if (SKIP_DIRS.has(e.name)) return false;
    if (e.name.startsWith('.') && !ALLOW_DOT.has(e.name)) return false;
    return true;
  });
  // P9：同层并行（有界），避免大目录串行 lstat 拖垮主进程
  const children = await mapWithConcurrency(
    wanted,
    16,
    (e) => buildNode(path.join(absPath, e.name), root, realRoot, depth + 1, maxDepth),
  );
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children = children;
  return node;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 读文件内容（限制大小 + 越权检查 + symlink 安全）
 * - workDir 是允许的根目录，被读路径必须在其下
 * - 使用 realpath 验证 symlink 目标
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
  if (!isWithinDir(resolved, root)) {
    throw new Error(`路径超出允许范围：${resolved}`);
  }

  // 防 symlink 绕过：检查 realpath 是否仍在 root 内（root 先规范化为真实路径）
  let realPath: string;
  const realRoot = await canonicalCwd(root);
  try {
    realPath = await fs.realpath(resolved);
  } catch {
    // 文件不存在 → 检查是否是 broken symlink
    try {
      const lstat = await fs.lstat(resolved);
      if (lstat.isSymbolicLink()) {
        throw new Error(`符号链接目标不存在或超出允许范围：${resolved}`);
      }
    } catch (lstatErr) {
      if (lstatErr instanceof Error && lstatErr.message.includes('符号链接')) throw lstatErr;
      throw new Error(`文件不存在：${resolved}`);
    }
    throw new Error(`文件不存在：${resolved}`);
  }

  if (!isWithinDir(realPath, realRoot)) {
    throw new Error(`符号链接目标超出允许范围：${resolved} → ${realPath}`);
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

/**
 * 在工作目录内安全创建空文件。
 * - 只接受相对路径
 * - 父目录必须已经存在
 * - 使用 wx 独占模式，绝不覆盖已有文件
 */
export async function createEmptyFile(
  workDir: string,
  relativePath: string,
): Promise<{ path: string }> {
  const requested = relativePath.trim();
  if (!requested) throw new Error('请输入文件名');
  if (requested.length > 240) throw new Error('文件路径不能超过 240 个字符');
  if (requested.includes('\0')) throw new Error('文件路径包含无效字符');
  if (path.isAbsolute(requested)) throw new Error('请输入工作目录内的相对路径');

  const root = path.resolve(workDir);
  const resolved = resolvePath(requested, root);
  if (resolved === root) throw new Error('请输入有效的文件名');

  const check = await verifyWritePath(resolved, root);
  if (!check.ok) throw new Error(check.error);

  const parent = path.dirname(check.realPath);
  let parentStat;
  try {
    parentStat = await fs.stat(parent);
  } catch {
    throw new Error('父目录不存在，请先选择已有目录');
  }
  if (!parentStat.isDirectory()) throw new Error('父路径不是目录');

  try {
    const handle = await fs.open(check.realPath, 'wx');
    await handle.close();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new Error('文件已存在，请使用其他名称');
    if (code === 'ENOENT') throw new Error('父目录不存在，请先选择已有目录');
    throw error;
  }

  invalidateTreeCache(root);
  return { path: check.realPath };
}

/**
 * 在工作目录内安全创建新目录。
 * - 只接受相对路径（禁止绝对路径与 .. 越界）
 * - 父目录必须已经存在
 * - 目标已存在时抛错（mkdir 的 EEXIST），绝不覆盖
 */
export async function createDirectory(
  workDir: string,
  relativePath: string,
): Promise<{ path: string }> {
  const requested = relativePath.trim();
  if (!requested) throw new Error('请输入文件夹名');
  if (requested.length > 240) throw new Error('文件夹路径不能超过 240 个字符');
  if (requested.includes('\0')) throw new Error('文件夹路径包含无效字符');
  if (path.isAbsolute(requested)) throw new Error('请输入工作目录内的相对路径');

  const root = path.resolve(workDir);
  const resolved = resolvePath(requested, root);
  if (resolved === root) throw new Error('请输入有效的文件夹名');

  const check = await verifyWritePath(resolved, root);
  if (!check.ok) throw new Error(check.error);

  const parent = path.dirname(check.realPath);
  let parentStat;
  try {
    parentStat = await fs.stat(parent);
  } catch {
    throw new Error('父目录不存在，请先选择已有目录');
  }
  if (!parentStat.isDirectory()) throw new Error('父路径不是目录');

  try {
    await fs.mkdir(check.realPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new Error('文件夹已存在，请使用其他名称');
    if (code === 'ENOENT') throw new Error('父目录不存在，请先选择已有目录');
    throw error;
  }

  invalidateTreeCache(root);
  return { path: check.realPath };
}
