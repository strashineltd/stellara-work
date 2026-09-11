import { describe, expect, it } from 'vitest';
import { EventAdapter } from './event-adapter';

describe('EventAdapter', () => {
  it('emits text deltas for growing parts', () => {
    const adapter = new EventAdapter();
    const base = { type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', messageID: 'm1', sessionID: 'ses_1', text: '你' } } };
    expect(adapter.handle(base as never)).toEqual({ sessionID: 'ses_1', events: [{ type: 'content', content: '你' }] });
    const next = { ...base, properties: { part: { ...base.properties.part, text: '你好' } } };
    expect(adapter.handle(next as never)).toEqual({ sessionID: 'ses_1', events: [{ type: 'content', content: '好' }] });
  });

  it('maps tool states', () => {
    const adapter = new EventAdapter();
    const part = (state: Record<string, unknown>, callID = 'call_1') => ({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: `t_${callID}`, callID, sessionID: 'ses_1', tool: 'bash', state } },
    });
    expect(adapter.handle(part({ status: 'pending', input: { command: 'ls' } }) as never).events).toEqual([
      { type: 'tool_call', toolCall: { id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } } },
    ]);
    expect(adapter.handle(part({ status: 'running', input: { command: 'ls' } }) as never).events).toEqual([]);
    expect(adapter.handle(part({ status: 'completed', output: 'ok' }, 'call_done') as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'call_done', result: { ok: true, output: 'ok' } } },
    ]);
    expect(adapter.handle(part({ status: 'error', error: 'boom' }, 'call_fail') as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'call_fail', result: { ok: false, error: 'boom' } } },
    ]);
  });

  it('maps permission requests', () => {
    const adapter = new EventAdapter();
    const result = adapter.handle({
      type: 'permission.updated',
      properties: { id: 'perm_1', sessionID: 'ses_1', title: 'Bash 命令', metadata: { command: 'rm -rf x' } },
    } as never);
    expect(result.events).toEqual([
      {
        type: 'approval_required',
        approval: { id: 'perm_1', toolName: 'Bash 命令', args: '{"command":"rm -rf x"}', toolCallId: 'perm_1' },
      },
    ]);
  });

  it('treats permission.asked as an alias of permission.updated and ignores permission.replied', () => {
    const adapter = new EventAdapter();
    const asked = adapter.handle({
      type: 'permission.asked',
      properties: { id: 'perm_9', sessionID: 'ses_1', title: 'Edit 文件', metadata: { path: 'a.ts' } },
    } as never);
    expect(asked).toEqual({
      sessionID: 'ses_1',
      events: [
        {
          type: 'approval_required',
          approval: { id: 'perm_9', toolName: 'Edit 文件', args: '{"path":"a.ts"}', toolCallId: 'perm_9' },
        },
      ],
    });
    expect(adapter.handle({ type: 'permission.replied', properties: { id: 'perm_9', sessionID: 'ses_1' } } as never).events).toEqual([]);
  });

  it('emits content and reasoning deltas from message.part.delta events', () => {
    const adapter = new EventAdapter();
    const delta = (field: string, value: string) => ({
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', messageID: 'm1', partID: 'p1', field, delta: value },
    });
    expect(adapter.handle(delta('text', '你') as never)).toEqual({
      sessionID: 'ses_1',
      events: [{ type: 'content', content: '你' }],
    });
    expect(adapter.handle(delta('text', '好') as never).events).toEqual([{ type: 'content', content: '好' }]);
    expect(adapter.handle(delta('reasoning', '思') as never).events).toEqual([{ type: 'reasoning', content: '思' }]);
    expect(adapter.handle(delta('reasoning', '考') as never).events).toEqual([{ type: 'reasoning', content: '考' }]);
    // 未知 field 忽略
    expect(adapter.handle(delta('tool', '{}') as never).events).toEqual([]);
  });

  it('dedupes deltas already covered by a full snapshot', () => {
    const adapter = new EventAdapter();
    const snapshot = (text: string) =>
      ({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: 'ses_1', text } } }) as never;
    const delta = (value: string) =>
      ({ type: 'message.part.delta', properties: { sessionID: 'ses_1', partID: 'p1', field: 'text', delta: value } }) as never;
    expect(adapter.handle(snapshot('你好')).events).toEqual([{ type: 'content', content: '你好' }]);
    // 同一内容的 delta 与快照尾部重合：跳过
    expect(adapter.handle(delta('你好')).events).toEqual([]);
    expect(adapter.handle(delta('世界')).events).toEqual([{ type: 'content', content: '世界' }]);
  });

  it('emits only the unseen suffix when snapshots arrive after deltas', () => {
    const adapter = new EventAdapter();
    const snapshot = (text: string) =>
      ({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: 'ses_1', text } } }) as never;
    const delta = (value: string) =>
      ({ type: 'message.part.delta', properties: { sessionID: 'ses_1', partID: 'p1', field: 'text', delta: value } }) as never;
    expect(adapter.handle(delta('你')).events).toEqual([{ type: 'content', content: '你' }]);
    expect(adapter.handle(delta('好')).events).toEqual([{ type: 'content', content: '好' }]);
    expect(adapter.handle(snapshot('你好')).events).toEqual([]);
    expect(adapter.handle(snapshot('你好世界')).events).toEqual([{ type: 'content', content: '世界' }]);
    // 快照已包含的增量尾部重放：跳过
    expect(adapter.handle(delta('世界')).events).toEqual([]);
  });

  it('resets the baseline without duplicate output when a snapshot regresses after deltas', () => {
    const adapter = new EventAdapter();
    const snapshot = (text: string) =>
      ({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: 'ses_1', text } } }) as never;
    const delta = (value: string) =>
      ({ type: 'message.part.delta', properties: { sessionID: 'ses_1', partID: 'p1', field: 'text', delta: value } }) as never;
    expect(adapter.handle(delta('abc')).events).toEqual([{ type: 'content', content: 'abc' }]);
    expect(adapter.handle(snapshot('ab')).events).toEqual([]);
    expect(adapter.handle(snapshot('abcd')).events).toEqual([{ type: 'content', content: 'cd' }]);
  });

  it('maps session lifecycle and ignores unknown events', () => {
    const adapter = new EventAdapter();
    expect(adapter.handle({ type: 'session.idle', properties: { sessionID: 'ses_1' } } as never).events).toEqual([{ type: 'done' }]);
    const err = adapter.handle({ type: 'session.error', properties: { sessionID: 'ses_1', error: { name: 'UnknownError', message: 'x' } } } as never);
    expect(err.events[0]!.type).toBe('error');
    expect(err.events[0]!.error).toContain('x');
    expect(adapter.handle({ type: 'file.edited', properties: {} } as never).events).toEqual([]);
    expect(adapter.handle({ type: 'nonsense' } as never).events).toEqual([]);
  });

  it('emits reasoning deltas and resets tracking on rewrite', () => {
    const adapter = new EventAdapter();
    const reasoning = (text: string) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'reasoning', id: 'r1', sessionID: 'ses_1', text } },
    });
    expect(adapter.handle(reasoning('思') as never).events).toEqual([{ type: 'reasoning', content: '思' }]);
    expect(adapter.handle(reasoning('思考') as never).events).toEqual([{ type: 'reasoning', content: '考' }]);
    expect(adapter.handle(reasoning('想') as never).events).toEqual([{ type: 'reasoning', content: '想' }]);
    expect(adapter.handle(reasoning('想法') as never).events).toEqual([{ type: 'reasoning', content: '法' }]);
  });

  it('skips unchanged text snapshots and rewrites emit the full text', () => {
    const adapter = new EventAdapter();
    const text = (value: string) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'text', id: 'p1', sessionID: 'ses_1', text: value } },
    });
    expect(adapter.handle(text('abc') as never).events).toEqual([{ type: 'content', content: 'abc' }]);
    expect(adapter.handle(text('abc') as never).events).toEqual([]);
    expect(adapter.handle(text('ab') as never).events).toEqual([{ type: 'content', content: 'ab' }]);
    expect(adapter.handle(text('abcd') as never).events).toEqual([{ type: 'content', content: 'cd' }]);
  });

  it('emits tool_call once per call and tolerates unseen completed calls', () => {
    const adapter = new EventAdapter();
    const tool = (callID: string, state: Record<string, unknown>) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: `t_${callID}`, callID, sessionID: 'ses_1', tool: 'edit', state } },
    });
    expect(adapter.handle(tool('c1', { status: 'pending', input: { path: 'a.ts' } }) as never).events).toHaveLength(1);
    expect(adapter.handle(tool('c1', { status: 'pending', input: { path: 'a.ts' } }) as never).events).toEqual([]);
    expect(adapter.handle(tool('c2', { status: 'completed', output: 'done' }) as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'edit', toolCallId: 'c2', result: { ok: true, output: 'done' } } },
    ]);
  });

  it('emits tool_result only once for duplicate terminal snapshots', () => {
    const adapter = new EventAdapter();
    const completed = {
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: 't_dup', callID: 'c_dup', sessionID: 'ses_1', tool: 'bash', state: { status: 'completed', output: 'ok' } } },
    };
    expect(adapter.handle(completed as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'c_dup', result: { ok: true, output: 'ok' } } },
    ]);
    expect(adapter.handle(completed as never).events).toEqual([]);
  });

  it('emits tool_call once then a single tool_result for pending to completed', () => {
    const adapter = new EventAdapter();
    const tool = (state: Record<string, unknown>) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: 't_flow', callID: 'c_flow', sessionID: 'ses_1', tool: 'bash', state } },
    });
    expect(adapter.handle(tool({ status: 'pending', input: { command: 'ls' } }) as never).events).toEqual([
      { type: 'tool_call', toolCall: { id: 'c_flow', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } } },
    ]);
    expect(adapter.handle(tool({ status: 'completed', output: 'ok' }) as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'c_flow', result: { ok: true, output: 'ok' } } },
    ]);
    expect(adapter.handle(tool({ status: 'completed', output: 'ok' }) as never).events).toEqual([]);
  });

  it('keeps the first terminal state and ignores later transitions', () => {
    const adapter = new EventAdapter();
    const tool = (state: Record<string, unknown>) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: 't_term', callID: 'c_term', sessionID: 'ses_1', tool: 'bash', state } },
    });
    expect(adapter.handle(tool({ status: 'completed', output: 'ok' }) as never).events).toHaveLength(1);
    expect(adapter.handle(tool({ status: 'error', error: 'late' }) as never).events).toEqual([]);
  });

  it('maps assistant token usage', () => {
    const adapter = new EventAdapter();
    expect(
      adapter.handle({
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'assistant', sessionID: 'ses_1', tokens: { input: 12, output: 3 } } },
      } as never),
    ).toEqual({ sessionID: 'ses_1', events: [{ type: 'usage', usage: { promptTokens: 12, completionTokens: 3, estimated: false } }] });
    expect(
      adapter.handle({ type: 'message.updated', properties: { info: { id: 'm1', role: 'assistant', sessionID: 'ses_1' } } } as never).events,
    ).toEqual([]);
    expect(
      adapter.handle({ type: 'message.updated', properties: { info: { id: 'm2', role: 'user', sessionID: 'ses_1', tokens: { input: 1, output: 1 } } } } as never).events,
    ).toEqual([]);
  });

  it('tolerates missing fields without throwing', () => {
    const adapter = new EventAdapter();
    expect(adapter.handle({ type: 'message.part.updated', properties: {} } as never).events).toEqual([]);
    expect(
      adapter.handle({ type: 'message.part.updated', properties: { part: { type: 'file', id: 'f1', sessionID: 'ses_1' } } } as never).events,
    ).toEqual([]);
    expect(adapter.handle({ type: 'message.part.delta', properties: { sessionID: 'ses_1' } } as never).events).toEqual([]);
    expect(
      adapter.handle({ type: 'message.part.delta', properties: { sessionID: 'ses_1', partID: 'p1', field: 'text', delta: '' } } as never).events,
    ).toEqual([]);
    expect(adapter.handle({ type: 'permission.updated', properties: { id: 'perm_2' } } as never).events).toEqual([
      { type: 'approval_required', approval: { id: 'perm_2', toolName: '', args: '{}', toolCallId: 'perm_2' } },
    ]);
    expect(adapter.handle({ type: 'session.error', properties: { error: 'net down' } } as never).events).toEqual([
      { type: 'error', error: 'net down' },
    ]);
    expect(adapter.handle({ type: 'session.idle' } as never).events).toEqual([{ type: 'done' }]);
  });
});
