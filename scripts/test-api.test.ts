/**
 * 临时诊断脚本：直接调 LLM API 看 key 是否有效
 * 需要真实 API key 和网络才能通过。缺少条件时显式 skip。
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { OpenAICompatClient } from '../electron/llm/openai-compat';
import type { ModelConfig } from '../shared/ipc';

// Real providers are intentionally opt-in. Unit tests must not require a
// personal key or network access, and must never print any portion of a key.
const describeIntegration = process.env.STELLARA_RUN_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('diagnose: API key connectivity', () => {
  it('loads config and tests connection', async () => {
    // 使用 v2 config API 加载配置
    const { _setConfigDir, loadConfig } = await import('../electron/config/config-v2');
    const { _setSecretsDir, getKey } = await import('../electron/config/secrets');

    const configDir = path.join(os.homedir(), '.stellara');
    _setConfigDir(configDir);
    _setSecretsDir(configDir);

    const cfg = await loadConfig();
    const active = cfg.models.find((m) => m.id === cfg.activeModelId);
    if (!active) {
      console.log('[SKIP] No active model configured');
      return;
    }

    const apiKey = getKey(active.id);
    if (!apiKey) {
      console.log('[SKIP] No API key for active model');
      return;
    }

    const config: ModelConfig = {
      id: active.id as ModelConfig['id'],
      label: active.label,
      baseUrl: active.baseUrl,
      model: active.model,
      apiKey,
      workDir: active.workDir,
      isCustom: false,
    };

    console.log(`[diag] model: ${config.label} (${config.model})`);
    console.log(`[diag] baseUrl: ${config.baseUrl}`);
    const client = new OpenAICompatClient(config);
    const result = await client.testConnection();
    console.log(`[diag] result: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
  }, 30000);
});
