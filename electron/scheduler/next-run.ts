import type { ScheduledTask, ScheduledTaskPatch } from '@shared/ipc';
import { computeNextRun } from './engine';

/** P19：update 重算结果 —— changed=false 表示排期与启停均未变化，不写 nextRunAt */
export type ScheduledUpdateNextRun =
  | { changed: false }
  | { changed: true; nextRunAt: number | null };

/**
 * P19：update 的排期重算（纯函数）。
 *
 * 排期或启停任一变化时无条件校验表达式（非法 / once 时间已过 → 抛中文错误，
 * 即使本次是停用操作也不落库非法表达式）；校验通过后按最终启用状态落 nextRunAt
 * （停用 → null）。
 */
export function nextRunPatchForUpdate(
  current: Pick<ScheduledTask, 'scheduleKind' | 'scheduleExpr' | 'enabled'>,
  patch: Pick<ScheduledTaskPatch, 'scheduleKind' | 'scheduleExpr' | 'enabled'>,
  now: Date,
): ScheduledUpdateNextRun {
  const scheduleChanged =
    (patch.scheduleKind !== undefined && patch.scheduleKind !== current.scheduleKind) ||
    (patch.scheduleExpr !== undefined && patch.scheduleExpr !== current.scheduleExpr);
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== current.enabled;
  if (!scheduleChanged && !enabledChanged) return { changed: false };
  const next = computeNextRun(
    patch.scheduleKind ?? current.scheduleKind,
    patch.scheduleExpr ?? current.scheduleExpr,
    now,
  );
  if (!next) throw new Error('调度表达式无效或时间已过，请检查后重试');
  return { changed: true, nextRunAt: (patch.enabled ?? current.enabled) ? next.getTime() : null };
}

/**
 * P21：启用路径的下一次运行时间。无法排期（非法 / once 时间已过）返回 null，
 * 调用方据此保持任务停用，避免 enabled=true 却永不触发的死任务。
 */
export function enableNextRunAt(
  task: Pick<ScheduledTask, 'scheduleKind' | 'scheduleExpr'>,
  now: Date,
): number | null {
  return computeNextRun(task.scheduleKind, task.scheduleExpr, now)?.getTime() ?? null;
}
