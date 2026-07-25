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
});
