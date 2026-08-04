import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAppDataDir } from './data-dir';

let _overrideSecretsDir: string | null = null;
const PREFIX = 'STELLARA_KEY_';
const ENC_PREFIX = 'enc:v1:';

/**
 * 密钥加密适配器（生产用 Electron safeStorage，Windows = DPAPI）。
 * secrets.ts 不直接 import electron（vitest 环境无法加载），由 main.ts 在
 * app.whenReady 后注入；测试注入可逆 fake cipher。
 */
export interface KeyCipher {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

let _cipher: KeyCipher | null = null;

/** 测试 / 主进程接线 hook：注入或清除密码器（null = 明文模式，向后兼容）。 */
export function _setCipher(cipher: KeyCipher | null): void {
  _cipher = cipher;
}

/** 加密值 → 明文；明文 → 原样返回。 */
function decodeStored(value: string): string | null {
  if (value.startsWith(ENC_PREFIX)) {
    // 加密值但无 cipher：宁可不给，不给错值
    return _cipher ? _cipher.decrypt(value.slice(ENC_PREFIX.length)) : null;
  }
  // 迁移前的明文（容错）
  return value;
}

/** 明文 → 存储值（有 cipher 加密，否则明文）。 */
function encodeStored(plain: string): string {
  return _cipher ? ENC_PREFIX + _cipher.encrypt(plain) : plain;
}

function secretsDir(): string {
  return _overrideSecretsDir ?? getAppDataDir();
}

function secretsPath(): string {
  return path.join(secretsDir(), '.env');
}

/** 测试 hook：强制使用指定目录。生产代码不要调。 */
export function _setSecretsDir(dir: string | null): void {
  _overrideSecretsDir = dir;
}

function envKeyName(modelId: string): string {
  // model id 直接作为后缀（保留大小写、连字符、点）
  // 只要不含 `=` 就行（所有 preset id 都满足）
  return PREFIX + modelId;
}

async function readEnv(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const content = await fs.readFile(secretsPath(), 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result.set(key, value);
    }
  } catch {
    // 文件不存在 → 空 map
  }
  return result;
}

async function writeEnv(map: Map<string, string>): Promise<void> {
  await fs.mkdir(secretsDir(), { recursive: true });
  const lines: string[] = [];
  for (const [k, v] of map.entries()) {
    const needsQuote = /[\s#"']/.test(v);
    lines.push(`${k}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`);
  }
  await fs.writeFile(secretsPath(), lines.join('\n') + (lines.length > 0 ? '\n' : ''), { mode: 0o600 });
}

export function getKey(modelId: string): string | null {
  try {
    const content = require('node:fs').readFileSync(secretsPath(), 'utf-8') as string;
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(envKeyName(modelId) + '=')) continue;
      const eq = trimmed.indexOf('=');
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return decodeStored(value);
    }
  } catch {
    // ignore
  }
  return null;
}

export async function setKey(modelId: string, key: string): Promise<void> {
  const map = await readEnv();
  map.set(envKeyName(modelId), encodeStored(key));
  await writeEnv(map);
}

export async function deleteKey(modelId: string): Promise<void> {
  const map = await readEnv();
  map.delete(envKeyName(modelId));
  await writeEnv(map);
}

/** ⚠️ 返回 **裸 API key**（modelId → 真实密钥）—— 仅供主进程内部使用。绝不要通过 IPC 传给 renderer。调用方请只用 `!!keys[id]` boolean check。 */
export async function listKeys(): Promise<Record<string, string>> {
  const map = await readEnv();
  const result: Record<string, string> = {};
  for (const [k, v] of map.entries()) {
    if (k.startsWith(PREFIX)) {
      const modelId = k.slice(PREFIX.length);
      const decoded = decodeStored(v);
      if (decoded !== null) result[modelId] = decoded;
    }
  }
  return result;
}

/**
 * 一次性迁移：把 .env 里仍是明文的 key 加密重写。
 * 主进程启动时调用（getKey 保持同步只读，迁移只发生在启动期）。
 * 返回迁移条数；无 cipher（明文模式）时返回 0。
 */
export async function migrateLegacyKeys(): Promise<number> {
  if (!_cipher) return 0;
  const map = await readEnv();
  let migrated = 0;
  for (const [k, v] of map.entries()) {
    if (k.startsWith(PREFIX) && !v.startsWith(ENC_PREFIX)) {
      map.set(k, encodeStored(v));
      migrated++;
    }
  }
  if (migrated > 0) await writeEnv(map);
  return migrated;
}
