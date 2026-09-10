import { describe, expect, it } from 'vitest';
import { remoteMessagesToRows } from './message-adapter';

describe('remoteMessagesToRows', () => {
  it('maps user and assistant text and tools', () => {
    const rows = remoteMessagesToRows('s1', [
      { info: { id: 'm1', role: 'user', sessionID: 'ses_1', time: { created: 10 } }, parts: [{ type: 'text', id: 'p1', sessionID: 'ses_1', messageID: 'm1', text: '你好' }] },
      {
        info: { id: 'm2', role: 'assistant', sessionID: 'ses_1', time: { created: 20 } },
        parts: [
          { type: 'reasoning', id: 'r1', sessionID: 'ses_1', messageID: 'm2', text: '思考' },
          { type: 'text', id: 'p2', sessionID: 'ses_1', messageID: 'm2', text: '完成' },
          { type: 'tool', id: 't1', callID: 'call_1', sessionID: 'ses_1', messageID: 'm2', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'ok' } },
        ],
      },
    ]);
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool']);
    expect(rows[0]!.content).toBe('你好');
    expect(rows[1]!.content).toBe('完成');
    expect(JSON.parse(rows[1]!.toolCalls!)).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
    ]);
    expect(rows[2]).toMatchObject({ toolName: 'bash', toolCallId: 'call_1', content: 'ok' });
    expect(JSON.parse(rows[2]!.meta!)).toEqual({ ok: true });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('maps failed tools and keeps tool-only assistant rows', () => {
    const rows = remoteMessagesToRows('s1', [
      { info: { id: 'm1', role: 'assistant', sessionID: 'ses_1' }, parts: [{ type: 'tool', id: 't1', callID: 'c1', sessionID: 'ses_1', messageID: 'm1', tool: 'edit', state: { status: 'error', error: 'denied' } }] },
    ]);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool']);
    expect(rows[0]!.content).toBe('');
    expect(JSON.parse(rows[0]!.toolCalls!)).toEqual([
      { id: 'c1', type: 'function', function: { name: 'edit', arguments: '{}' } },
    ]);
    expect(rows[0]!.position).toBe(0);
    expect(rows[1]!.content).toBe('Error: denied');
    expect(JSON.parse(rows[1]!.meta!)).toEqual({ ok: false });
  });

  it('skips truly empty assistant messages', () => {
    const rows = remoteMessagesToRows('s1', [
      { info: { id: 'm1', role: 'assistant' } },
      {
        info: { id: 'm2', role: 'assistant' },
        parts: [
          { type: 'reasoning', id: 'r1', text: '思考' },
          { type: 'file', id: 'f1' },
          { type: 'text', id: 'p1' },
        ],
      },
    ]);
    expect(rows).toEqual([]);
  });

  it('tolerates missing parts, time, and state.input', () => {
    const rows = remoteMessagesToRows('s1', [
      { info: { id: 'm1', role: 'user' } },
      { info: { id: 'm2', role: 'assistant' } },
      { info: { id: 'm3', role: 'system' }, parts: [{ type: 'text', id: 'p0', text: 'ignored role' }] },
      {
        info: { id: 'm4', role: 'assistant', time: {} },
        parts: [
          { type: 'reasoning', id: 'r1', text: '思考' },
          { type: 'file', id: 'f1' },
          { type: 'text', id: 'p1' },
          { type: 'text', id: 'p2', text: '看' },
          { type: 'text', id: 'p3', text: '这里' },
          { type: 'tool', id: 't1', callID: 'c1', tool: 'read', state: { status: 'pending' } },
        ],
      },
    ]);
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]!.content).toBe('');
    expect(rows[1]!.content).toBe('看这里');
    expect(JSON.parse(rows[1]!.toolCalls!)).toEqual([
      { id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } },
    ]);
    for (const row of rows) expect(typeof row.createdAt).toBe('number');
  });

  it('prefers output over error and keeps completed tools without output empty', () => {
    const rows = remoteMessagesToRows('s1', [
      {
        info: { id: 'm1', role: 'assistant', time: { created: 5 } },
        parts: [
          { type: 'tool', id: 't1', callID: 'c1', tool: 'edit', state: { status: 'error', error: 'denied', output: 'partial' } },
          { type: 'tool', id: 't2', callID: 'c2', tool: 'edit', state: { status: 'completed' } },
        ],
      },
    ]);
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(rows[0]!.content).toBe('');
    expect(JSON.parse(rows[0]!.toolCalls!)).toEqual([
      { id: 'c1', type: 'function', function: { name: 'edit', arguments: '{}' } },
      { id: 'c2', type: 'function', function: { name: 'edit', arguments: '{}' } },
    ]);
    expect(rows[1]!.content).toBe('partial');
    expect(JSON.parse(rows[1]!.meta!)).toEqual({ ok: false });
    expect(rows[2]!.content).toBe('');
    expect(JSON.parse(rows[2]!.meta!)).toEqual({ ok: true });
    expect(rows[0]!.createdAt).toBe(5);
  });
});
