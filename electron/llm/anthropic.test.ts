import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicClient } from './anthropic';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('AnthropicClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses Messages API headers, URL and tool schema', async () => {
    fetchMock.mockResolvedValueOnce(response({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'claude-compatible',
      stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 1 },
      content: [{ type: 'text', text: 'ok' }],
    }));
    const client = new AnthropicClient({
      baseUrl: 'https://gateway.example.com/v1', apiKey: 'anthropic-key', model: 'claude-compatible',
    });
    await client.create({
      model: 'ignored', max_tokens: 128, messages: [{ role: 'user', content: 'ping' }],
      tools: [{ name: 'read_file', description: 'read', input_schema: { type: 'object' } }],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.example.com/v1/messages');
    expect(init?.headers).toMatchObject({
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
    });
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('claude-compatible');
    expect(body.stream).toBe(false);
    expect(body.tools[0].input_schema).toEqual({ type: 'object' });
  });

  it('流式部分输出后失败不重试（避免重复内容）', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"部分"}}\n\n'));
      },
      pull(controller) {
        controller.error(new Error('ETIMEDOUT'));
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, body } as unknown as Response);

    const client = new AnthropicClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    const seen: string[] = [];
    await expect((async () => {
      for await (const event of client.createStream({ model: 'm', max_tokens: 16, messages: [] })) {
        seen.push(event.type);
      }
    })()).rejects.toThrow();

    expect(seen).toEqual(['content_block_delta']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('首个事件到达前失败仍按现有策略重试', async () => {
    const encoder = new TextEncoder();
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('ETIMEDOUT'));
      },
    });
    const good = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, body: failing } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, body: good } as unknown as Response);

    const client = new AnthropicClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    const seen: string[] = [];
    for await (const event of client.createStream({ model: 'm', max_tokens: 16, messages: [] })) {
      seen.push(event.type);
    }

    expect(seen).toEqual(['message_stop']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('首个事件前 HTTP 429 保持重试（状态码分类不丢失）', async () => {
    const encoder = new TextEncoder();
    const good = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}\n\n'));
        controller.close();
      },
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit_error' } }),
      } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, body: good } as unknown as Response);

    const client = new AnthropicClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    const seen: string[] = [];
    for await (const event of client.createStream({ model: 'm', max_tokens: 16, messages: [] })) {
      seen.push(event.type);
    }

    expect(seen).toEqual(['message_stop']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 401 不重试且抛出可读错误', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: { message: 'invalid x-api-key', type: 'authentication_error' } }),
    } as unknown as Response);

    const client = new AnthropicClient({ baseUrl: 'https://x', apiKey: 'k', model: 'm' });
    await expect((async () => {
      for await (const _event of client.createStream({ model: 'm', max_tokens: 16, messages: [] })) { /* 消费 */ }
    })()).rejects.toThrow(/api-?key/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
