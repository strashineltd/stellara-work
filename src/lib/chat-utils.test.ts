import { describe, it, expect, vi } from 'vitest';
import {
  applyStreamEventToEntries, formatRelativeTime, formatFileSize,
  messagesToEntries, entriesToMessages, buildHistory, clearEntryEnterMotion,
  type DisplayEntry, type PresentEntry,
} from './chat-utils';
import type { AttachmentMeta, ChatStreamEvent, MessageRow, PlanApprovalRequest } from '../../shared/ipc';

const IMG_ATT: AttachmentMeta = {
  id: 'shot-1.png', name: 'shot-1.png', size: 2048,
  mimeType: 'image/png', kind: 'image', relPath: 'sess-1/shot-1.png',
};

const FILE_ATT: AttachmentMeta = {
  id: 'notes.txt', name: 'notes.txt', size: 1024,
  mimeType: 'text/plain', kind: 'file', relPath: 'sess-1/notes.txt',
};

function apply(prev: DisplayEntry[], ev: ChatStreamEvent, present?: PresentEntry) {
  const setPendingApproval = vi.fn();
  const setPendingPlanApproval = vi.fn();
  const next = applyStreamEventToEntries(prev, ev, setPendingApproval, setPendingPlanApproval, present);
  return { next, setPendingApproval, setPendingPlanApproval };
}

describe('applyStreamEventToEntries — reasoning events', () => {
  it('reasoning event pushes a reasoning entry', () => {
    const { next } = apply([], { type: 'reasoning', content: '第一步：分析需求' });
    expect(next).toHaveLength(1);
    expect(next![0]).toMatchObject({ kind: 'reasoning', content: '第一步：分析需求' });
  });

  it('consecutive reasoning deltas merge into the same entry', () => {
    let entries: DisplayEntry[] = [];
    for (const ev of [
      { type: 'reasoning', content: '第一步' },
      { type: 'reasoning', content: '第二步' },
    ] as ChatStreamEvent[]) {
      const { next } = apply(entries, ev);
      entries = next!;
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]!).toMatchObject({ kind: 'reasoning', content: '第一步第二步' });
  });

  it('reasoning after content starts a new entry', () => {
    const { next } = apply(
      [{ kind: 'assistant', content: '正文' }],
      { type: 'reasoning', content: '继续思考' },
    );
    expect(next).toHaveLength(2);
    expect(next![1]).toMatchObject({ kind: 'reasoning', content: '继续思考' });
  });

  it('reasoning 插入到空 assistant 之前（思考显示在回复前）', () => {
    const { next } = apply(
      [{ kind: 'assistant', content: '' }],
      { type: 'reasoning', content: '先思考' },
    );
    expect(next).toHaveLength(2);
    expect(next![0]).toMatchObject({ kind: 'reasoning', content: '先思考' });
    expect(next![1]).toMatchObject({ kind: 'assistant', content: '' });
  });

  it('reasoning 之后到达的 content 追加到 assistant，而不是被丢弃', () => {
    // 回归：加 reasoning 展示后，content 只看最后一条导致回复丢失
    let entries: DisplayEntry[] = [{ kind: 'assistant', content: '' }];
    for (const ev of [
      { type: 'reasoning', content: '思考中' },
      { type: 'content', content: '你好！' },
      { type: 'content', content: ' 👋' },
    ] as ChatStreamEvent[]) {
      const { next } = apply(entries, ev);
      entries = next!;
    }
    expect(entries).toHaveLength(2);
    expect(entries[1]!).toMatchObject({ kind: 'assistant', content: '你好！ 👋' });
  });

  it('工具调用之后的 content 仍追加到 assistant', () => {
    let entries: DisplayEntry[] = [{ kind: 'assistant', content: '' }];
    for (const ev of [
      { type: 'tool_call', toolCall: { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } } },
      { type: 'tool_result', toolResult: { name: 'read_file', toolCallId: 'c1', result: { ok: true, output: 'x' } } },
      { type: 'content', content: '完成' },
    ] as ChatStreamEvent[]) {
      const { next } = apply(entries, ev);
      entries = next!;
    }
    const assistant = entries.find((e) => e.kind === 'assistant');
    expect(assistant).toMatchObject({ kind: 'assistant', content: '完成' });
  });
});

