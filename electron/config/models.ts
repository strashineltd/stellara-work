import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ModelConfig } from '../../shared/ipc';
import { getAppDataDir } from './data-dir';

function configPath(): string {
  return path.join(getAppDataDir(), 'config.json');
}

/**
 * 加载当前活跃的 model 配置（v2 + secrets）
 * - 老 v1 格式（顶层有 apiKey）也兼容，v2 启动时会自动迁移
 * - 找不到或没活跃 model → 返回 null
 */
export async function loadModelsConfig(): Promise<ModelConfig | null> {
  try {
    const text = await fs.readFile(configPath(), 'utf-8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    // v2 格式
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.models)) {
      const activeModelId = parsed.activeModelId as string | null;
      const active = (parsed.models as Array<Record<string, unknown>>).find(
        (m) => m.id === activeModelId,
      );
      if (!active) return null;
      // 读 .env 拿 key
      const { getKey } = await import('./secrets');
      const key = getKey(active.id as string) ?? '';
      return {
        id: active.id as ModelConfig['id'],
        label: active.label as string,
        baseUrl: active.baseUrl as string,
        model: active.model as string,
        apiKey: key,
        workDir: active.workDir as string | undefined,
        isCustom: false,
      };
    }
    // v1 格式（兜底，正常情况下启动时已迁走）
    return parsed as unknown as ModelConfig;
  } catch {
    return null;
  }
}

/**
 * 保存模型配置（v1 兼容用，新代码走 config-v2.addModel / saveConfig）
 */
export async function saveModelConfig(config: ModelConfig): Promise<void> {
  await fs.mkdir(getAppDataDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}
