/**
 * 工作目录 / 附件来源授权（进程内、由原生选择器授予）
 *
 * 安全模型（C2）：渲染进程不能自行声明路径可信。
 * 只有主进程在处理原生 dialog 返回值时调用 grant*，
 * 各 IPC 入口再用 assertWorkDirGranted / findUngrantedAttachmentSources 校验。
 * 授权仅存于内存，应用重启后由已持久化的项目/模型/会话配置继续背书。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isWithinDir } from '../fs/path-security';

const grantedWorkDirs = new Set<string>();
const grantedAttachmentSources = new Set<string>();

/**
 * 归一化授权路径：win32 统一小写；其他平台解析 realpath
 * （macOS /tmp、/var 是符号链接，词法比较会把同一目录判成两个）。
 */
export async function normalizeWorkDir(workDir: string): Promise<string> {
  const resolved = path.resolve(workDir);
  if (process.platform === 'win32') return resolved.toLowerCase();
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

/** 原生选择器选中目录后调用；返回调用方词法形式的绝对路径 */
export async function grantWorkDir(workDir: string): Promise<string> {
  const resolved = path.resolve(workDir);
  grantedWorkDirs.add(await normalizeWorkDir(workDir));
  return resolved;
}

export async function isWorkDirGranted(workDir: string): Promise<boolean> {
  return grantedWorkDirs.has(await normalizeWorkDir(workDir));
}

export async function assertWorkDirGranted(workDir: string): Promise<void> {
  if (!(await isWorkDirGranted(workDir))) {
    throw new Error('工作目录未经选择器授权，请重新选择');
  }
}

/** 原生附件选择器返回的源文件视为已授权（记录在 dialog 处理时） */
export async function grantAttachmentSources(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || !filePath.trim()) continue;
    grantedAttachmentSources.add(await normalizeWorkDir(filePath));
  }
}

/**
 * 返回既不在任何已授权工作目录内、也非原生附件选择器来源的绝对源路径。
 * allowedWorkDirs 用于调用方已通过 assertWorkDirAllowed 校验的会话工作区。
 */
export async function findUngrantedAttachmentSources(
  filePaths: string[],
  allowedWorkDirs: string[] = [],
): Promise<string[]> {
  const dirs = new Set(grantedWorkDirs);
  for (const allowed of allowedWorkDirs) {
    if (typeof allowed !== 'string' || !allowed.trim()) continue;
    dirs.add(await normalizeWorkDir(allowed));
  }

  const outside: string[] = [];
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || !filePath.trim()) continue;
    const normalized = await normalizeWorkDir(filePath);
    if (grantedAttachmentSources.has(normalized)) continue;
    let within = false;
    for (const dir of dirs) {
      if (isWithinDir(normalized, dir)) {
        within = true;
        break;
      }
    }
    if (!within) outside.push(path.resolve(filePath));
  }
  return outside;
}

/** 测试 hook */
export function _resetGrantedForTests(): void {
  grantedWorkDirs.clear();
  grantedAttachmentSources.clear();
}
