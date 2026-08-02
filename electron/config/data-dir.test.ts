import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppDataDir, migrateLegacyAppData, setAppDataDir } from './data-dir';

const tempDirs: string[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `stellara-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  setAppDataDir(null);
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('standard application data directory', () => {
  it('uses the runtime Electron userData directory when configured', async () => {
    const dir = await tempDir('userdata');
    setAppDataDir(dir);
    expect(getAppDataDir()).toBe(path.resolve(dir));
  });

  it('copies missing legacy files without overwriting destination data', async () => {
    const legacy = await tempDir('legacy');
    const target = await tempDir('target');
    await fs.writeFile(path.join(legacy, 'config.json'), 'legacy-config');
    await fs.writeFile(path.join(legacy, '.env'), 'legacy-secret');
    await fs.writeFile(path.join(target, 'config.json'), 'current-config');

    const copied = await migrateLegacyAppData(target, legacy);

    expect(copied).toEqual(['.env']);
    expect(await fs.readFile(path.join(target, 'config.json'), 'utf8')).toBe('current-config');
    expect(await fs.readFile(path.join(target, '.env'), 'utf8')).toBe('legacy-secret');
    expect(await fs.readFile(path.join(legacy, 'config.json'), 'utf8')).toBe('legacy-config');
  });
});
