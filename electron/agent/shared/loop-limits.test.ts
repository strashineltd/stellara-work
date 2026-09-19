import { describe, expect, it } from 'vitest';
import { MAX_TOOL_CALLS_DEFAULT, MAX_ITERATIONS_DEFAULT, evaluateToolCallLimit } from './loop-limits';

describe('evaluateToolCallLimit', () => {
  it('导出与循环一致的默认上限', () => {
    expect(MAX_TOOL_CALLS_DEFAULT).toBe(50);
    expect(MAX_ITERATIONS_DEFAULT).toBe(200);
  });

  it('未超限继续', () => {
    expect(evaluateToolCallLimit(3, 5)).toEqual({ kind: 'continue' });
  });

  it('恰好等于上限不触发', () => {
    expect(evaluateToolCallLimit(5, 5)).toEqual({ kind: 'continue' });
  });

  it('超限默认转强制审批', () => {
    const decision = evaluateToolCallLimit(6, 5);
    expect(decision.kind).toBe('force_approval');
    if (decision.kind === 'force_approval') {
      expect(decision.message).toContain('已达到工具调用上限(5)');
      expect(decision.message).toContain('进入审批模式');
    }
  });

  it('requireApprovalAfterLimit=false 时报错并携带提示', () => {
    const decision = evaluateToolCallLimit(6, 5, { requireApprovalAfterLimit: false });
    expect(decision).toEqual({
      kind: 'error',
      message: '工具调用次数超过限制 (5)',
      hint: '工具调用次数超过限制',
    });
  });
});
