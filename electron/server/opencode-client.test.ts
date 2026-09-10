import { describe, expect, it, vi } from 'vitest';
import { OpencodeClient } from './opencode-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('OpencodeClient', () => {
  it('sends basic auth and parses health', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://localhost:4096/global/health');
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Basic ' + Buffer.from('opencode:secret').toString('base64'));
      return jsonResponse({ healthy: true, version: '1.2.3' });
    });
    const client = new OpencodeClient({ baseUrl: 'http://localhost:4096', username: 'opencode', password: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.health()).resolves.toEqual({ healthy: true, version: '1.2.3' });
  });

  it('creates a session and lists messages', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (calls.length === 1) return jsonResponse({ id: 'ses_1', title: '新会话' });
      return jsonResponse([{ info: { id: 'msg_1', role: 'user', sessionID: 'ses_1' }, parts: [{ type: 'text', id: 'p1', text: 'hi' }] }]);
    });
    const client = new OpencodeClient({ baseUrl: 'http://localhost:4096/', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.createSession('新会话')).resolves.toMatchObject({ id: 'ses_1' });
    const messages = await client.listMessages('ses_1');
    expect(messages[0]!.parts[0]).toMatchObject({ type: 'text', text: 'hi' });
    expect(calls).toEqual(['POST http://localhost:4096/session', 'GET http://localhost:4096/session/ses_1/message']);
  });

  it('posts prompt_async with model and agent', async () => {
    let body: unknown;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(null, { status: 204 });
    });
    const client = new OpencodeClient({ baseUrl: 'http://localhost:4096', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.promptAsync('ses_1', {
      parts: [{ type: 'text', text: 'hello' }],
      model: { providerID: 'anthropic', modelID: 'claude' },
      agent: 'build',
    });
    expect(body).toEqual({ parts: [{ type: 'text', text: 'hello' }], model: { providerID: 'anthropic', modelID: 'claude' }, agent: 'build' });
  });

  it('rejects non-2xx with readable error and waits for health timeout', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const client = new OpencodeClient({ baseUrl: 'http://localhost:4096', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.listSessions()).rejects.toThrow(/401/);
  });

  it('parses SSE events and reconnects with backoff', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let firstStream = true;
    const fetchImpl = vi.fn(async () => {
      if (firstStream) {
        firstStream = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"server.connected","properties":{}}\n\n'));
            controller.enqueue(encoder.encode('data: {"type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
    });
    const events: string[] = [];
    const statuses: string[] = [];
    const client = new OpencodeClient({
      baseUrl: 'http://localhost:4096',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      reconnectBaseMs: 100,
    });
    const unsubscribe = client.subscribeEvents((e) => events.push(e.type), (s) => statuses.push(s));
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(['server.connected', 'session.idle']);
    expect(statuses).toContain('connected');
    await vi.advanceTimersByTimeAsync(150);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    unsubscribe();
    vi.useRealTimers();
  });
});
