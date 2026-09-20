/**
 * 审批超时钳制（单点定义）。
 * 工具/计划/子代理/浏览器审批共用，保证事件里的 expiresAt 与实际等待时间一致。
 */
export const APPROVAL_TIMEOUT_MIN_MS = 1_000;
export const APPROVAL_TIMEOUT_MAX_MS = 300_000;

export function clampApprovalTimeout(requestedMs: number | undefined, fallbackMs: number): number {
  const value = requestedMs ?? fallbackMs;
  return Math.min(Math.max(value, APPROVAL_TIMEOUT_MIN_MS), APPROVAL_TIMEOUT_MAX_MS);
}
