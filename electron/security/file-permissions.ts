import { promises as fs, chmodSync } from 'node:fs';

/**
 * 文件权限加固的 best-effort 包装。
 *
 * - POSIX：按 mode chmod；已有文件权限更宽或更窄都会被校正。
 * - Windows：chmod 基本无效（Node 仅支持读写位近似），忽略错误即可，
 *   安全性依赖 %APPDATA% 的 ACL。
 *
 * 这里刻意吞掉异常：权限加固失败不应让原本的业务写入/读取失败。
 */
export async function bestEffortChmod(filePath: string, mode: number): Promise<void> {
  try {
    await fs.chmod(filePath, mode);
  } catch {
    // ignore — 平台不支持或无权限
  }
}

export function bestEffortChmodSync(filePath: string, mode: number): void {
  try {
    chmodSync(filePath, mode);
  } catch {
    // ignore
  }
}
