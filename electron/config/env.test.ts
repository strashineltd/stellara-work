import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setAppDataDir } from './data-dir';
import { loadEnv } from './env';

const TEST_KEYS = [
  'STELLARA_KEY_openai',
  'STELLARA_SERVER_srv',
  'STELLARA_CLOUD_session',
  'STELLARA_CLOUDBASE_PUBLISHABLE_KEY',
  'SOME_TOKEN',
  'NORMAL_FLAG',
];

describe('loadEnv secret filtering (H5)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-env-'));
    setAppDataDir(tmpDir);
    for (const key of TEST_KEYS) delete process.env[key];
  });

  afterEach(async () => {
    setAppDataDir(null);
    for (const key of TEST_KEYS) delete process.env[key];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads non-secret vars but keeps STELLARA_* secrets out of process.env', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.env'),
      [
        'STELLARA_KEY_openai=sk-secret',
        'STELLARA_SERVER_srv=server-pw',
        'STELLARA_CLOUD_session=cloud-token',
        'STELLARA_CLOUDBASE_PUBLISHABLE_KEY=pk-public',
        'SOME_TOKEN=tok',
        'NORMAL_FLAG=1',
      ].join('\n'),
    );

    await loadEnv();

    expect(process.env.STELLARA_KEY_openai).toBeUndefined();
    expect(process.env.STELLARA_SERVER_srv).toBeUndefined();
    expect(process.env.STELLARA_CLOUD_session).toBeUndefined();
    expect(process.env.SOME_TOKEN).toBeUndefined();
    expect(process.env.STELLARA_CLOUDBASE_PUBLISHABLE_KEY).toBe('pk-public');
    expect(process.env.NORMAL_FLAG).toBe('1');
  });
});