describe('applyStreamEventToEntries — plan events', () => {
  it('plan event pushes a plan entry with all steps pending', () => {
    const { next } = apply([], {
      type: 'plan',
      plan: ['读 README', '写测试'],
    });
    expect(next?.at(-1)).toEqual({
      kind: 'plan',
      steps: [
        { description: '读 README', status: 'pending' },
        { description: '写测试', status: 'pending' },
      ],
    });
  });

  it('plan_approval_required only sets the plan approval, does not touch entries', () => {
    const req: PlanApprovalRequest = { id: 'plan-1', plan: ['a'] };
    const { next, setPendingPlanApproval } = apply([], { type: 'plan_approval_required', planApproval: req });
    expect(next).toBeNull();
    expect(setPendingPlanApproval).toHaveBeenCalledWith(req);
  });

  it('plan_progress updates the latest plan entry steps', () => {
    const prev: DisplayEntry[] = [{ kind: 'plan', steps: [{ description: 'a', status: 'pending' }] }];
    const { next } = apply(prev, {
      type: 'plan_progress',
      planSteps: [
        { description: 'a', status: 'completed' },
        { description: 'b', status: 'in_progress' },
      ],
    });
    const plan = next?.at(-1);
    expect(plan && plan.kind === 'plan' ? plan.steps : null).toEqual([
      { description: 'a', status: 'completed' },
      { description: 'b', status: 'in_progress' },
    ]);
  });

  it('verify event pushes a verify entry', () => {
    const { next } = apply([], { type: 'verify', phase: 'post_edit', target: 'src/a.ts' });
    expect(next?.at(-1)).toEqual({ kind: 'verify', phase: 'post_edit', target: 'src/a.ts' });
  });
});

describe('applyStreamEventToEntries — subagent events', () => {
  it('subagent_summary event pushes a subagent_summary entry with results', () => {
    const { next } = apply([], {
      type: 'subagent_summary',
      subagentResults: [
        { id: 'sub-abc', summary: '重构完成', ok: true, elapsedMs: 4200 },
        { id: 'sub-def', summary: '测试失败', ok: false, elapsedMs: 900 },
      ],
    });
    expect(next?.at(-1)).toEqual({
      kind: 'subagent_summary',
      results: [
        { id: 'sub-abc', summary: '重构完成', ok: true, elapsedMs: 4200 },
        { id: 'sub-def', summary: '测试失败', ok: false, elapsedMs: 900 },
      ],
    });
  });

  it('ignores subagent_start / progress / done (no entry; MainView state only)', () => {
    const { next } = apply([], {
      type: 'subagent_start',
      subagentId: 'sub-abc',
      subagentTask: '重构',
    });
    expect(next?.length).toBe(0);
  });
});

