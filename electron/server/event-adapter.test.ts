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
    const part = (state: Record<string, unknown>) => ({
      type: 'message.part.updated',
      properties: { part: { type: 'tool', id: 't1', callID: 'call_1', sessionID: 'ses_1', tool: 'bash', state } },
    });
    expect(adapter.handle(part({ status: 'pending', input: { command: 'ls' } }) as never).events).toEqual([
      { type: 'tool_call', toolCall: { id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } } },
    ]);
    expect(adapter.handle(part({ status: 'running', input: { command: 'ls' } }) as never).events).toEqual([]);
    expect(adapter.handle(part({ status: 'completed', output: 'ok' }) as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'call_1', result: { ok: true, output: 'ok' } } },
    ]);
    expect(adapter.handle(part({ status: 'error', error: 'boom' }) as never).events).toEqual([
      { type: 'tool_result', toolResult: { name: 'bash', toolCallId: 'call_1', result: { ok: false, error: 'boom' } } },
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
    expect(adapter.handle({ type: 'permission.updated', properties: { id: 'perm_2' } } as never).events).toEqual([
      { type: 'approval_required', approval: { id: 'perm_2', toolName: '', args: '{}', toolCallId: 'perm_2' } },
    ]);
    expect(adapter.handle({ type: 'session.error', properties: { error: 'net down' } } as never).events).toEqual([
      { type: 'error', error: 'net down' },
    ]);
    expect(adapter.handle({ type: 'session.idle' } as never).events).toEqual([{ type: 'done' }]);
  });
});
