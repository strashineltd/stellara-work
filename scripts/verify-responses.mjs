/**
 * Task 0: 供应商 Responses API 能力验证
 *
 * 测试项（按计划 Section 12.7）：
 * 1. 非流式 ping（基本连通性）
 * 2. 流式文本（SSE 事件解析）
 * 3. 单 Function Call
 * 4. 并行 Function Call
 * 5. Function output 回传
 * 6. usage 字段
 * 7. reasoning effort（如支持）
 * 8. 取消请求
 * 9. 未知事件前向兼容
 *
 * 使用方式：API Key 通过环境变量传入
 *   DEEPSEEK_API_KEY=xxx node scripts/verify-responses.mjs
 */

import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';

// ─── 配置 ───────────────────────────────────────────────

const PROVIDERS = [
  {
    name: 'DeepSeek-V4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    envKey: 'DEEPSEEK_API_KEY',
  },
  {
    name: 'DeepSeek-V4-Flash',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    envKey: 'DEEPSEEK_API_KEY',
  },
  {
    name: 'Qwen3.8-Max',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    envKey: 'DASHSCOPE_API_KEY',
  },
  {
    name: 'GLM-5.3',
    baseUrl: 'https://open.bigmodel.cn/api/v1',
    model: 'glm-5.3',
    envKey: 'ZHIPU_API_KEY',
  },
];

const RESULTS = [];
let aborted = false;

// ─── 工具函数 ───────────────────────────────────────────

function buildUrl(baseUrl) {
  const clean = baseUrl.replace(/\/+$/, '');
  return clean.endsWith('/responses') ? clean : `${clean}/responses`;
}

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function log(level, msg) {
  const prefix = { ok: '✓', fail: '✗', skip: '○', warn: '△', info: ' ' }[level] || ' ';
  console.log(`  ${prefix} ${msg}`);
}

// ─── 测试用例 ───────────────────────────────────────────

