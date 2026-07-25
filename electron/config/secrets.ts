import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_SECRETS_DIR = path.join(os.homedir(), '.stellara');
let _overrideSecretsDir: string | null = null;
const PREFIX = 'STELLARA_KEY_';

function secretsDir(): string {
  return _overrideSecretsDir ?? DEFAULT_SECRETS_DIR;
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
      return value || null;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function setKey(modelId: string, key: string): Promise<void> {
  const map = await readEnv();
  map.set(envKeyName(modelId), key);
  await writeEnv(map);
}

export async function deleteKey(modelId: string): Promise<void> {
  const map = await readEnv();
  map.delete(envKeyName(modelId));
  await writeEnv(map);
}

export async function listKeys(): Promise<Record<string, string>> {
  const map = await readEnv();
  const result: Record<string, string> = {};
  for (const [k, v] of map.entries()) {
    if (k.startsWith(PREFIX)) {
      const modelId = k.slice(PREFIX.length);
      result[modelId] = v;
    }
  }
  return result;
}
