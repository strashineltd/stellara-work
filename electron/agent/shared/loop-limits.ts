/** 循环限额与超限决策（两条 loop 共用） */

export const MAX_TOOL_CALLS_DEFAULT = 50;
export const MAX_ITERATIONS_DEFAULT = 200;

export type LimitDecision =
  | { kind: 'continue' }
  | { kind: 'force_approval'; message: string }
  | { kind: 'error'; message: string; hint: string };

export function evaluateToolCallLimit(
  totalCalls: number,
  maxCalls: number,
  opts: { requireApprovalAfterLimit?: boolean } = {},
): LimitDecision {
  if (totalCalls <= maxCalls) return { kind: 'continue' };
  if (opts.requireApprovalAfterLimit !== false) {
    return { kind: 'force_approval', message: `\n\n[已达到工具调用上限(${maxCalls})，进入审批模式]` };
  }
  return {
    kind: 'error',
    message: `工具调用次数超过限制 (${maxCalls})`,
    hint: '工具调用次数超过限制',
  };
}