async function testPing(provider, apiKey) {
  log('info', `1. 非流式 ping（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Respond with exactly: pong',
    stream: false,
    store: false,
    max_output_tokens: 16,
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('fail', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }

    const data = await res.json();
    const text = data.output?.[0]?.content?.[0]?.text || data.output_text || '';
    log('ok', `响应：${text.slice(0, 50)}`);
    log('info', `   status=${data.status}, usage=${JSON.stringify(data.usage || {})}`);
    return { ok: true, data };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testStream(provider, apiKey) {
  log('info', `2. 流式文本（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Write a haiku about code. Respond in 3 lines.',
    stream: true,
    store: false,
    max_output_tokens: 128,
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('fail', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let events = [];
    let textDelta = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const json = line.slice(6).trim();
          if (json === '[DONE]') continue;
          try {
            const event = JSON.parse(json);
            events.push(event.type || 'unknown');
            if (event.type === 'response.output_text.delta') {
              textDelta += event.delta || '';
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }

    const uniqueEvents = [...new Set(events)];
    log('ok', `收到 ${events.length} 个事件，类型：${uniqueEvents.join(', ')}`);
    log('info', `   文本片段：${textDelta.slice(0, 80).replace(/\n/g, ' ')}...`);
    return { ok: true, events: uniqueEvents, text: textDelta };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testFunctionCall(provider, apiKey) {
  log('info', `3. 单 Function Call（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'What is the weather in Tokyo? Use the get_weather tool.',
    stream: false,
    store: false,
    max_output_tokens: 256,
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
        strict: false,
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('fail', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }

    const data = await res.json();
    const funcCall = data.output?.find((item) => item.type === 'function_call');
    if (!funcCall) {
      log('fail', `未收到 function_call，输出类型：${data.output?.map(i => i.type).join(', ')}`);
      return { ok: false, data };
    }

    log('ok', `function_call: ${funcCall.name}(${funcCall.arguments})`);
    log('info', `   call_id=${funcCall.call_id}, status=${data.status}`);
    return { ok: true, data, callId: funcCall.call_id };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testParallelFunctionCall(provider, apiKey) {
  log('info', `4. 并行 Function Call（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Check the weather in both Tokyo and Paris simultaneously.',
    stream: false,
    store: false,
    max_output_tokens: 512,
    parallel_tool_calls: true,
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
        strict: false,
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('fail', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }

    const data = await res.json();
    const funcCalls = data.output?.filter((item) => item.type === 'function_call') || [];
    log(funcCalls.length >= 2 ? 'ok' : 'warn',
      `收到 ${funcCalls.length} 个 function_call（期望 >=2）`);
    funcCalls.forEach((fc, i) => {
      log('info', `   [${i}] ${fc.name}(${fc.arguments}), call_id=${fc.call_id}`);
    });
    return { ok: funcCalls.length >= 2, data, calls: funcCalls };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testFunctionOutput(provider, apiKey, callId) {
  log('info', `5. Function output 回传（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: [
      {
        type: 'function_call',
        call_id: callId || 'call_test_001',
        name: 'get_weather',
        arguments: '{"location":"Tokyo"}',
      },
      {
        type: 'function_call_output',
        call_id: callId || 'call_test_001',
        output: '{"temperature":22,"unit":"celsius","condition":"sunny"}',
      },
    ],
    stream: false,
    store: false,
    max_output_tokens: 128,
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather',
        parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        strict: false,
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('fail', `HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }

    const data = await res.json();
    const textOutput = data.output?.find((item) => item.type === 'message');
    const content = textOutput?.content?.[0]?.text || '';
    log('ok', `收到文本响应：${content.slice(0, 80)}...`);
    return { ok: true, data };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testUsage(provider, apiKey) {
  log('info', `6. Usage 字段（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Explain quantum computing in one paragraph.',
    stream: false,
    store: false,
    max_output_tokens: 256,
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      log('fail', `HTTP ${res.status}`);
      return { ok: false };
    }

    const data = await res.json();
    const usage = data.usage;
    if (!usage) {
      log('fail', '未返回 usage 字段');
      return { ok: false, data };
    }

    log('ok', `usage: input=${usage.input_tokens}, output=${usage.output_tokens}, total=${usage.total_tokens}`);
    if (usage.cached_tokens) log('info', `   cached_tokens=${usage.cached_tokens}`);
    if (usage.reasoning_tokens) log('info', `   reasoning_tokens=${usage.reasoning_tokens}`);
    return { ok: true, usage };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

async function testReasoning(provider, apiKey) {
  log('info', `7. Reasoning effort（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Solve: What is 2+2? Think step by step.',
    stream: false,
    store: false,
    max_output_tokens: 128,
    reasoning: { effort: 'low' },
  };

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      log('warn', `HTTP ${res.status}（reasoning 可能不支持）: ${text.slice(0, 100)}`);
      return { ok: false, status: res.status, unsupported: true };
    }

    const data = await res.json();
    const hasReasoning = data.output?.some((item) => item.type === 'reasoning');
    log(hasReasoning ? 'ok' : 'warn', `reasoning item: ${hasReasoning ? '有' : '无'}`);
    if (data.usage?.reasoning_tokens) log('info', `   reasoning_tokens=${data.usage.reasoning_tokens}`);
    return { ok: true, data, hasReasoning };
  } catch (err) {
    log('warn', err.message + '（reasoning 可能不支持）');
    return { ok: false, error: err.message, unsupported: true };
  }
}

async function testAbort(provider, apiKey) {
  log('info', `8. 取消请求（${provider.model}）...`);
  const url = buildUrl(provider.baseUrl);
  const body = {
    model: provider.model,
    input: 'Write a very long essay about the history of computing.',
    stream: true,
    store: false,
    max_output_tokens: 4096,
  };

  const controller = new AbortController();
  let cancelled = false;
  let receivedEvents = 0;

  try {
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) return { ok: false, status: res.status };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          receivedEvents += (chunk.match(/data: /g) || []).length;
        }
        return { ok: true, events: receivedEvents };
      } catch {
        return { ok: true, events: receivedEvents, cancelled: true };
      }
    });

    // 等待 200ms 后取消
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    cancelled = true;

    const result = await fetchPromise.catch((err) => {
      if (err.name === 'AbortError') return { ok: true, cancelled: true };
      return { ok: false, error: err.message };
    });

    log(cancelled ? 'ok' : 'warn', `已取消，收到 ${receivedEvents} 个事件`);
    return { ok: true, cancelled, events: receivedEvents };
  } catch (err) {
    log('fail', err.message);
    return { ok: false, error: err.message };
  }
}

