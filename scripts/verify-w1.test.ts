/**
 * W1 验收脚本 - vitest 形式
 *
 * 跑通一个完整的 agent 任务：
 *   1. 读 README.md
 *   2. 在 README 末尾加一行（验证 edit_file）
 *   3. 跑 npm test（验证 run_command）
 *   4. 报告结果
 *
 * 用 vitest 跑（不用 tsx），绕开 Node 24 的 ESM 严格解析问题。
 *
 * 用法：
 *   1. 先在 ~/.stellara/.env 填 API key
 *   2. 跑 `npm run verify:w1`
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config as loadDotenv } from 'dotenv';
import { runAgentLoop } from '../electron/agent/loop';
import { invokeTool } from '../electron/agent/tools';
import { findPreset } from '../electron/llm/presets';
import { loadModelsConfig } from '../electron/config/models';
import type { ModelConfig } from '../shared/ipc';

let model: ModelConfig | null = null;
let cwd: string;

beforeAll(async () => {
  // 1. 加载 .env
  const envPath = path.join(os.homedir(), '.stellara', '.env');
  try {
    loadDotenv({ path: envPath });
  } catch {
    // ignore
  }

  // 2. 加载模型配置
  const configured = await loadModelsConfig();
  if (configured) {
    model = configured;
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    const modelId = (process.env.STELLARA_MODEL_ID ?? 'deepseek-v4-pro') as ModelConfig['id'];
    const preset = findPreset(modelId);
    if (apiKey && preset) {
      model = {
        id: preset.id,
        label: preset.label,
        baseUrl: process.env.STELLARA_BASE_URL ?? preset.baseUrl,
        model: process.env.STELLARA_MODEL_NAME ?? preset.model,
        apiKey,
        isCustom: preset.isCustom,
      };
    }
  }

  cwd = process.cwd();
});

describe('W1 verify - direct tool invocation (no LLM needed)', () => {
  it('read_file works', async () => {
    if (!cwd) return;
    const result = await invokeTool('read_file', { path: 'README.md' }, cwd);
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('write_file works', async () => {
    if (!cwd) return;
    const result = await invokeTool(
      'write_file',
      { path: '.verify-w1.tmp', content: 'test content' },
      cwd,
    );
    expect(result.ok).toBe(true);
    await fs.unlink(path.join(cwd, '.verify-w1.tmp')).catch(() => {});
  });

  it('edit_file works', async () => {
    if (!cwd) return;
    await fs.writeFile(path.join(cwd, '.verify-w1.tmp'), 'hello');
    const result = await invokeTool(
      'edit_file',
      { path: '.verify-w1.tmp', oldText: 'hello', newText: 'world' },
      cwd,
    );
    expect(result.ok).toBe(true);
    await fs.unlink(path.join(cwd, '.verify-w1.tmp')).catch(() => {});
  });

  it('search_files works', async () => {
    if (!cwd) return;
    const result = await invokeTool('search_files', { pattern: '*.md' }, cwd);
    expect(result.ok).toBe(true);
  });

  it('run_command works', async () => {
    if (!cwd) return;
    const result = await invokeTool(
      'run_command',
      { command: 'echo "W1 verify OK"', timeoutMs: 5000 },
      cwd,
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('W1 verify OK');
  });
});

describe('W1 verify - agent loop with LLM (requires API key)', () => {
  it('runs a full agent task end-to-end', async () => {
    if (!model) {
      console.log('[SKIP] No API key configured. Set OPENAI_API_KEY in ~/.stellara/.env');
      return;
    }
    if (!cwd) return;

    const task = `Please:
1. Read README.md (use read_file)
2. Append a line "## W1 verify at ${new Date().toISOString()}" to README.md (use edit_file)
3. Run \`npm test\` (use run_command)
4. Report: what you saw, what you changed, test results`;

    const events: string[] = [];
    let content = '';
    let toolCalls = 0;

    for await (const event of runAgentLoop(task, { model, cwd })) {
      if (event.type === 'content' && event.content) {
        content += event.content;
      } else if (event.type === 'tool_call') {
        toolCalls++;
        const tc = event.toolCall!;
        events.push(`tool_call: ${tc.function.name}`);
      } else if (event.type === 'tool_result') {
        const tr = event.toolResult!;
        const r = tr.result as { ok: boolean };
        events.push(`tool_result: ${tr.name} = ${r.ok ? 'OK' : 'FAIL'}`);
      } else if (event.type === 'error') {
        events.push(`error: ${event.error}`);
      } else if (event.type === 'done') {
        events.push('done');
      }
    }

    console.log(`[LLM task] tool calls: ${toolCalls}, content length: ${content.length}`);
    expect(toolCalls).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
  }, 120000);
});
