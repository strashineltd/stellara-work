import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  getKey, setKey, deleteKey, listKeys, migrateLegacyKeys,
  getServerPassword, setServerPassword, getCloudSecret, setCloudSecret,
  _setSecretsDir, _setCipher, isEncryptionEnabled, type KeyCipher,
} from './secrets';

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

  it('encodes newlines so values cannot inject extra .env entries (M1)', async () => {
    await setKey('m1', 'line1\nSTELLARA_KEY_injected=evil');
    const raw = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    expect(getKey('m1')).toBe('line1\nSTELLARA_KEY_injected=evil');
    expect(getKey('injected')).toBeNull();
  });

  it('round-trips values containing quotes, backslashes, spaces and hashes (M1)', async () => {
    const value = 'a"b\\c d#e\'f';
    await setKey('m1', value);
    expect(getKey('m1')).toBe(value);
    expect(await listKeys()).toEqual({ m1: value });
  });

  it('round-trips server passwords and cloud secrets with special characters (M1)', async () => {
    await setServerPassword('srv-1', 'p"w\\d #1');
    await setCloudSecret('ACCESS_TOKEN', 'tok\nen');
    expect(getServerPassword('srv-1')).toBe('p"w\\d #1');
    expect(getCloudSecret('ACCESS_TOKEN')).toBe('tok\nen');
  });

  it('reads legacy quoted values with escaped quotes (M1)', async () => {
    await fs.writeFile(path.join(tmpDir, '.env'), 'STELLARA_KEY_legacy="old\\"quote"\n');
    expect(getKey('legacy')).toBe('old"quote');
  });

  it('reads legacy single-quoted values (M1)', async () => {
    await fs.writeFile(path.join(tmpDir, '.env'), "STELLARA_KEY_legacy='old value'\n");
    expect(getKey('legacy')).toBe('old value');
  });

  it('keeps literal backslash-n / backslash-r in legacy quoted values (P2 Windows paths)', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.env'),
      'STELLARA_KEY_winpath="C:\\new folder"\nSTELLARA_KEY_winrepo="D:\\repo\\new"\n',
    );
    expect(getKey('winpath')).toBe('C:\\new folder');
    expect(getKey('winrepo')).toBe('D:\\repo\\new');
  });

  it('still decodes escaped quotes and backslashes in legacy quoted values (P2)', async () => {
    await fs.writeFile(path.join(tmpDir, '.env'), 'STELLARA_KEY_legacy="a\\\\b\\"c"\n');
    expect(getKey('legacy')).toBe('a\\b"c');
  });

  it('rejects model ids outside [A-Za-z0-9._-] before writing (M1)', async () => {
    await expect(setKey('bad id', 'sk-x')).rejects.toThrow();
    await expect(setKey('bad\nid', 'sk-x')).rejects.toThrow();
    await expect(fs.readFile(path.join(tmpDir, '.env'), 'utf-8')).rejects.toThrow();
  });

  it('rejects invalid server ids and cloud secret names before writing (M1)', async () => {
    await expect(setServerPassword('bad id', 'pw')).rejects.toThrow();
    await expect(setCloudSecret('BAD NAME', 'tok')).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('tightens .env permissions to 0600 on rewrite (M4)', async () => {
    const envPath = path.join(tmpDir, '.env');
    await fs.writeFile(envPath, 'STELLARA_KEY_old=sk-old\n');
    await fs.chmod(envPath, 0o644);
    await setKey('m1', 'sk-new');
    expect((await fs.stat(envPath)).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp file behind after writing (M4)', async () => {
    await setKey('m1', 'sk-new');
    expect(await fs.readdir(tmpDir)).toEqual(['.env']);
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

  it('migrateLegacyKeys encrypts KEY/SERVER/CLOUD values but not the publishable key (M2)', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.env'),
      [
        'STELLARA_KEY_openai=sk-legacy',
        'STELLARA_SERVER_srv=server-legacy',
        'STELLARA_CLOUD_ACCESS_TOKEN=cloud-legacy',
        'STELLARA_CLOUDBASE_PUBLISHABLE_KEY=pk-public',
      ].join('\n') + '\n',
    );

    expect(await migrateLegacyKeys()).toBe(3);

    expect(getKey('openai')).toBe('sk-legacy');
    expect(getServerPassword('srv')).toBe('server-legacy');
    expect(getCloudSecret('ACCESS_TOKEN')).toBe('cloud-legacy');
    const raw = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    expect(raw).not.toContain('sk-legacy');
    expect(raw).not.toContain('server-legacy');
    expect(raw).not.toContain('cloud-legacy');
    expect(raw).toContain('pk-public');
    expect(await migrateLegacyKeys()).toBe(0);
  });

  it('round-trips encrypted values containing newlines on a single line (M1)', async () => {
    await setKey('m1', 'line1\nline2');
    expect(getKey('m1')).toBe('line1\nline2');
    const raw = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    expect(raw.split('\n').filter((line) => line.trim() !== '')).toHaveLength(1);
  });
});

describe('isEncryptionEnabled', () => {
  it('未注入 cipher 时为 false（明文降级）', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('注入 cipher 后为 true', () => {
    _setCipher(fakeCipher);
    expect(isEncryptionEnabled()).toBe(true);
  });
});