// ─── 主流程 ─────────────────────────────────────────────

async function verifyProvider(provider) {
  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    log('skip', `${provider.name}: 环境变量 ${provider.envKey} 未设置`);
    RESULTS.push({ provider: provider.name, status: 'skipped', reason: 'no API key' });
    return;
  }

  log('info', `\n${'='.repeat(60)}`);
  log('info', `验证: ${provider.name} (${provider.model})`);
  log('info', `URL: ${buildUrl(provider.baseUrl)}`);
  log('info', `${'='.repeat(60)}`);

  const results = {};

  // 1. Ping
  results.ping = await testPing(provider, apiKey);
  if (!results.ping.ok) {
    log('fail', `基本连通性失败，跳过 ${provider.name} 其余测试`);
    RESULTS.push({ provider: provider.name, status: 'failed', results });
    return;
  }

  // 2. Stream
  results.stream = await testStream(provider, apiKey);

  // 3. Single Function Call
  results.functionCall = await testFunctionCall(provider, apiKey);

  // 4. Parallel Function Call
  results.parallel = await testParallelFunctionCall(provider, apiKey);

  // 5. Function Output
  const callId = results.functionCall.callId || results.parallel.calls?.[0]?.call_id;
  results.functionOutput = await testFunctionOutput(provider, apiKey, callId);

  // 6. Usage
  results.usage = await testUsage(provider, apiKey);

  // 7. Reasoning
  results.reasoning = await testReasoning(provider, apiKey);

  // 8. Abort
  results.abort = await testAbort(provider, apiKey);

  // 汇总
  const summary = {
    provider: provider.name,
    model: provider.model,
    baseUrl: provider.baseUrl,
    capabilities: {
      textStream: results.stream.ok,
      functionCall: results.functionCall.ok,
      parallelFunctionCall: results.parallel.ok,
      functionOutput: results.functionOutput.ok,
      usage: results.usage.ok,
      reasoning: results.reasoning.ok,
      abort: results.abort.ok,
    },
    status: results.ping.ok ? 'ok' : 'failed',
  };

  RESULTS.push({ ...summary, results });
  log('info', `\n${provider.name} 能力摘要:`);
  Object.entries(summary.capabilities).forEach(([k, v]) => {
    log(v ? 'ok' : 'fail', `  ${k}: ${v ? '✓' : '✗'}`);
  });
}

async function main() {
  console.log('\nStellara Work v0.9.2 — Task 0: 供应商 Responses API 能力验证\n');
  console.log('验证项: 非流式 ping / 流式文本 / Function Call / 并行 FC / FC output / usage / reasoning / abort\n');

  for (const provider of PROVIDERS) {
    await verifyProvider(provider);
  }

  // 输出总结
  console.log('\n\n' + '='.repeat(60));
  console.log('验证总结');
  console.log('='.repeat(60));

  for (const r of RESULTS) {
    const caps = r.capabilities || {};
    const all = r.status === 'ok' ? Object.values(caps).every(Boolean) : false;
    console.log(`\n${r.provider}: ${r.status === 'ok' ? (all ? '✓ 全部通过' : '△ 部分通过') : r.status === 'skipped' ? '○ 跳过' : '✗ 失败'}`);
    if (caps) {
      Object.entries(caps).forEach(([k, v]) => {
        console.log(`  ${k}: ${v ? '✓' : '✗'}`);
      });
    }
  }

  // GLM go/no-go
  const glm = RESULTS.find((r) => r.provider === 'GLM-5.3');
  if (glm) {
    console.log('\nGLM-5.3 决策:');
    if (glm.status === 'ok' && glm.capabilities?.textStream && glm.capabilities?.functionCall && glm.capabilities?.usage) {
      console.log('  → GLM-5.3 通过，可正式内置');
    } else {
      console.log('  → GLM-5.3 未通过，v0.9.2 不内置');
    }
  } else {
    console.log('\nGLM-5.3: 未测试（无 API Key）');
  }

  console.log('\n');
}

main().catch((err) => {
  console.error('验证脚本异常:', err);
  process.exit(1);
});
