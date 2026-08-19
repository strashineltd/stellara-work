import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ResponsesClient } from './responses';
import type {
  CreateResponseRequest,
  ResponseObject,
  ResponseStreamEvent,
  ResponseUsage,
} from '../../shared/responses';
import type { ModelConfig } from '../../shared/ipc';

const DEFAULT_CONFIG: ModelConfig = {
  id: 'test-model',
  label: 'Test Model',
  baseUrl: 'https://api.example.com',
  model: 'test-model',
  apiKey: 'test-key',
  isCustom: false,
};

// 模拟 SSE 事件流
function mockSSEStream(events: ResponseStreamEvent[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.close();
    },
  });
}

// 模拟 fetch 响应
function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    body: null,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// 模拟流式 fetch 响应
function mockStreamFetchResponse(events: ResponseStreamEvent[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: mockSSEStream(events),
    json: () => Promise.reject(new Error('Not JSON')),
  } as unknown as Response;
}

describe('ResponsesClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  describe('create (non-streaming)', () => {
    it('发送正确的请求格式', async () => {
      const response: ResponseObject = {
        id: 'resp_001',
        object: 'response',
        model: 'test-model',
        status: 'completed',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(response));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const req: CreateResponseRequest = {
        model: 'test-model',
        input: 'ping',
        stream: false,
        store: false,
      };

      const result = await client.create(req);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.example.com/responses');
      expect(options?.method).toBe('POST');
      expect(options?.headers).toHaveProperty('Authorization', 'Bearer test-key');

      const body = JSON.parse(options?.body as string);
      expect(body.model).toBe('test-model');
      expect(body.input).toBe('ping');
      expect(body.store).toBe(false);
      expect(body.stream).toBe(false);

      expect(result.status).toBe('completed');
      expect(result.output).toHaveLength(1);
    });

    it('处理非流式错误响应', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401),
      );

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const req: CreateResponseRequest = {
        model: 'test-model',
        input: 'test',
        stream: false,
        store: false,
      };

      // 验证抛出异常
      await expect(client.create(req)).rejects.toThrow();
    });
  });

  describe('createStream (streaming)', () => {
    it('处理完整的流式响应', async () => {
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.created',
          response: { id: 'resp_001', object: 'response', model: 'test', status: 'in_progress', output: [] },
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'Hello ',
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'world!',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_001',
            object: 'response',
            model: 'test',
            status: 'completed',
            output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello world!' }] }],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ];

      fetchSpy.mockResolvedValueOnce(mockStreamFetchResponse(events));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const collected: ResponseStreamEvent[] = [];
      for await (const event of client.createStream({ model: 'test', input: 'test', stream: true, store: false })) {
        collected.push(event);
      }

      expect(collected).toHaveLength(4);
      expect(collected[0]!.type).toBe('response.created');
      expect(collected[1]!.type).toBe('response.output_text.delta');
      expect(collected[2]!.type).toBe('response.output_text.delta');
      expect(collected[3]!.type).toBe('response.completed');
    });

    it('处理 Function Call 流式事件', async () => {
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.function_call_arguments.delta',
          output_index: 0,
          item_id: 'item_001',
          delta: '{"path":',
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 0,
          item_id: 'item_001',
          delta: '"/test"}',
        },
        {
          type: 'response.function_call_arguments.done',
          output_index: 0,
          item_id: 'item_001',
          arguments: '{"path":"/test"}',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_002',
            object: 'response',
            model: 'test',
            status: 'completed',
            output: [
              { type: 'function_call', call_id: 'call_001', name: 'read_file', arguments: '{"path":"/test"}' },
            ],
          },
        },
      ];

      fetchSpy.mockResolvedValueOnce(mockStreamFetchResponse(events));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const collected: ResponseStreamEvent[] = [];
      for await (const event of client.createStream({ model: 'test', input: 'test', stream: true, store: false })) {
        collected.push(event);
      }

      expect(collected).toHaveLength(4);
      expect(collected[0]!.type).toBe('response.function_call_arguments.delta');
      expect(collected[2]!.type).toBe('response.function_call_arguments.done');
    });

    it('处理 reasoning 事件', async () => {
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.reasoning_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'thinking...',
        },
        {
          type: 'response.reasoning_text.done',
          output_index: 0,
          content_index: 0,
          text: 'thinking...',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_003',
            object: 'response',
            model: 'test',
            status: 'completed',
            output: [
              { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'thinking...' }] },
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
            ],
          },
        },
      ];

      fetchSpy.mockResolvedValueOnce(mockStreamFetchResponse(events));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const collected: ResponseStreamEvent[] = [];
      for await (const event of client.createStream({ model: 'test', input: 'test', stream: true, store: false })) {
        collected.push(event);
      }

      expect(collected[0]!.type).toBe('response.reasoning_text.delta');
      expect(collected[1]!.type).toBe('response.reasoning_text.done');
    });

    it('处理 incomplete 响应', async () => {
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.incomplete',
          response: {
            id: 'resp_004',
            object: 'response',
            model: 'test',
            status: 'incomplete',
            output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial' }] }],
          },
          incomplete_details: { reason: 'max_output_tokens' },
        },
      ];

      fetchSpy.mockResolvedValueOnce(mockStreamFetchResponse(events));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const collected: ResponseStreamEvent[] = [];
      for await (const event of client.createStream({ model: 'test', input: 'test', stream: true, store: false })) {
        collected.push(event);
      }

      expect(collected[0]!.type).toBe('response.incomplete');
    });

    it('处理 failed 响应', async () => {
      const events: ResponseStreamEvent[] = [
        {
          type: 'response.failed',
          response: {
            id: 'resp_005',
            object: 'response',
            model: 'test',
            status: 'failed',
            output: [],
          },
          error: { type: 'server_error', message: 'Internal error' },
        },
      ];

      fetchSpy.mockResolvedValueOnce(mockStreamFetchResponse(events));

      const client = new ResponsesClient(DEFAULT_CONFIG);
      const collected: ResponseStreamEvent[] = [];
      for await (const event of client.createStream({ model: 'test', input: 'test', stream: true, store: false })) {
        collected.push(event);
      }

      expect(collected[0]!.type).toBe('response.failed');
    });
  });

  describe('cancel', () => {
    it('取消请求', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({ error: { message: 'Aborted' } }, 499),
      );

      const client = new ResponsesClient(DEFAULT_CONFIG);
      client.cancel();

      await expect(
        client.create({ model: 'test', input: 'test', stream: false, store: false }),
      ).rejects.toThrow();
    });
  });
});
