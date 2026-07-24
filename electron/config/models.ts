import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ModelConfig } from '../../shared/ipc';

const CONFIG_DIR = path.join(os.homedir(), '.stellara');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/**
 * 加载当前配置的模型（v0.9 简化：只支持单个 model 配置）
 */
export async function loadModelsConfig(): Promise<ModelConfig | null> {
  try {
    const text = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(text) as ModelConfig;
  } catch {
    return null;
  }
}

/**
 * 保存模型配置
 */
export async function saveModelConfig(config: ModelConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}
