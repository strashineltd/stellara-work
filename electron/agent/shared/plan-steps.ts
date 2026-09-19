import type { PlanStep, TaskContext } from '../../context/context-hub';

/**
 * 计划步骤匹配（原 Responses / Anthropic 两处逐字重复实现合一）。
 */
export function findPlanStepForTool(
  context: Readonly<TaskContext>,
  toolName: string,
  args: Record<string, unknown>,
): PlanStep | undefined {
  if (toolName === 'task_complete' || toolName === 'dispatch_subagents') return undefined;
  const active = context.plan.steps.find((step) => step.status === 'in_progress');
  if (active) return active;
  const pathValue = typeof args.path === 'string' ? args.path.toLowerCase() : '';
  const commandValue = typeof args.command === 'string' ? args.command.toLowerCase() : '';
  return context.plan.steps.find((step) => {
    if (step.status !== 'pending') return false;
    const text = step.description.toLowerCase();
    if (pathValue && text.includes(pathValue)) return true;
    if (commandValue && text.includes(commandValue)) return true;
    if (toolName === 'run_command') return /测试|验证|构建|运行|test|build|verify/.test(text);
    if (toolName === 'write_file' || toolName === 'edit_file') return /实现|修改|编辑|创建|写入|add|edit|implement/.test(text);
    return false;
  }) ?? context.plan.steps.find((step) => step.status === 'pending');
}
