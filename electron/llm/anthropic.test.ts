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
});
