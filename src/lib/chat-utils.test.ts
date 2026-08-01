import { describe, it, expect, vi } from 'vitest';
import { applyStreamEventToEntries, type DisplayEntry } from './chat-utils';
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
