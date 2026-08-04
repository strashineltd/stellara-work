import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getKey, setKey, deleteKey, listKeys, migrateLegacyKeys, _setSecretsDir, _setCipher, type KeyCipher } from './secrets';

/** 可逆的 fake cipher：前缀 X + base64（仅测试用，生产用 safeStorage） */
const fakeCipher: KeyCipher = {
  encrypt: (s) => `X${Buffer.from(s, 'utf-8').toString('base64')}`,
  decrypt: (b) => Buffer.from(b.slice(1), 'base64').toString('utf-8'),
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-secrets-'));
  _setSecretsDir(tmpDir);
  _setCipher(null);
});

afterEach(async () => {
  _setCipher(null);
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

describe('secrets with cipher (safeStorage mode)', () => {
  beforeEach(() => {
    _setCipher(fakeCipher);
  });

  it('setKey/getKey round-trips through the cipher', async () => {
    await setKey('deepseek-v4-pro', 'sk-secret-456');
    expect(getKey('deepseek-v4-pro')).toBe('sk-secret-456');
  });

  it('stores the value encrypted with the enc:v1: prefix, never plaintext', async () => {
    await setKey('deepseek-v4-pro', 'sk-plain-should-not-appear');
    const raw = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('sk-plain-should-not-appear');
  });

  it('getKey returns null for an encrypted value when no cipher is available', async () => {
    await setKey('deepseek-v4-pro', 'sk-secret');
    _setCipher(null);
    expect(getKey('deepseek-v4-pro')).toBeNull();
  });

  it('listKeys decrypts all entries', async () => {
    await setKey('a', 'k-a');
    await setKey('b', 'k-b');
    expect(await listKeys()).toEqual({ a: 'k-a', b: 'k-b' });
  });

  it('deleteKey removes the encrypted entry', async () => {
    await setKey('m1', 'sk-x');
    await deleteKey('m1');
    expect(getKey('m1')).toBeNull();
  });

  it('migrateLegacyKeys converts existing plaintext entries to encrypted form', async () => {
    // 预写一条旧版明文 key
    await fs.writeFile(path.join(tmpDir, '.env'), 'STELLARA_KEY_legacy=sk-legacy-plain\n');
    const migrated = await migrateLegacyKeys();
    expect(migrated).toBe(1);
    expect(getKey('legacy')).toBe('sk-legacy-plain');
    const raw = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('sk-legacy-plain');
  });

  it('migrateLegacyKeys returns 0 when everything is already encrypted', async () => {
    await setKey('a', 'k-a');
    const migrated = await migrateLegacyKeys();
    expect(migrated).toBe(0);
  });
});
