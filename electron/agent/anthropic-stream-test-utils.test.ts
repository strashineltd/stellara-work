import { describe, expect, it } from 'vitest';
import { AnthropicStreamAssembler } from './anthropic-stream-assembler';
import { streamEventsFromResponse } from './anthropic-stream-test-utils';
import type { AnthropicResponse } from '../llm/anthropic';

function assemble(response: AnthropicResponse) {
  const assembler = new AnthropicStreamAssembler();
  for (const event of streamEventsFromResponse(response)) assembler.handle(event);
  return assembler.finish();
}

describe('anthropic-stream-test-utils', () => {
  it('脚本响应经事件流装配后与原始响应等价（文本不翻倍）', () => {
    const response: AnthropicResponse = {
      id: 'msg-eq',
      type: 'message',
      role: 'assistant',
      model: 'custom-model',
      stop_reason: 'tool_use',
      usage: { input_tokens: 9, output_tokens: 4 },
      content: [
        { type: 'text', text: '说明文本' },
        { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'x.txt' } },
      ],
    };

    const assembled = assemble(response);
    expect(assembled.content).toEqual(response.content);
    expect(assembled.stop_reason).toBe('tool_use');
    expect(assembled.usage).toEqual({ input_tokens: 9, output_tokens: 4 });
  });
});
