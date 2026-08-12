import { describe, it, expect, vi } from 'vitest';
import {
  applyStreamEventToEntries, formatRelativeTime, formatFileSize,
  messagesToEntries, entriesToMessages, buildHistory,
  type DisplayEntry,
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

function apply(prev: DisplayEntry[], ev: ChatStreamEvent) {
  const setPendingApproval = vi.fn();
  const setPendingPlanApproval = vi.fn();
  const next = applyStreamEventToEntries(prev, ev, setPendingApproval, setPendingPlanApproval);
  return { next, setPendingApproval, setPendingPlanApproval };
}

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
    expect(entries[0]).toEqual({ kind: 'user', content: '看图', attachments: [IMG_ATT, FILE_ATT] });
    expect(entries[1]).toEqual({ kind: 'user', content: '无附件' });
    const second = entries[1];
    expect(second && second.kind === 'user' ? second.attachments : undefined).toBeUndefined();
  });

  it('messagesToEntries ignores broken attachments JSON', () => {
    const rows: MessageRow[] = [
      { sessionId: 's', position: 0, role: 'user', content: 'hi', attachments: '{broken', createdAt: 1 },
    ];
    const entries = messagesToEntries(rows);
    expect(entries[0]).toEqual({ kind: 'user', content: 'hi' });
  });

  it('entriesToMessages serializes user attachments as JSON', () => {
    const msgs = entriesToMessages([{ kind: 'user', content: '看图', attachments: [IMG_ATT] }], 's');
    expect(JSON.parse(msgs[0]!.attachments ?? 'null')).toEqual([IMG_ATT]);
  });

  it('entriesToMessages leaves attachments undefined when absent', () => {
    const msgs = entriesToMessages([{ kind: 'user', content: 'hi' }], 's');
    expect(msgs[0]!.attachments).toBeUndefined();
  });

  it('buildHistory passes user attachments through', () => {
    const history = buildHistory([{ kind: 'user', content: '看图', attachments: [IMG_ATT] }]);
    expect(history[0]).toEqual({ role: 'user', content: '看图', attachments: [IMG_ATT] });
  });
});
