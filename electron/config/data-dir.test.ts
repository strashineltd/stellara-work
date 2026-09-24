import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppDataDir, migrateLegacyAppData, scrubConfigBackupSecrets, setAppDataDir } from './data-dir';

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

  it('copies missing legacy files without overwriting destination data and scrubs legacy secrets', async () => {
    const legacy = await tempDir('legacy');
    const target = await tempDir('target');
    await fs.writeFile(path.join(legacy, 'config.json'), 'legacy-config');
    await fs.writeFile(path.join(legacy, '.env'), 'legacy-secret');
    await fs.writeFile(path.join(legacy, 'config.json.bak'), '{"apiKey":"sk-leak"}');
    await fs.writeFile(path.join(target, 'config.json'), 'current-config');

    const copied = await migrateLegacyAppData(target, legacy);

    expect(copied.sort()).toEqual(['.env', 'config.json.bak'].sort());
    expect(await fs.readFile(path.join(target, 'config.json'), 'utf8')).toBe('current-config');
    expect(await fs.readFile(path.join(target, '.env'), 'utf8')).toBe('legacy-secret');
    // S12：遗留目录中的密钥文件必须清除，不得留双份
    await expect(fs.access(path.join(legacy, '.env'))).rejects.toThrow();
    await expect(fs.access(path.join(legacy, 'config.json.bak'))).rejects.toThrow();
    // 非密钥恢复副本仍保留
    expect(await fs.readFile(path.join(legacy, 'config.json'), 'utf8')).toBe('legacy-config');
  });

  it('scrubs plaintext apiKey from config.json.bak', async () => {
    const dir = await tempDir('bak');
    await fs.writeFile(
      path.join(dir, 'config.json.bak'),
      JSON.stringify({ id: 'm', apiKey: 'sk-secret', label: 'x' }),
    );
    expect(await scrubConfigBackupSecrets(dir)).toBe(true);
    const text = await fs.readFile(path.join(dir, 'config.json.bak'), 'utf8');
    expect(text).not.toContain('sk-secret');
    expect(text).toContain('"label"');
  });
});
