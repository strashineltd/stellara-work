import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setKey } from './secrets';

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.stellara');
let _overrideConfigDir: string | null = null;

function configDir(): string {
  return _overrideConfigDir ?? DEFAULT_CONFIG_DIR;
}

function configPath(): string {
  return path.join(configDir(), 'config.json');
}

function backupPath(): string {
  return path.join(configDir(), 'config.json.bak');
}

/** 测试 hook */
export function _setConfigDir(dir: string | null): void {
  _overrideConfigDir = dir;
}

export interface ModelEntry {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  workDir?: string;
  createdAt: string;
}

export interface AppConfig {
  activeModelId: string | null;
  models: ModelEntry[];
  app: { workDirDefault?: string };
  schemaVersion: 1;
}

function defaultConfig(): AppConfig {
  return {
    activeModelId: null,
    models: [],
    app: {},
    schemaVersion: 1,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  const path = configPath();
  try {
    const text = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(text) as AppConfig;
    if (parsed.schemaVersion !== 1) return defaultConfig();
    // 深拷贝 models / app 防止引用共享
    return {
      ...parsed,
      models: [...(parsed.models ?? [])],
      app: { ...(parsed.app ?? {}) },
    };
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function addModel(entry: ModelEntry): Promise<AppConfig> {
  const cfg = await loadConfig();
  if (cfg.models.some((m) => m.id === entry.id)) {
    throw new Error(`Model id 已存在: ${entry.id}`);
  }
  cfg.models.push(entry);
  if (!cfg.activeModelId) cfg.activeModelId = entry.id;
  await saveConfig(cfg);
  return cfg;
}

export async function removeModel(id: string): Promise<AppConfig> {
  const cfg = await loadConfig();
  cfg.models = cfg.models.filter((m) => m.id !== id);
  if (cfg.activeModelId === id) {
    cfg.activeModelId = cfg.models[0]?.id ?? null;
  }
  await saveConfig(cfg);
  return cfg;
}

export async function setActiveModel(id: string): Promise<AppConfig> {
  const cfg = await loadConfig();
  if (!cfg.models.some((m) => m.id === id)) {
    throw new Error(`Model 不存在: ${id}`);
  }
  cfg.activeModelId = id;
  await saveConfig(cfg);
  return cfg;
}

/**
 * 添加或更新一个 model，并设为 active
 * - 已存在同 id：更新字段，保留 createdAt
 * - 不存在：新增，写入当前时间
 */
export async function upsertModel(entry: ModelEntry): Promise<AppConfig> {
  const cfg = await loadConfig();
  const idx = cfg.models.findIndex((m) => m.id === entry.id);
  if (idx >= 0) {
    const existing = cfg.models[idx];
    cfg.models[idx] = {
      ...existing,
      label: entry.label,
      baseUrl: entry.baseUrl,
      model: entry.model,
      workDir: entry.workDir,
    };
  } else {
    cfg.models.push(entry);
  }
  cfg.activeModelId = entry.id;
  await saveConfig(cfg);
  return cfg;
}

export async function migrateFromV1(): Promise<boolean> {
  let old: Record<string, unknown>;
  try {
    const text = await fs.readFile(configPath(), 'utf-8');
    old = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return false;
  }
  // 旧版特征：顶层有 apiKey 字符串
  if (typeof old.apiKey !== 'string') return false;
  // 备份
  try {
    await fs.copyFile(configPath(), backupPath());
  } catch {
    // ignore
  }
  const entry: ModelEntry = {
    id: old.id as string,
    label: old.label as string,
    baseUrl: old.baseUrl as string,
    model: old.model as string,
    workDir: old.workDir as string | undefined,
    createdAt: new Date().toISOString(),
  };
  await setKey(entry.id, old.apiKey as string);
  const newCfg: AppConfig = {
    activeModelId: entry.id,
    models: [entry],
    app: {},
    schemaVersion: 1,
  };
  await saveConfig(newCfg);
  return true;
}
