import { useEffect, useRef, useState } from 'react';

/** 失效后到通知父组件清理卡片的延迟（给用户一个"已超时"的可见反馈） */
export const APPROVAL_EXPIRED_CLEAR_DELAY_MS = 1_500;

/**
 * 审批倒计时/失效 hook（ApprovalTopBar 与 PlanCard 共用）。
 *
 * - `expiresAt` 未提供：`secondsLeft=null`、`expired=false`（server 桥接等无超时场景）
 * - 到点后 `expired=true`（精确到截止点的 timeout，不依赖 500ms tick 对齐）
 * - 若提供 `onExpired`，延迟 1.5s 调用一次；回调走 ref，父组件重渲染不会重置计时
 */
export function useApprovalExpiry(
  expiresAt: number | undefined,
  onExpired?: () => void,
): { secondsLeft: number | null; expired: boolean } {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  });

  const hasDeadline = expiresAt !== undefined;
  const expired = hasDeadline && nowMs >= expiresAt;
  const secondsLeft = hasDeadline ? Math.max(0, Math.ceil((expiresAt - nowMs) / 1000)) : null;

  // expiresAt 变化（新审批/重新进入审批）时刷新时钟，避免沿用旧采样
  useEffect(() => {
    setNowMs(Date.now());
  }, [expiresAt]);

  // 倒计时秒数：每 500ms 采样
  useEffect(() => {
    if (!hasDeadline || expired) return;
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [hasDeadline, expired]);

  // 精确到截止点触发一次失效（500ms tick 不保证对齐截止点）
  useEffect(() => {
    if (!hasDeadline || expired) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [hasDeadline, expired, expiresAt]);

  // 失效后延迟通知父组件（仅依赖 expired：回调引用变化不重置计时）
  useEffect(() => {
    if (!expired) return;
    const timer = setTimeout(() => onExpiredRef.current?.(), APPROVAL_EXPIRED_CLEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [expired]);

  return { secondsLeft, expired };
}
