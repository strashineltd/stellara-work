/**
 * 测试辅助：把脚本化的完整 Anthropic 响应转成等效 SSE 事件序列，
 * 让 loop 测试保持"响应脚本化"的写法。
 * 文本刻意切成两段 delta，用于验证 loop 是真正的流式输出。
 */
import type { AnthropicResponse, AnthropicStreamEvent } from '../llm/anthropic';

export function streamEventsFromResponse(response: AnthropicResponse): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [{ type: 'message_start', message: response }];

  response.content.forEach((block, index) => {
    events.push({
      type: 'content_block_start',
      index,
      content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block },
    });
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      const half = Math.ceil(block.text.length / 2);
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text.slice(0, half) } });
      if (block.text.length > half) {
        events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text.slice(half) } });
      }
    }
    if (block.type === 'tool_use') {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });

  events.push({
    type: 'message_delta',
    delta: { type: 'message_delta', stop_reason: response.stop_reason },
    usage: { output_tokens: response.usage?.output_tokens ?? 0 },
  });
  events.push({ type: 'message_stop' });
  return events;
}

/** 流式客户端适配器：调用方仍脚本化完整响应，注入给 loop 的 client 选项 */
export function streamingClient(
  create: (request: unknown, signal?: AbortSignal) => Promise<AnthropicResponse>,
): { createStream: (request: unknown, signal?: AbortSignal) => AsyncGenerator<AnthropicStreamEvent> } {
  return {
    async *createStream(request: unknown, signal?: AbortSignal) {
      const response = await create(request, signal);
      for (const event of streamEventsFromResponse(response)) yield event;
    },
  };
}
