import { describe, it, expect, vi } from 'vitest';
import { applyStreamEventToEntries, formatRelativeTime, type DisplayEntry } from './chat-utils';
import type { ChatStreamEvent, PlanApprovalRequest } from '../../shared/ipc';

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
