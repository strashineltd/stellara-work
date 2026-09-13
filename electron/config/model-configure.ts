import type { ModelConfig } from '../../shared/ipc';
import { assertWorkDirGranted } from '../security/workdir-grants';

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
 * - 提供 workDir 时：必须已由原生选择器授权，防止渲染层借配置种子化工作区白名单。
 */
export async function configureModel(config: ModelConfig): Promise<ConfigureResult> {
  if (typeof config.workDir === 'string' && config.workDir.trim()) {
    try {
      await assertWorkDirGranted(config.workDir);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (config.apiKey) {
    const { testModelConnection } = await import('../llm/client-factory');
    const test = await testModelConnection(config);
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
    contextWindow: config.contextWindow,
    wireApi: config.wireApi ?? preset?.wireApi ?? 'responses',
    maxOutputTokens: config.maxOutputTokens ?? preset?.maxOutputTokens,
    reasoningEffort: config.reasoningEffort === 'max' ? 'high' : config.reasoningEffort,
    compatibility: 'verified' as const,
    verifiedAt: config.apiKey ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
  };
  await upsertModel(entry);
  if (config.apiKey) {
    await setKey(config.id, config.apiKey);
  }
  return { ok: true };
}

/**
 * 更新某个模型的工作目录（models:updateWorkDir 处理器）。
 * 路径必须已由原生选择器授权，防止渲染层任意读写。
 */
export async function updateModelWorkDir(modelId: string, workDir: string): Promise<void> {
  await assertWorkDirGranted(workDir);
  const { loadConfig, saveConfig } = await import('./config-v2');
  const cfg = await loadConfig();
  const idx = cfg.models.findIndex((m) => m.id === modelId);
  if (idx < 0) throw new Error(`Model 不存在: ${modelId}`);
  cfg.models[idx] = { ...cfg.models[idx]!, workDir };
  await saveConfig(cfg);
}
