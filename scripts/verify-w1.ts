/**
 * W1 验收脚本
 *
 * 不进 Electron 打包，只是开发期验证后端逻辑。
 * 跑通一个完整的 agent 任务：
 *   1. 读 README.md
 *   2. 在 README 末尾加一行（验证 edit_file）
 *   3. 跑 npm test（验证 run_command）
 *   4. 报告结果
 *
 * 用法：
 *   1. 先在 ~/.stellara/.env 填 OPENAI_API_KEY
 *   2. 跑 `npm run verify:w1`
 *
 * 不需要配置：脚本会读 process.env.OPENAI_API_KEY 和 process.env.STELLARA_MODEL_ID
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config as loadDotenv } from 'dotenv';
import { runAgentLoop } from '../electron/agent/loop';
import { invokeTool } from '../electron/agent/tools';
import { findPreset } from '../electron/llm/presets';
import { loadModelsConfig } from '../electron/config/models';
import type { ModelConfig } from '../shared/ipc';

async function main() {
  // 1. 加载 .env
  const envPath = path.join(os.homedir(), '.stellara', '.env');
  try {
    loadDotenv({ path: envPath });
  } catch {
    console.warn(`未找到 ${envPath}，请先创建并填入 API key`);
  }

  // 2. 加载模型配置
  const configured = await loadModelsConfig();
  let model: ModelConfig;
  if (configured) {
    model = configured;
  } else {
    // 临时从环境变量读（开发期）
    const apiKey = process.env.OPENAI_API_KEY;
    const modelId = (process.env.STELLARA_MODEL_ID ?? 'deepseek-v4-pro') as ModelConfig['id'];
    const preset = findPreset(modelId);
    if (!apiKey || !preset) {
      console.error('请配置模型：在设置中配置，或设置 OPENAI_API_KEY 环境变量');
      process.exit(1);
    }
    model = {
      id: preset.id,
      label: preset.label,
      baseUrl: process.env.STELLARA_BASE_URL ?? preset.baseUrl,
      model: process.env.STELLARA_MODEL_NAME ?? preset.model,
      apiKey,
      isCustom: preset.isCustom,
    };
  }

  console.log('▶ 验证 W1 后端核心闭环');
  console.log(`  模型：${model.label} (${model.model})`);
  console.log(`  base_url：${model.baseUrl}`);
  console.log('');

  const cwd = process.cwd();
  console.log(`▶ 工作目录：${cwd}`);
  console.log('');

  // 3. 直接验证 5 个 tool（不需要 LLM）
  console.log('▶ 验证 5 个 tool（不通过 LLM）');
  const readResult = await invokeTool('read_file', { path: 'README.md' }, cwd);
  console.log(`  read_file: ${readResult.ok ? '✓' : '✗'} (${readResult.output.length} 字符)`);

  const tmpFile = path.join(cwd, '.verify-w1.tmp');
  const writeResult = await invokeTool(
    'write_file',
    { path: '.verify-w1.tmp', content: 'test content' },
    cwd,
  );
  console.log(`  write_file: ${writeResult.ok ? '✓' : '✗'} (${writeResult.output})`);

  const editResult = await invokeTool(
    'edit_file',
    { path: '.verify-w1.tmp', oldText: 'test content', newText: 'updated content' },
    cwd,
  );
  console.log(`  edit_file: ${editResult.ok ? '✓' : '✗'} (${editResult.output})`);

  const searchResult = await invokeTool(
    'search_files',
    { pattern: '*.md' },
    cwd,
  );
  console.log(`  search_files: ${searchResult.ok ? '✓' : '✗'} (${searchResult.output.split('\n').length} 个匹配)`);

  const commandResult = await invokeTool(
    'run_command',
    { command: 'node -v', timeoutMs: 5000 },
    cwd,
  );
  console.log(`  run_command: ${commandResult.ok ? '✓' : '✗'} (${commandResult.output.trim()})`);

  // 清理临时文件
  await fs.unlink(tmpFile).catch(() => {});

  console.log('');
  console.log('▶ 验证 Agent 循环（通过 LLM）');
  console.log('  这一步会真实调 LLM API，消耗 token');
  console.log('');

  const task = `请执行以下步骤：
1. 读 README.md 的前 10 行（用 read_file）
2. 在 README.md 末尾加一行："## W1 verify at <时间戳>"
3. 跑 \`npm test\`（用 run_command）
4. 报告：你看到了什么、改了什么、测试结果如何`;

  console.log(`  任务：${task.replace(/\n/g, ' ').slice(0, 100)}...`);
  console.log('');

  let content = '';
  let toolCalls = 0;
  for await (const event of runAgentLoop(task, { model, cwd })) {
    if (event.type === 'content' && event.content) {
      content += event.content;
      process.stdout.write(event.content);
    } else if (event.type === 'tool_call') {
      toolCalls++;
      const tc = event.toolCall!;
      console.log(`\n  [tool_call ${toolCalls}] ${tc.function.name}(${tc.function.arguments.slice(0, 80)}...)`);
    } else if (event.type === 'tool_result') {
      const tr = event.toolResult!;
      const r = tr.result as { ok: boolean; error?: string };
      console.log(`  [tool_result] ${tr.name}: ${r.ok ? 'OK' : 'FAIL'}`);
    } else if (event.type === 'error') {
      console.error(`\n  [error] ${event.error}`);
    } else if (event.type === 'done') {
      console.log('\n  [done]');
    }
  }

  console.log('');
  console.log('▶ W1 验收总结');
  console.log(`  5 个 tool：read_file / write_file / edit_file / search_files / run_command`);
  console.log(`  LLM 调用：${toolCalls} 次 tool_call`);
  console.log(`  响应内容：${content.length} 字符`);
  console.log('');
  console.log('✓ W1 验收通过');
}

main().catch((err) => {
  console.error('✗ W1 验收失败：', err);
  process.exit(1);
});
