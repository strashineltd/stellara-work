import { describe, expect, it } from 'vitest';
import { AnthropicStreamAssembler } from './anthropic-stream-assembler';
import type { AnthropicResponse, AnthropicStreamEvent } from '../llm/anthropic';

function collect(events: AnthropicStreamEvent[]) {
  const assembler = new AnthropicStreamAssembler();
  const deltas: Array<{ text?: string; reasoning?: string }> = [];
  for (const event of events) {
    const delta = assembler.handle(event);
    if (delta) deltas.push(delta);
  }
  return { deltas, assembled: assembler.finish() };
}

describe('AnthropicStreamAssembler', () => {
  it('文本增量实时产出并装配为 text 块', () => {
    const { deltas, assembled } = collect([
      { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } as unknown as AnthropicResponse },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '，世界' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    ]);

    expect(deltas.map((delta) => delta.text)).toEqual(['你好', '，世界']);
    expect(assembled.content).toEqual([{ type: 'text', text: '你好，世界' }]);
    expect(assembled.stop_reason).toBe('end_turn');
    expect(assembled.usage).toEqual({ input_tokens: 7, output_tokens: 5 });
  });

  it('tool_use 分片 JSON 在 stop 时解析', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-1', name: 'read_file' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '.txt"}' } },
      { type: 'content_block_stop', index: 0 },
    ]);

    expect(assembled.content).toEqual([
      { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'a.txt' } },
    ]);
  });

  it('JSON 分片不完整时 input 兜底为空对象', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-2', name: 'write_file' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
      { type: 'content_block_stop', index: 0 },
    ]);

    expect(assembled.content).toEqual([
      { type: 'tool_use', id: 'tu-2', name: 'write_file', input: {} },
    ]);
  });

  it('未收到 input_json_delta 时保留 start 块自带的 input', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-4', name: 'read_file', input: { path: 'b.txt' } } },
      { type: 'content_block_stop', index: 0 },
    ]);

    expect(assembled.content).toEqual([
      { type: 'tool_use', id: 'tu-4', name: 'read_file', input: { path: 'b.txt' } },
    ]);
  });

  it('多块按 index 排序组装', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '先说明' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu-3', name: 'run_command' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"true"}' } },
      { type: 'content_block_stop', index: 1 },
    ]);

    expect(assembled.content).toEqual([
      { type: 'text', text: '先说明' },
      { type: 'tool_use', id: 'tu-3', name: 'run_command', input: { command: 'true' } },
    ]);
  });

  it('thinking 增量作为 reasoning 输出且不进入最终 content', () => {
    const { deltas, assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', text: '' } as never },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', text: '思考中' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } },
      { type: 'content_block_stop', index: 1 },
    ]);

    expect(deltas).toEqual([{ reasoning: '思考中' }, { text: '答案' }]);
    expect(assembled.content).toEqual([{ type: 'text', text: '答案' }]);
  });

  it('error 事件抛出错误', () => {
    const assembler = new AnthropicStreamAssembler();
    expect(() => assembler.handle({ type: 'error', error: { type: 'overloaded_error', message: '过载' } }))
      .toThrow('过载');
  });

  it('未知事件与缺失字段安全忽略', () => {
    const { deltas, assembled } = collect([
      { type: 'ping' },
      { type: 'content_block_delta' },
      { type: 'message_stop' },
    ]);

    expect(deltas).toEqual([]);
    expect(assembled.content).toEqual([]);
  });
});
