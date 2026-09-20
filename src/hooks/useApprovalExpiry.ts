import { useEffect, useState } from 'react';

/** 失效后到通知父组件清理卡片的延迟（给用户一个"已超时"的可见反馈） */
export const APPROVAL_EXPIRED_CLEAR_DELAY_MS = 1_500;

/**
 * 审批倒计时/失效 hook（ApprovalTopBar 与 PlanCard 共用）。
 *
 * - `expiresAt` 未提供：`secondsLeft=null`、`expired=false`（server 桥接等无超时场景）
 * - 到点后 `expired=true`；若提供 `onExpired`，延迟 1.5s 调用一次（父组件清卡片）
 */
export function useApprovalExpiry(
  expiresAt: number | undefined,
  onExpired?: () => void,
): { secondsLeft: number | null; expired: boolean } {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasDeadline = expiresAt !== undefined;
  const expired = hasDeadline && nowMs >= expiresAt;
  const secondsLeft = hasDeadline ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000)) : null;

  useEffect(() => {
    if (!hasDeadline || expired) return;
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [hasDeadline, expired]);

  useEffect(() => {
    if (!expired || !onExpired) return;
    const timer = setTimeout(onExpired, APPROVAL_EXPIRED_CLEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [expired, onExpired]);

  return { secondsLeft, expired };
}
