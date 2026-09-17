import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@shared/ipc';
import { enableNextRunAt, nextRunPatchForUpdate } from './next-run';

const T0 = new Date('2026-01-05T08:00:00.000Z');

type ScheduleFields = Pick<ScheduledTask, 'scheduleKind' | 'scheduleExpr' | 'enabled'>;

function task(overrides: Partial<ScheduleFields> = {}): ScheduleFields {
  return { scheduleKind: 'interval', scheduleExpr: '30', enabled: true, ...overrides };
}

describe('nextRunPatchForUpdate (P19)', () => {
  it('停用 + 改排期时仍校验表达式：非法表达式拒绝（不得落库）', () => {
    expect(() => nextRunPatchForUpdate(task(), { enabled: false, scheduleExpr: 'abc' }, T0))
      .toThrow(/调度表达式无效或时间已过/);
  });

  it('已停用任务改排期时同样拒绝非法表达式', () => {
    expect(() => nextRunPatchForUpdate(task({ enabled: false }), { scheduleExpr: 'not-a-cron' }, T0))
      .toThrow(/调度表达式无效或时间已过/);
  });

  it('停用 + 合法排期：校验通过但 nextRunAt 为 null', () => {
    expect(nextRunPatchForUpdate(task(), { enabled: false, scheduleExpr: '45' }, T0))
      .toEqual({ changed: true, nextRunAt: null });
  });

  it('单纯停用（不改排期）：校验现有表达式并清空 nextRunAt', () => {
    expect(nextRunPatchForUpdate(task(), { enabled: false }, T0))
      .toEqual({ changed: true, nextRunAt: null });
  });

  it('重新启用过期 once：拒绝（表达式无法排期）', () => {
    const once = task({ scheduleKind: 'once', scheduleExpr: '2026-01-05T07:00:00.000Z', enabled: false });
    expect(() => nextRunPatchForUpdate(once, { enabled: true }, T0))
      .toThrow(/调度表达式无效或时间已过/);
  });

  it('启用状态下改排期：重算 nextRunAt', () => {
    expect(nextRunPatchForUpdate(task(), { scheduleExpr: '15' }, T0))
      .toEqual({ changed: true, nextRunAt: T0.getTime() + 15 * 60_000 });
  });

  it('已停用任务改为合法排期：校验通过且保持 null（仍不排期）', () => {
    expect(nextRunPatchForUpdate(task({ enabled: false }), { scheduleExpr: '15' }, T0))
      .toEqual({ changed: true, nextRunAt: null });
  });

  it('排期与启停均未变化：跳过重算', () => {
    expect(nextRunPatchForUpdate(task(), { enabled: true, scheduleExpr: '30' }, T0))
      .toEqual({ changed: false });
    expect(nextRunPatchForUpdate(task({ enabled: false }), { enabled: false, name: 'x' }, T0))
      .toEqual({ changed: false });
  });
});

describe('enableNextRunAt (P21)', () => {
  it('合法排期返回下一次运行时间戳', () => {
    expect(enableNextRunAt(task(), T0)).toBe(T0.getTime() + 30 * 60_000);
  });

  it('过期 once 返回 null（调用方保持停用）', () => {
    expect(enableNextRunAt(
      { scheduleKind: 'once', scheduleExpr: '2026-01-05T07:00:00.000Z' },
      T0,
    )).toBeNull();
  });

  it('非法表达式返回 null', () => {
    expect(enableNextRunAt({ scheduleKind: 'cron', scheduleExpr: 'not a cron' }, T0)).toBeNull();
  });
});
