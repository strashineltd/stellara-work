import { describe, expect, it } from 'vitest';
import { APPROVAL_TIMEOUT_MAX_MS, APPROVAL_TIMEOUT_MIN_MS, clampApprovalTimeout } from './approval-timing';

describe('clampApprovalTimeout', () => {
  it('未指定时使用回退值', () => {
    expect(clampApprovalTimeout(undefined, 60_000)).toBe(60_000);
    expect(clampApprovalTimeout(undefined, 300_000)).toBe(300_000);
  });

  it('低于下限时抬到最小值', () => {
    expect(clampApprovalTimeout(10, 60_000)).toBe(APPROVAL_TIMEOUT_MIN_MS);
  });

  it('高于上限时压到最大值', () => {
    expect(clampApprovalTimeout(999_999, 60_000)).toBe(APPROVAL_TIMEOUT_MAX_MS);
  });

  it('区间内原样返回', () => {
    expect(clampApprovalTimeout(45_000, 60_000)).toBe(45_000);
  });
});
