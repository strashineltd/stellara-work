import { describe, expect, it } from 'vitest';
import { AnthropicStreamAssembler } from './anthropic-stream-assembler';
import type { AnthropicResponse, AnthropicStreamEvent } from '../llm/anthropic';

/** 流正常收尾（真实格式：message_delta 的 delta 不含 type） */
const END: AnthropicStreamEvent[] = [
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];

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
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
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
      ...END,
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
      ...END,
    ]);

    expect(assembled.content).toEqual([
      { type: 'tool_use', id: 'tu-2', name: 'write_file', input: {} },
    ]);
  });

  it('未收到 input_json_delta 时保留 start 块自带的 input', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-4', name: 'read_file', input: { path: 'b.txt' } } },
      { type: 'content_block_stop', index: 0 },
      ...END,
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
      ...END,
    ]);

    expect(assembled.content).toEqual([
      { type: 'text', text: '先说明' },
      { type: 'tool_use', id: 'tu-3', name: 'run_command', input: { command: 'true' } },
    ]);
  });

  it('thinking 增量作为 reasoning 输出且不进入最终 content', () => {
    const { deltas, assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } as never },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考中' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } },
      { type: 'content_block_stop', index: 1 },
      ...END,
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

  it('流提前结束（无 message_stop / message_delta）时 finish 抛错', () => {
    const assembler = new AnthropicStreamAssembler();
    assembler.handle({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    assembler.handle({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '半截' } });

    expect(() => assembler.finish()).toThrow('提前结束');
  });

  it('工具参数未收尾且分片不完整时 finish 抛错（不执行半截参数）', () => {
    const assembler = new AnthropicStreamAssembler();
    assembler.handle({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-x', name: 'write_file' } });
    assembler.handle({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt","content":"半' } });
    assembler.handle({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });
    assembler.handle({ type: 'message_stop' });

    expect(() => assembler.finish()).toThrow('参数不完整');
  });

  it('未收到 content_block_stop 但分片 JSON 完整时仍可执行（兼容网关）', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu-y', name: 'read_file' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"c.txt"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ]);

    expect(assembled.content).toEqual([
      { type: 'tool_use', id: 'tu-y', name: 'read_file', input: { path: 'c.txt' } },
    ]);
  });

  it('重复 index 的 start 不会重复输出块', () => {
    const { assembled } = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '一' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '二' } },
      { type: 'content_block_stop', index: 0 },
      ...END,
    ]);

    expect(assembled.content).toEqual([{ type: 'text', text: '二' }]);
  });
});
