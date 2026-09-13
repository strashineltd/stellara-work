import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getAppDataDir } from './data-dir';
import { isSecretEnvKey } from './env';
import { bestEffortChmod } from '../security/file-permissions';

let _overrideSecretsDir: string | null = null;
const PREFIX = 'STELLARA_KEY_';
const SERVER_PREFIX = 'STELLARA_SERVER_';
const CLOUD_PREFIX = 'STELLARA_CLOUD_';
const ENC_PREFIX = 'enc:v1:';

/**
 * 键后缀白名单（M1）：不允许换行、`=`、引号等会破坏 .env 结构的字符。
 * 模型 id / 服务器 id / 云密钥位名都必须满足。
 */
const SUFFIX_RE = /^[A-Za-z0-9._-]+$/;

function assertValidSuffix(kind: string, suffix: string): void {
  if (typeof suffix !== 'string' || !SUFFIX_RE.test(suffix)) {
    throw new Error(`非法${kind}：${JSON.stringify(suffix)}（只允许字母、数字、点、下划线、连字符）`);
  }
}

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
  // model id 直接作为后缀（保留大小写、连字符、点）；写入前由 setKey 校验
  return PREFIX + modelId;
}

// ============================================
// .env 值编码（M1）
// ============================================
//
// 写入规则：
// - 值为安全字符（不含空白 / `#` / 引号）时原样写；
// - 否则用双引号包裹并转义 `\` `"` `\r` `\n`，保证一个值永远只占一行。
// 读取规则（兼容历史格式）：
// - 双引号值按上述转义反解（未知转义按字面量保留）；
// - 单引号值只去引号（旧实现即如此）；
// - 其余原样。

function needsQuoting(value: string): boolean {
  return /[\s#"']/.test(value);
}

function quoteValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function unquoteValue(quoted: string): string {
  const inner = quoted.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1]!;
      if (next === '\\' || next === '"') {
        out += next;
        i++;
        continue;
      }
      if (next === 'n') {
        out += '\n';
        i++;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function decodeEnvValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return unquoteValue(value);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

/** 解析 .env 文本 → 存储值 map（同键以首次出现为准，保持旧行为）。 */
function parseEnvContent(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (result.has(key)) continue;
    result.set(key, decodeEnvValue(trimmed.slice(eq + 1)));
  }
  return result;
}

/** 同步读一个存储值（只读，不做迁移/写入）。 */
function readStoredSync(name: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const content = require('node:fs').readFileSync(secretsPath(), 'utf-8') as string;
    const value = parseEnvContent(content).get(name);
    return value === undefined ? null : decodeStored(value);
  } catch {
    // ignore
  }
  return null;
}

async function readEnv(): Promise<Map<string, string>> {
  const envPath = secretsPath();
  // M4：读取/加载时顺手收紧既有文件的权限（best-effort）
  await bestEffortChmod(envPath, 0o600);
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    return parseEnvContent(content);
  } catch {
    // 文件不存在 → 空 map
    return new Map();
  }
}

async function writeEnv(map: Map<string, string>): Promise<void> {
  const dir = secretsDir();
  await fs.mkdir(dir, { recursive: true });
  const lines: string[] = [];
  for (const [k, v] of map.entries()) {
    lines.push(`${k}=${needsQuoting(v) ? quoteValue(v) : v}`);
  }
  const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
  const target = secretsPath();
  // M4：临时文件 + rename 原子替换，失败清理临时文件；每次写后 0600
  const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o600 });
    await bestEffortChmod(tmp, 0o600);
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await bestEffortChmod(target, 0o600);
}

export function getKey(modelId: string): string | null {
  return readStoredSync(envKeyName(modelId));
}

export async function setKey(modelId: string, key: string): Promise<void> {
  assertValidSuffix('模型 ID', modelId);
  const name = envKeyName(modelId);
  const map = await readEnv();
  map.set(name, encodeStored(key));
  await writeEnv(map);
}

export async function deleteKey(modelId: string): Promise<void> {
  const map = await readEnv();
  map.delete(envKeyName(modelId));
  await writeEnv(map);
}

// ============================================
// 通用密钥位（云会话凭证等非模型密钥用）
// ============================================

/**
 * 与 STELLARA_KEY_ 分开的命名空间，避免与模型密钥的列举逻辑互相污染
 * （listKeys 只扫 STELLARA_KEY_ 前缀，不会读到这里的值）。
 *
 * 云会话 token 一律经此写入，因此天然走同一个 cipher（safeStorage / DPAPI），
 * 且不存在需要迁移的历史明文。
 */
function cloudKeyName(name: string): string {
  return CLOUD_PREFIX + name;
}

/** 同步读取一个密钥位（与 getKey 同模式：只读，不做写入） */
export function getCloudSecret(name: string): string | null {
  return readStoredSync(cloudKeyName(name));
}

export async function setCloudSecret(name: string, value: string): Promise<void> {
  assertValidSuffix('云密钥位名', name);
  const storageKey = cloudKeyName(name);
  const map = await readEnv();
  map.set(storageKey, encodeStored(value));
  await writeEnv(map);
}

export async function deleteCloudSecret(name: string): Promise<void> {
  const map = await readEnv();
  map.delete(cloudKeyName(name));
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

function serverKeyName(serverId: string): string {
  return SERVER_PREFIX + serverId;
}

export async function setServerPassword(serverId: string, password: string): Promise<void> {
  assertValidSuffix('服务器 ID', serverId);
  const map = await readEnv();
  map.set(serverKeyName(serverId), encodeStored(password));
  await writeEnv(map);
}

/** ⚠️ 返回 **裸服务器密码** —— 仅供主进程内部使用（连接服务器），绝不要通过 IPC 传给 renderer。 */
export function getServerPassword(serverId: string): string | null {
  return readStoredSync(serverKeyName(serverId));
}

export async function deleteServerPassword(serverId: string): Promise<void> {
  const map = await readEnv();
  map.delete(serverKeyName(serverId));
  await writeEnv(map);
}

/**
 * 一次性迁移：把 .env 里仍是明文的所有密钥（M2：STELLARA_KEY_ /
 * STELLARA_SERVER_ / STELLARA_CLOUD_ 以及 *_TOKEN/_SECRET/_PASSWORD/_API_KEY
 * 等密钥型键名）加密重写；`STELLARA_CLOUDBASE_PUBLISHABLE_KEY` 官方定位为可
 * 暴露的公开 Key，保持明文。
 * 主进程启动时调用（getKey 保持同步只读，迁移只发生在启动期）。
 * 返回迁移条数；无 cipher（明文模式）时返回 0；幂等。
 */
export async function migrateLegacyKeys(): Promise<number> {
  if (!_cipher) return 0;
  const map = await readEnv();
  let migrated = 0;
  for (const [k, v] of map.entries()) {
    if (isSecretEnvKey(k) && !v.startsWith(ENC_PREFIX)) {
      map.set(k, encodeStored(v));
      migrated++;
    }
  }
  if (migrated > 0) await writeEnv(map);
  return migrated;
}
