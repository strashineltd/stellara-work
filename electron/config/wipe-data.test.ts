import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setAppDataDir } from './data-dir';
import { _setDbPath, initDb, createSession, listSessions } from '../store/db';
import { wipeAllData } from './wipe-data';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wipe-'));
  setAppDataDir(tmpDir);
  _setDbPath(path.join(tmpDir, 'stellara.db'));
});

afterEach(async () => {
  setAppDataDir(null);
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('wipeAllData', () => {
  it('deletes config/env files and re-initializes an empty database', async () => {
    initDb();
    createSession({ id: 'a', title: 'A', modelId: 'm' });
    await fs.writeFile(path.join(tmpDir, 'config.json'), '{}');
    await fs.writeFile(path.join(tmpDir, '.env'), 'OPENAI_API_KEY=sk');

    await wipeAllData();

    // 数据文件被删除
    await expect(fs.access(path.join(tmpDir, 'config.json'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, '.env'))).rejects.toThrow();
    // 数据库已重建且为空
    expect(listSessions()).toEqual([]);
  });

  it('succeeds even when the data directory does not exist yet', async () => {
    await wipeAllData();
    expect(listSessions()).toEqual([]);
  });
});
