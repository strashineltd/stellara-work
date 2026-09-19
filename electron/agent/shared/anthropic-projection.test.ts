import { describe, expect, it } from 'vitest';
import { projectAnthropicMessages } from './anthropic-projection';
import type { ResponseItem } from '../../../shared/responses';

describe('projectAnthropicMessages', () => {
  it('文本 + tool_use 合并进同一条 assistant 消息，text 在前', () => {
    const items: ResponseItem[] = [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我来读取' }], status: 'completed' },
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}', status: 'completed' },
      { type: 'function_call_output', call_id: 'call-1', output: '文件内容' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来读取' },
          { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '文件内容' }] },
    ]);
  });

  it('并行工具：多个 tool_use 合并进一条 assistant，多个 tool_result 合并进一条 user', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a"}', status: 'completed' },
      { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{"path":"b"}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'A' },
      { type: 'function_call_output', call_id: 'c2', output: 'B' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a' } },
          { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'A' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'B' },
        ],
      },
    ]);
  });

  it('user/assistant 文本交替保持独立消息', () => {
    const items: ResponseItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题' }], status: 'completed' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '答案' }], status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '问题' }] },
      { role: 'assistant', content: [{ type: 'text', text: '答案' }] },
    ]);
  });

  it('跳过 reasoning、system 与空文本', () => {
    const items: ResponseItem[] = [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: '思考' }] },
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: '系统' }], status: 'completed' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '' }], status: 'completed' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '保留' }], status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '保留' }] },
    ]);
  });

  it('arguments 非法 JSON 时 input 兜底为空对象', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{bad json', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'OUT' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'OUT' }] },
    ]);
  });

  it('保留窗口含 function_call 时其 output 紧随其后（配对不拆）', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'OUT-1' },
      { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c2', output: 'OUT-2' },
    ];

    const messages = projectAnthropicMessages(items);
    const flat = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const callIds = flat.filter((b) => b.type === 'tool_use').map((b) => b.id);
    const outputIds = flat.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    expect(outputIds).toEqual(callIds);
  });

  it('未配对的 function_call 生成中断结果，避免请求缺 tool_result', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'write_file', arguments: '{"path":"x"}', status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'write_file', input: { path: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":false,"error":"工具执行被中断，结果未知"}' }] },
    ]);
  });
});
