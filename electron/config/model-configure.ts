import type { ModelConfig } from '../../shared/ipc';

export interface ConfigureResult {
  ok: boolean;
  error?: string;
  errorKind?: string;
}

/**
 * 配置一个模型（models:configure 处理器）。
 *
 * - 提供新 apiKey 时：先做连接测试，不通过则不写入（与 UI 文案一致）。
 * - 留空 apiKey：保留旧 key —— 不测试、不覆盖（models:list 只下发 hasKey，
 *   渲染进程拿不到旧 key，重配置留空即表示"用原来的"）。
 */
export async function configureModel(config: ModelConfig): Promise<ConfigureResult> {
  if (config.apiKey) {
    const { OpenAICompatClient } = await import('../llm/openai-compat');
    const client = new OpenAICompatClient(config);
    const test = await client.testConnection();
    if (!test.ok) {
      return { ok: false, error: `连接测试未通过，配置未写入：${test.error ?? '未知错误'}` };
    }
  }

  const { findPreset } = await import('../llm/presets');
  const { upsertModel } = await import('./config-v2');
  const { setKey } = await import('./secrets');

  const preset = findPreset(config.id);
  const entry = {
    id: config.id,
    label: config.label,
    baseUrl: config.baseUrl || preset?.baseUrl || '',
    model: config.model || preset?.model || '',
    workDir: config.workDir,
    createdAt: new Date().toISOString(),
  };
  await upsertModel(entry);
  if (config.apiKey) {
    await setKey(config.id, config.apiKey);
  }
  return { ok: true };
}
