import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setKey } from './secrets';
import { getAppDataDir } from './data-dir';
import type { ThemeName, McpServerConfig, WireApi } from '../../shared/ipc';

let _overrideConfigDir: string | null = null;

/** 域名规范化：小写、去协议/路径/端口/尾点；非法返回 null */
export function normalizeAllowlistDomain(input: string): string | null {
  let d = (input ?? '').trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0]!.split(':')[0]!.replace(/\.$/, '');
  if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}

/** 整批规范化：空项剔除、去重；任一项非法返回 null */
export function normalizeAllowlist(list: string[]): string[] | null {
  const out: string[] = [];
  for (const raw of list) {
    const d = normalizeAllowlistDomain(raw);
    if (d === null) {
      if (!(raw ?? '').trim()) continue;
      return null;
    }
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function configDir(): string {
  return _overrideConfigDir ?? getAppDataDir();
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
  /** 模型上下文窗口（token 数）。默认 256000；用户在 onboarding / settings 选 256K/512K/1M */
  contextWindow?: number;
  // v0.9.2 新增：Responses API 相关字段
  /** 协议类型：Responses（默认）或 Anthropic Messages。 */
  wireApi?: WireApi;
  /** 最大输出 token（供应商支持时生效） */
  maxOutputTokens?: number;
  /** reasoning effort（low/medium/high，供应商支持时生效） */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** 兼容状态：verified=已通过 Responses 验证，unverified=未验证，incompatible=不兼容 */
  compatibility?: 'verified' | 'unverified' | 'incompatible';
  /** 最后验证时间 */
  verifiedAt?: string;
}

export interface AppConfig {
  activeModelId: string | null;
  models: ModelEntry[];
  app: {
    workDirDefault?: string;
    shortcuts?: Partial<Record<string, string>>;
    theme?: ThemeName;
    workspaceMode?: 'sidebar' | 'tabs';
    browser?: {
      searchProvider?: 'auto' | 'duck' | 'tavily' | 'brave';
      execJsEnabled?: boolean;
      loginAllowlist?: string[];
    };
  };
  mcpServers: McpServerConfig[];
  schemaVersion: 1;
}

function defaultConfig(): AppConfig {
  return {
    activeModelId: null,
    models: [],
    app: {},
    mcpServers: [],
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
      // 深拷贝 mcpServers，兼容旧配置无此字段
      mcpServers: [...(parsed.mcpServers ?? [])],
    };
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  const tmpPath = configPath() + '.tmp';
  // 原子写入：先写临时文件，再 rename（防止崩溃损坏）
  await fs.writeFile(tmpPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await fs.rename(tmpPath, configPath());
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
      contextWindow: entry.contextWindow,
      wireApi: entry.wireApi ?? existing?.wireApi ?? 'responses',
      maxOutputTokens: entry.maxOutputTokens ?? existing?.maxOutputTokens,
      reasoningEffort: entry.reasoningEffort ?? existing?.reasoningEffort,
      compatibility: entry.compatibility ?? existing?.compatibility,
      verifiedAt: entry.verifiedAt ?? existing?.verifiedAt,
    };
  } else {
    cfg.models.push(entry);
  }
  cfg.activeModelId = entry.id;
  await saveConfig(cfg);
  return cfg;
}

/**
 * 只更新 contextWindow
 */
export async function updateContextWindow(id: string, contextWindow: number): Promise<void> {
  const cfg = await loadConfig();
  const idx = cfg.models.findIndex((m) => m.id === id);
  if (idx < 0) throw new Error(`Model 不存在: ${id}`);
  cfg.models[idx] = { ...cfg.models[idx]!, contextWindow };
  await saveConfig(cfg);
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

  // 根据模型 ID 确定兼容性
  const modelId = old.id as string;
  let compatibility: ModelEntry['compatibility'] = 'unverified';
  if (modelId.startsWith('deepseek')) {
    // DeepSeek 已知支持 Responses，标记为待复验
    compatibility = 'unverified';
  } else if (modelId.startsWith('glm') || modelId.startsWith('kimi') || modelId.startsWith('minimax')) {
    // GLM/Kimi/MiniMax 暂不支持 Responses，标记为不兼容
    compatibility = 'incompatible';
  } else {
    // 自定义模型，待验证
    compatibility = 'unverified';
  }

  const entry: ModelEntry = {
    id: modelId,
    label: old.label as string,
    baseUrl: old.baseUrl as string,
    model: old.model as string,
    workDir: old.workDir as string | undefined,
    createdAt: new Date().toISOString(),
    wireApi: 'responses',
    compatibility,
  };
  await setKey(entry.id, old.apiKey as string);
  const newCfg: AppConfig = {
    activeModelId: entry.id,
    models: [entry],
    app: {},
    mcpServers: [],
    schemaVersion: 1,
  };
  await saveConfig(newCfg);
  return true;
}
