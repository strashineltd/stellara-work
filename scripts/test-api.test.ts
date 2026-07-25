/**
 * 临时诊断脚本：直接调 LLM API 看 key 是否有效
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OpenAICompatClient } from '../electron/llm/openai-compat';
import type { ModelConfig } from '../shared/ipc';

describe('diagnose: API key connectivity', () => {
  it('loads config.json and tests connection', async () => {
    const configPath = path.join(os.homedir(), '.stellara', 'config.json');
    const text = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(text) as ModelConfig;
    console.log(`[diag] model: ${config.label} (${config.model})`);
    console.log(`[diag] baseUrl: ${config.baseUrl}`);
    console.log(`[diag] apiKey: ${config.apiKey.slice(0, 7)}...${config.apiKey.slice(-4)}`);

    const client = new OpenAICompatClient(config);
    const result = await client.testConnection();
    console.log(`[diag] result: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
  }, 30000);
});
