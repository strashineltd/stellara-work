/**
 * Streaming 路径回归测试
 *
 * 历史上出过 bug：`content` 事件被推进 `eventBuffer` 但从来没 yield。
 * 这个测试用 mock 的 SSE fetch 验证 chat() 真的能 yield content 事件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatClient } from './openai-compat';
import type { ModelConfig, ChatStreamEvent } from '../../shared/ipc';

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('OpenAICompatClient streaming', () => {
  let config: ModelConfig;

  beforeEach(() => {
    config = {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek-v4-Pro',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-test',
      isCustom: false,
    };
    // mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  it('yields content events incrementally from SSE chunks (regression: events were dropped)', async () => {
    // SSE 格式：data: {...}\n\n
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"！"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeSseResponse(sseChunks));

    const client = new OpenAICompatClient(config);
    const events: ChatStreamEvent[] = [];
    for await (const ev of client.chat({
      model: config.model,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) {
      events.push(ev);
    }

    // 关键断言：必须收到 3 个 content 事件（不是 0 个）
    const contentEvents = events.filter((e) => e.type === 'content');
    expect(contentEvents).toHaveLength(3);
    expect(contentEvents.map((e) => e.content).join('')).toBe('你好！');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('yields tool_call events at end of stream', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeSseResponse(sseChunks));

    const client = new OpenAICompatClient(config);
    const events: ChatStreamEvent[] = [];
    for await (const ev of client.chat({
      model: config.model,
      messages: [{ role: 'user', content: 'read' }],
      tools: [{
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      }],
      stream: true,
    })) {
      events.push(ev);
    }

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(1);
    const tc = toolCallEvents[0]?.toolCall;
    expect(tc?.function.name).toBe('read_file');
    expect(tc?.function.arguments).toBe('{"path":"a.txt"}');
  });

  /**
   * 回归：用户报 HTTP 400：
   *   "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
   * 根因：部分 provider（GLM / DeepSeek / Kimi）第一个 tool_call delta 不带 id，
   * 后续 chunk 也不补；我们把 id 初始化为空串，后续 tool 结果的 tool_call_id
   * 也是空串，OpenAI 校验不匹配。
   * 修复：buffer 初始化时若缺 id，本地生成本地占位（call_<uuid>）。
   */
  it('generates fallback tool_call.id when provider omits id (HTTP 400 regression)', async () => {
    // 模拟 GLM 这种行为：所有 delta 都没 id
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeSseResponse(sseChunks));

    const client = new OpenAICompatClient(config);
    const events: ChatStreamEvent[] = [];
    for await (const ev of client.chat({
      model: config.model,
      messages: [{ role: 'user', content: 'read' }],
      tools: [{
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      }],
      stream: true,
    })) {
      events.push(ev);
    }

    const toolCallEvents = events.filter((e) => e.type === 'tool_call');
    expect(toolCallEvents).toHaveLength(1);
    const tc = toolCallEvents[0]?.toolCall;
    expect(tc?.function.name).toBe('read_file');
    // 关键断言：id 不能是空串，必须是非空占位
    expect(tc?.id).toBeTruthy();
    expect(tc?.id).not.toBe('');
    expect(tc?.id).toMatch(/^call_/);
  });

  /**
   * 回归：用户报「跑着跑着自动暂停，没有结果」。
   * 根因是 SSE read loop 没有 idle timeout —— provider 丢流不 close，
   * reader.read() 永远 await，agent 卡在「思考中...」。
   * 修复：chat() 内置 idle timer；超时后 abort fetch 并 yield error 事件。
   * 测试用 300ms 的短窗口模拟挂起，验证 abort + error 事件能在 ~300ms 内触发。
   */
  it('aborts and yields error event when stream goes idle (regression: hang >5min)', async () => {
    // 模拟「发了首块之后再也不 close」的 SSE 流
    const firstChunk = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
        // 故意不 close —— 模拟 provider 丢流
      },
    });
    const hangingResponse = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(hangingResponse);

    const client = new OpenAICompatClient(config);
    const events: ChatStreamEvent[] = [];
    const start = Date.now();
    for await (const ev of client.chat(
      {
        model: config.model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
      undefined,
      300, // 缩短 idle 窗口：300ms 内没新 chunk 就触发
    )) {
      events.push(ev);
      if (ev.type === 'error' || ev.type === 'done') break;
    }
    const elapsed = Date.now() - start;

    // 必须收到 error 事件（不是死等）
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error?: string })?.error).toMatch(/挂起|超时/);
    // 触发时机应在 idle 窗口附近（这里是 300ms），不能等到默认的 120s
    expect(elapsed).toBeLessThan(2_000);
  });

  /**
   * 回归：用户主动中断（按停止）时，chat() 不能 yield 误导性的 idle error。
   * 应该静默退出，由 main.ts 发「用户中断」事件给前端。
   */
  it('does NOT yield idle error when user aborts (respects signal.aborted)', async () => {
    // 永不结束的 SSE 流
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        // 不 close
      },
    });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const client = new OpenAICompatClient(config);
    const controller = new AbortController();
    // 用户 50ms 后主动取消
    setTimeout(() => controller.abort(), 50);

    const events: ChatStreamEvent[] = [];
    for await (const ev of client.chat(
      {
        model: config.model,
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
      controller.signal,
      10_000, // idle 窗口很大；确保触发的是用户 abort，不是 idle
    )) {
      events.push(ev);
    }

    // 用户主动取消 → 不应该 yield "挂起" 错误（要么静默，要么 done / tool）
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents).toHaveLength(0);
  });
});

/**
 * summarize() 的 wall-clock timeout 测试
 *
 * 历史上 summarize() 没有任何超时；如果 fetch 在网络层挂死，
 * agent loop 的下一次 LLM 调用前会无限等。修复后默认 60s 抛错，
 * compressIfNeeded 的 catch 会兜底跳过本次压缩。
 */
describe('OpenAICompatClient.summarize timeout', () => {
  let config: ModelConfig;

  beforeEach(() => {
    config = {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek-v4-Pro',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-test',
      isCustom: false,
    };
    vi.stubGlobal('fetch', vi.fn());
  });

  it('throws on wall-clock timeout when fetch hangs forever', async () => {
    // 模拟永不 resolve 的 fetch，但必须尊重 signal：
    // 真实 fetch 在 abort 时会 reject；这里要 mock 出同样行为，否则
    // timeout 触发但 fetch 永远 pending，测试就卡到 vitest 默认超时。
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );

    const client = new OpenAICompatClient(config);
    await expect(
      client.summarize(
        [{ role: 'user', content: 'hi' }],
        'sys',
        100, // 缩短超时到 100ms，测试不卡 60s
      ),
    ).rejects.toThrow(/summarize 超时/);
  });
});
