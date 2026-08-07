/**
 * 统一路径安全工具
 *
 * 所有文件/目录操作共用同一套安全规则，避免多处实现不一致导致绕过。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * 将路径解析为绝对路径（相对于 cwd）。
 */
export function resolvePath(p: string, cwd: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.resolve(cwd, p));
}

/**
 * 基础字符串级路径安全检查：
 * - 必须在 cwd 内（不允许 .. 越界或外部绝对路径）
 * - 返回 true 表示安全
 */
export function isWithinDir(absPath: string, cwd: string): boolean {
  const normalizedCwd = path.normalize(cwd);
  const normalizedPath = path.normalize(absPath);
  const rel = path.relative(normalizedCwd, normalizedPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 将 cwd 规范化为真实路径，供 realpath 比较使用。
 * macOS 下 /tmp、/var 等是符号链接（/var → /private/var），
 * 若只用字符串比较会把合法路径误判为"超出工作目录"。
 */
export async function canonicalCwd(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    return path.normalize(dir);
  }
}

/**
 * 验证已存在路径的真实路径仍在 cwd 内（防 symlink/junction 绕过）。
 * 如果路径不存在，返回错误而不是回退到原始路径。
 */
export async function verifyExistingPath(absPath: string, cwd: string): Promise<{ ok: true; realPath: string } | { ok: false; error: string }> {
  const normalizedCwd = path.normalize(cwd);

  // 先做字符串检查
  if (!isWithinDir(absPath, normalizedCwd)) {
    return { ok: false, error: `路径超出工作目录：${absPath}` };
  }

  const realCwd = await canonicalCwd(normalizedCwd);

  // 检查路径是否存在（用 lstat 不跟随 symlink）
  let lstat;
  try {
    lstat = await fs.lstat(absPath);
  } catch {
    return { ok: false, error: `路径不存在：${absPath}` };
  }

  // 如果是 symlink，解析真实路径并验证
  if (lstat.isSymbolicLink()) {
    let realPath: string;
    try {
      realPath = await fs.realpath(absPath);
    } catch {
      return { ok: false, error: `符号链接目标不存在：${absPath}` };
    }
    if (!isWithinDir(realPath, realCwd)) {
      return { ok: false, error: `符号链接目标超出工作目录：${absPath}` };
    }
    return { ok: true, realPath };
  }

  // 非 symlink，解析 realpath（可能包含 junction）
  let realPath: string;
  try {
    realPath = await fs.realpath(absPath);
  } catch {
    return { ok: false, error: `无法解析路径：${absPath}` };
  }
  if (!isWithinDir(realPath, realCwd)) {
    return { ok: false, error: `路径超出工作目录：${absPath} → ${realPath}` };
  }
  return { ok: true, realPath };
}

/**
 * 验证写入路径的安全性（用于创建新文件）。
 * - 如果目标文件已存在，走 verifyExistingPath
 * - 如果是新文件，检查最近存在父目录的 realpath 仍在 cwd 内
 * - 拒绝在 symlink 目录下创建新文件
 */
export async function verifyWritePath(absPath: string, cwd: string): Promise<{ ok: true; realPath: string } | { ok: false; error: string }> {
  const normalizedCwd = path.normalize(cwd);

  // 字符串检查
  if (!isWithinDir(absPath, normalizedCwd)) {
    return { ok: false, error: `路径超出工作目录：${absPath}` };
  }

  const realCwd = await canonicalCwd(normalizedCwd);

  // 如果目标已存在，用 verifyExistingPath
  try {
    await fs.lstat(absPath);
    return verifyExistingPath(absPath, normalizedCwd);
  } catch {
    // 文件不存在，检查父目录
  }

  // 找到最近存在的父目录
  let parent = path.dirname(absPath);
  let parentLstat;
  while (true) {
    try {
      parentLstat = await fs.lstat(parent);
      break;
    } catch {
      const next = path.dirname(parent);
      if (next === parent) {
        return { ok: false, error: `无法解析父目录：${absPath}` };
      }
      parent = next;
    }
  }

  // 如果父目录是 symlink，拒绝（防止在 symlink 指向的外部目录下创建文件）
  if (parentLstat.isSymbolicLink()) {
    return { ok: false, error: `父目录是符号链接，不允许在其下创建文件：${absPath}` };
  }

  // 验证父目录的真实路径仍在 cwd 内
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch {
    return { ok: false, error: `无法解析父目录：${parent}` };
  }
  if (!isWithinDir(realParent, realCwd)) {
    return { ok: false, error: `父目录超出工作目录：${absPath}` };
  }

  // 返回调用方词法形式路径（父目录已验证为真实目录且在 realCwd 内，可直接用于创建文件）。
  // 不返回 canonical 形式，避免 cwd 本身是符号链接（如 macOS /var → /private/var）时
  // 返回值与调用方视角不一致。
  return { ok: true, realPath: path.normalize(absPath) };
}

/**
 * 验证工作目录本身是否合法（用于 IPC 入口）。
 * 不能被 renderer 用任意路径调用。
 */
export async function validateWorkDir(workDir: string, allowedDirs: string[]): Promise<{ ok: true; resolved: string } | { ok: false; error: string }> {
  const resolved = path.resolve(workDir);
  const normalized = path.normalize(resolved);

  // 检查是否在允许的目录列表中
  for (const allowed of allowedDirs) {
    const normalizedAllowed = path.normalize(path.resolve(allowed));
    if (normalized === normalizedAllowed || normalized.startsWith(normalizedAllowed + path.sep)) {
      // 验证 realpath 一致（防 symlink 绕过）
      try {
        const real = await fs.realpath(resolved);
        if (path.normalize(real) === normalizedAllowed || path.normalize(real).startsWith(normalizedAllowed + path.sep)) {
          return { ok: true, resolved: normalized };
        }
      } catch {
        return { ok: false, error: `工作目录不存在或无法访问：${workDir}` };
      }
    }
  }
  return { ok: false, error: `工作目录不在允许范围内：${workDir}` };
}
