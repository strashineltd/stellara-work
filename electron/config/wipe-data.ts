import { promises as fs } from 'node:fs';
import path from 'node:path';

const FILES_TO_DELETE = [
  'config.json',
  'config.json.bak',
  '.env',
  'stellara.db',
  'stellara.db-wal',
  'stellara.db-shm',
];

/**
 * 删除全部应用数据（runtime 目录文件 + 遗留目录副本 + 重建空库）。
 *
 * `settings:clearAllData` 与 `settings:resetSelective('all')` 共用 —— 两份
 * 拷贝曾经各自维护、已经漂移，这里是唯一实现。
 */
export async function wipeAllData(): Promise<void> {
  const { closeDb } = await import('../store/db');
  try {
    closeDb();
  } catch {
    // ignore
  }
  const { getAppDataDir, getLegacyDataDir } = await import('./data-dir');
  const { resetEnvCache } = await import('./env');
  const dir = getAppDataDir();
  const legacyDir = getLegacyDataDir();

  // 顺序删除 runtime dir 文件，带重试（Windows 文件锁）
  for (const name of FILES_TO_DELETE) {
    const filePath = path.join(dir, name);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rm(filePath, { force: true });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt < 2 && (code === 'EBUSY' || code === 'EPERM')) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
      }
    }
    if (lastErr) {
      const code = (lastErr as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM') {
        throw new Error('无法删除数据文件：文件被占用。请关闭应用后重试。');
      }
      throw lastErr;
    }
  }

  // 遗留目录清理（独立 try，不受 runtime dir 错误影响）
  try {
    await Promise.all(
      FILES_TO_DELETE.map((name) => fs.rm(path.join(legacyDir, name), { force: true })),
    );
  } catch {
    // 遗留目录删除失败不阻塞重置
  }

  resetEnvCache();

  // 重新初始化空数据库 + 记忆存储
  try {
    const { initDb, getDb } = await import('../store/db');
    initDb();
    const { setMemoryDb } = await import('../memory/memory-store');
    setMemoryDb(getDb);
  } catch {
    // ignore - will be re-initialized on next access
  }
}
