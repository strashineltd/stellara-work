import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getKey, setKey, deleteKey, listKeys, _setSecretsDir } from './secrets';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-secrets-'));
  _setSecretsDir(tmpDir);
});

afterEach(async () => {
  _setSecretsDir(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('secrets', () => {
  it('setKey + getKey round-trips', async () => {
    await setKey('deepseek-v4-pro', 'sk-test-123');
    expect(getKey('deepseek-v4-pro')).toBe('sk-test-123');
  });

  it('getKey returns null for missing key', () => {
    expect(getKey('missing')).toBeNull();
  });

  it('deleteKey removes the entry', async () => {
    await setKey('glm-5.2', 'sk-x');
    await deleteKey('glm-5.2');
    expect(getKey('glm-5.2')).toBeNull();
  });

  it('listKeys returns all keys', async () => {
    await setKey('a', 'k-a');
    await setKey('b', 'k-b');
    const all = await listKeys();
    expect(all).toEqual({ a: 'k-a', b: 'k-b' });
  });

  it('model id with dots/dashes round-trips', async () => {
    await setKey('glm-5.2', 'sk-glm');
    expect(getKey('glm-5.2')).toBe('sk-glm');
    const all = await listKeys();
    expect(all['glm-5.2']).toBe('sk-glm');
  });

  it('update existing key overwrites', async () => {
    await setKey('m1', 'old');
    await setKey('m1', 'new');
    expect(getKey('m1')).toBe('new');
  });

  it('.env file is created at STELLARA_DIR/.env', async () => {
    await setKey('test', 'k');
    const envPath = path.join(tmpDir, '.env');
    const stat = await fs.stat(envPath);
    expect(stat.isFile()).toBe(true);
  });
});
