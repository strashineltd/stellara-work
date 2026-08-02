import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LEGACY_DATA_DIR = path.join(os.homedir(), '.stellara');
let runtimeDataDir: string | null = null;

/**
 * Return Stellara Work's writable application-data directory.
 *
 * Electron's main entry sets this to app.getPath('userData') before any
 * config, secret, or database access. The legacy fallback keeps isolated
 * module tests and non-Electron scripts working.
 */
export function getAppDataDir(): string {
  return runtimeDataDir ?? LEGACY_DATA_DIR;
}

export function setAppDataDir(dir: string | null): void {
  runtimeDataDir = dir ? path.resolve(dir) : null;
}

export function getLegacyDataDir(): string {
  return LEGACY_DATA_DIR;
}

/**
 * Copy legacy ~/.stellara data into Electron's standard userData directory.
 * Existing destination files always win, and the legacy directory is kept as
 * a recovery copy instead of being moved or deleted.
 */
export async function migrateLegacyAppData(targetDir: string, legacyDir = LEGACY_DATA_DIR): Promise<string[]> {
  const target = path.resolve(targetDir);
  const legacy = path.resolve(legacyDir);
  if (target.toLowerCase() === legacy.toLowerCase()) return [];

  await fs.mkdir(target, { recursive: true });
  const copied: string[] = [];
  const fileNames = [
    'config.json',
    'config.json.bak',
    '.env',
    'stellara.db',
    'stellara.db-wal',
    'stellara.db-shm',
  ];

  for (const fileName of fileNames) {
    const source = path.join(legacy, fileName);
    const destination = path.join(target, fileName);
    try {
      await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
      copied.push(fileName);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EEXIST') continue;
      throw error;
    }
  }

  return copied;
}
