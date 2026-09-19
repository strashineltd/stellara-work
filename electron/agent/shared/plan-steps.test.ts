import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { findPlanStepForTool } from './plan-steps';
import type { PlanStep } from '../../context/context-hub';

function step(id: string, description: string, status: PlanStep['status'] = 'pending'): PlanStep {
  return { id, description, status, relatedFiles: [], requiredVerification: [], evidenceIds: [] };
}

async function hubWithSteps(steps: PlanStep[]): Promise<ContextHub> {
  const hub = new ContextHub('plan-steps-test', '/tmp', 100_000, 16_384, { persist: false });
  await hub.commitEvent('plan_created', { objective: 'o', constraints: [], steps });
  return hub;
}

describe('findPlanStepForTool', () => {
  it('in_progress 步骤优先返回', async () => {
    const hub = await hubWithSteps([step('s1', '改 a.ts'), step('s2', '跑测试', 'in_progress')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', { path: 'a.ts' })?.id).toBe('s2');
  });

  it('按路径匹配 pending 步骤', async () => {
    const hub = await hubWithSteps([step('s1', '修改 src/a.ts'), step('s2', '运行 npm test 验证')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', { path: 'src/a.ts' })?.id).toBe('s1');
  });

  it('按命令关键词匹配验证步骤', async () => {
    const hub = await hubWithSteps([step('s1', '实现功能'), step('s2', '运行测试并验证')]);
    expect(findPlanStepForTool(hub.getContext(), 'run_command', { command: 'npm test' })?.id).toBe('s2');
  });

  it('写工具按实现类关键词匹配', async () => {
    const hub = await hubWithSteps([step('s1', '实现登录逻辑'), step('s2', '运行测试')]);
    expect(findPlanStepForTool(hub.getContext(), 'write_file', { path: 'login.ts' })?.id).toBe('s1');
  });

  it('无匹配时回退第一个 pending', async () => {
    const hub = await hubWithSteps([step('s1', '某步骤'), step('s2', '另一步骤')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', {})?.id).toBe('s1');
  });

  it('task_complete / dispatch_subagents 不关联步骤', async () => {
    const hub = await hubWithSteps([step('s1', '某步骤')]);
    expect(findPlanStepForTool(hub.getContext(), 'task_complete', {})).toBeUndefined();
    expect(findPlanStepForTool(hub.getContext(), 'dispatch_subagents', {})).toBeUndefined();
  });
});