describe('applyStreamEventToEntries — presentation metadata', () => {
  it('gives history deterministic keys without enter motion', () => {
    const entries = messagesToEntries([
      { sessionId: 's1', position: 3, role: 'user', content: 'hi', createdAt: 1 },
    ]);
    expect(entries[0]?.presentation).toEqual({
      key: 'history:s1:3:user',
      sessionId: 's1',
    });
  });

  it('presents a tool call append as discrete', () => {
    const present = vi.fn((entry: DisplayEntry) => entry);
    applyStreamEventToEntries(
      [],
      {
        type: 'tool_call',
        toolCall: {
          id: 'tc-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        },
      },
      vi.fn(),
      vi.fn(),
      present,
    );
    expect(present).toHaveBeenCalledWith({
      kind: 'tool_call',
      id: 'tc-1',
      name: 'read_file',
      args: '{"path":"a.ts"}',
    }, 'discrete');
  });

  it('presents an error append as status', () => {
    const present = vi.fn((entry: DisplayEntry) => entry);
    applyStreamEventToEntries(
      [{ kind: 'user', content: 'x' }],
      { type: 'error', error: 'offline' },
      vi.fn(),
      vi.fn(),
      present,
    );
    expect(present).toHaveBeenCalledWith({
      kind: 'error',
      message: 'offline',
      meta: undefined,
    }, 'status');
  });

  it('does not present update-only events', () => {
    const events: ChatStreamEvent[] = [
      { type: 'content', content: 'x' },
      { type: 'plan_progress', planSteps: [{ description: 'a', status: 'completed' }] },
      { type: 'approval_required', approval: { id: 'a', toolName: 'edit_file', args: '{}', toolCallId: 'tc' } },
      { type: 'plan_approval_required', planApproval: { id: 'p', plan: ['a'] } },
      { type: 'usage', totals: { promptTokens: 1, completionTokens: 2 } },
      { type: 'subagent_progress', subagentId: 'sub-1', subagentTool: 'read_file' },
    ];
    for (const event of events) {
      const present = vi.fn((entry: DisplayEntry) => entry);
      applyStreamEventToEntries(
        [{ kind: 'assistant', content: '' }, { kind: 'plan', steps: [] }],
        event,
        vi.fn(),
        vi.fn(),
        present,
      );
      expect(present, event.type).not.toHaveBeenCalled();
    }
  });

  it('clears enter motion without changing keys or untouched entry identity', () => {
    const animated = { kind: 'user', content: 'x', presentation: { key: 'k', sessionId: 's', enter: 'discrete' } } as DisplayEntry;
    const stable = { kind: 'assistant', content: 'y', presentation: { key: 'y', sessionId: 's' } } as DisplayEntry;
    const result = clearEntryEnterMotion([animated, stable]);
    expect(result[0]?.presentation).toEqual({ key: 'k', sessionId: 's', enter: undefined });
    expect(result[1]).toBe(stable);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.now();

  it('returns 刚刚 for timestamps under a minute old', () => {
    expect(formatRelativeTime(now - 10_000)).toBe('刚刚');
  });

  it('returns minutes ago for timestamps under an hour old', () => {
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5 分钟前');
  });

  it('returns hours ago for timestamps under a day old', () => {
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe('3 小时前');
  });

  it('returns a month/day date for older timestamps', () => {
    const older = new Date(2026, 0, 15).getTime();
    expect(formatRelativeTime(older)).toBe('1 月 15 日');
  });
});

describe('formatFileSize', () => {
  it('renders bytes for small files', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('renders KB for kilobyte files', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('renders MB for large files', () => {
    expect(formatFileSize(3_500_000)).toBe('3.3 MB');
  });
});

describe('attachments round-trip (user entries)', () => {
  it('messagesToEntries parses user attachments JSON', () => {
    const rows: MessageRow[] = [
      { sessionId: 's', position: 0, role: 'user', content: '看图', attachments: JSON.stringify([IMG_ATT, FILE_ATT]), createdAt: 1 },
      { sessionId: 's', position: 1, role: 'user', content: '无附件', createdAt: 2 },
    ];
    const entries = messagesToEntries(rows);
    expect(entries[0]).toEqual({
      kind: 'user',
      content: '看图',
      attachments: [IMG_ATT, FILE_ATT],
      presentation: { key: 'history:s:0:user', sessionId: 's' },
    });
    expect(entries[1]).toEqual({
      kind: 'user',
      content: '无附件',
      presentation: { key: 'history:s:1:user', sessionId: 's' },
    });
    const second = entries[1];
    expect(second && second.kind === 'user' ? second.attachments : undefined).toBeUndefined();
  });

  it('messagesToEntries ignores broken attachments JSON', () => {
    const rows: MessageRow[] = [
      { sessionId: 's', position: 0, role: 'user', content: 'hi', attachments: '{broken', createdAt: 1 },
    ];
    const entries = messagesToEntries(rows);
    expect(entries[0]).toEqual({
      kind: 'user',
      content: 'hi',
      presentation: { key: 'history:s:0:user', sessionId: 's' },
    });
  });

  it('entriesToMessages serializes user attachments as JSON', () => {
    const msgs = entriesToMessages([{ kind: 'user', content: '看图', attachments: [IMG_ATT] }], 's');
    expect(JSON.parse(msgs[0]!.attachments ?? 'null')).toEqual([IMG_ATT]);
  });

  it('entriesToMessages leaves attachments undefined when absent', () => {
    const msgs = entriesToMessages([{ kind: 'user', content: 'hi' }], 's');
    expect(msgs[0]!.attachments).toBeUndefined();
  });

  it('entriesToMessages omits renderer presentation data (round-trip)', () => {
    const rows: MessageRow[] = [
      { sessionId: 's', position: 0, role: 'user', content: 'hi', createdAt: 1 },
      { sessionId: 's', position: 1, role: 'assistant', content: 'ok', createdAt: 2 },
      { sessionId: 's', position: 2, role: 'tool', content: 'out', toolCallId: 'tc-1', toolName: 'read_file', meta: '{"ok":true}', createdAt: 3 },
    ];
    const entries = messagesToEntries(rows);
    const round = entriesToMessages(entries, 's');
    expect(round.map((r) => ({ ...r, createdAt: 0 }))).toEqual(rows.map((r) => ({ ...r, createdAt: 0 })));
  });

  it('buildHistory passes user attachments through', () => {
    const history = buildHistory([{ kind: 'user', content: '看图', attachments: [IMG_ATT] }]);
    expect(history[0]).toEqual({ role: 'user', content: '看图', attachments: [IMG_ATT] });
  });

  it('persists ok inside tool_result meta JSON', () => {
    const entries: DisplayEntry[] = [
      { kind: 'tool_result', toolCallId: 'tc-1', name: 'web_search', ok: false, output: 'boom', error: 'network' },
    ];
    const rows = entriesToMessages(entries, 's');
    const row = rows.find((r) => r.role === 'tool')!;
    expect(row.toolName).toBe('web_search');
    const meta = JSON.parse(row.meta ?? '{}') as { ok?: boolean };
    expect(meta.ok).toBe(false);
  });

  it('messagesToEntries strips {ok}-only meta on reload (kindless meta => undefined)', () => {
    const rows: MessageRow[] = [
      {
        sessionId: 's', position: 0, role: 'tool', content: 'done', toolCallId: 'tc-1', toolName: 'web_search',
        meta: JSON.stringify({ ok: true }), createdAt: 1,
      },
    ];
    const entries = messagesToEntries(rows);
    const tool = entries[0];
    expect(tool.kind).toBe('tool_result');
    if (tool.kind === 'tool_result') {
      expect(tool.meta).toBeUndefined();
      expect(tool.ok).toBe(true);
    }
  });

  it('messagesToEntries keeps ToolResultMeta with kind on reload', () => {
    const rows: MessageRow[] = [
      {
        sessionId: 's', position: 0, role: 'tool', content: 'ran', toolCallId: 'tc-2', toolName: 'bash',
        meta: JSON.stringify({ ok: true, kind: 'command', command: 'ls', stdout: 'a', stderr: '', exitCode: 0, durationMs: 5 }),
        createdAt: 1,
      },
    ];
    const entries = messagesToEntries(rows);
    const tool = entries[0];
    expect(tool.kind).toBe('tool_result');
    if (tool.kind === 'tool_result') {
      expect(tool.meta).toEqual({ ok: true, kind: 'command', command: 'ls', stdout: 'a', stderr: '', exitCode: 0, durationMs: 5 });
      expect(tool.ok).toBe(true);
    }
  });

  it('messagesToEntries fallback: plain output without meta reconstructs as ok (not inverted)', () => {
    const rows: MessageRow[] = [
      {
        sessionId: 's', position: 0, role: 'tool', content: 'plain success output', toolCallId: 'tc-1', toolName: 'web_search',
        createdAt: 1,
      },
    ];
    const entries = messagesToEntries(rows);
    const tool = entries[0];
    expect(tool.kind).toBe('tool_result');
    if (tool.kind === 'tool_result') {
      expect(tool.ok).toBe(true);
      expect(tool.meta).toBeUndefined();
      expect(tool.output).toBe('plain success output');
    }
  });

  it('messagesToEntries fallback: Error: output without meta reconstructs as failure (not inverted)', () => {
    const rows: MessageRow[] = [
      {
        sessionId: 's', position: 0, role: 'tool', content: 'Error: boom', toolCallId: 'tc-2', toolName: 'web_search',
        createdAt: 1,
      },
    ];
    const entries = messagesToEntries(rows);
    const tool = entries[0];
    expect(tool.kind).toBe('tool_result');
    if (tool.kind === 'tool_result') {
      expect(tool.ok).toBe(false);
      expect(tool.meta).toBeUndefined();
      expect(tool.output).toBe('boom');
    }
  });
});
