import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { buildChatCompletionsUrl } from './endpoint';
import type {
  ModelConfig,
  ChatMessage,
  ToolCall,
  ChatStreamEvent,
  OpenAITool,
} from '../../shared/ipc';

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

/**
 * OpenAI 兼容协议的 Chat Completions 客户端
 *
 * 特性：
 * - SSE 流式响应
 * - function calling 解析
 * - AbortSignal 取消
 * - 自动重试（指数退避，限流时）
 */
export class OpenAICompatClient {
  constructor(private config: ModelConfig) {}

  /**
   * 发送一个 chat completion 请求，返回流式事件
   */
  async *chat(request: ChatCompletionRequest, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const url = buildChatCompletionsUrl(this.config.baseUrl);
    const response = await this.fetchWithRetry(url, request, signal);

    if (!response.ok) {
      const errorText = await response.text();
      yield {
        type: 'error',
        error: `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: '响应为空' };
      return;
    }

    // 流式解析 SSE
    // 本地 buffer：SSE onEvent 回调里塞进来，主循环在每次 feed 之后 drain 出来 yield
    const pending: ChatStreamEvent[] = [];
    const toolCallsBuffer = new Map<number, ToolCall>(); // index -> partial tool call
    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === '[DONE]') return;
        try {
          const json = JSON.parse(event.data);
          const delta = json.choices?.[0]?.delta;
          if (!delta) return;

          // content 增量
          if (delta.content) {
            pending.push({ type: 'content', content: delta.content });
          }

          // tool_calls 增量
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsBuffer.has(idx)) {
                toolCallsBuffer.set(idx, {
                  id: tc.id ?? '',
                  type: 'function',
                  function: { name: tc.function?.name ?? '', arguments: '' },
                });
              }
              const buf = toolCallsBuffer.get(idx)!;
              if (tc.id) buf.id = tc.id;
              if (tc.function?.name) buf.function.name = tc.function.name;
              if (tc.function?.arguments) {
                buf.function.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // 忽略解析错误（可能是 ping / 心跳）
        }
      },
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        parser.feed(text);
        // 每个 chunk 喂完，drain 一次 pending → 真流式
        while (pending.length > 0) {
          yield pending.shift()!;
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 输出累积的 tool calls
    for (const toolCall of toolCallsBuffer.values()) {
      if (toolCall.function.name) {
        yield { type: 'tool_call', toolCall };
      }
    }
    yield { type: 'done' };
  }

  private async fetchWithRetry(
    url: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    maxRetries = 3,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      attempt++;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      // 限流（429）或服务器错误（5xx）重试
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      return response;
    }
  }

  /**
   * 测试连接（发一个简单的 ping 请求）
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.fetchWithRetry(
        buildChatCompletionsUrl(this.config.baseUrl),
        {
          model: this.config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false,
        } as ChatCompletionRequest,
        undefined,
        1,
      );
      if (response.ok) {
        return { ok: true };
      }
      const text = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
