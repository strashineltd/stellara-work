import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '@shared/ipc';
import { SchedulerEngine, computeMissed, computeNextRun } from './engine';

const T0 = new Date('2026-01-05T08:00:00.000Z');

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1',
    name: '任务 t1',
    prompt: '说 hello',
    runtime: 'local',
    scheduleKind: 'interval',
    scheduleExpr: '10',
    enabled: true,
    nextRunAt: T0.getTime() + 60_000,
    lastRunAt: null,
    lastStatus: null,
    createdAt: T0.getTime(),
    updatedAt: T0.getTime(),
    ...overrides,
  };
}

function createTimerHarness() {
  let now = new Date(T0);
  let pending: { fn: () => void; ms: number } | null = null;
  let handleCount = 0;
  const setTimer = vi.fn((fn: () => void, ms: number) => {
    pending = { fn, ms };
    return ++handleCount;
  });
  const clearTimer = vi.fn(() => {
    pending = null;
  });
  return {
    setTimer,
    clearTimer,
    get pending() {
      return pending;
    },
    nowFn: () => now,
    advanceTo(date: Date) {
      now = date;
    },
    fire() {
      if (!pending) throw new Error('no pending timer');
      const { fn } = pending;
      pending = null;
      fn();
    },
  };
}

describe('computeNextRun', () => {
  it('returns the instant for a future once schedule', () => {
    expect(computeNextRun('once', '2026-01-05T09:30:00.000Z', T0)?.toISOString())
      .toBe('2026-01-05T09:30:00.000Z');
  });

  it('returns null for a once schedule at or before the reference time', () => {
    expect(computeNextRun('once', '2026-01-05T07:59:59.000Z', T0)).toBeNull();
    expect(computeNextRun('once', '2026-01-05T08:00:00.000Z', T0)).toBeNull();
  });

  it('returns null for an unparseable once schedule', () => {
    expect(computeNextRun('once', 'not-a-date', T0)).toBeNull();
    expect(computeNextRun('once', '', T0)).toBeNull();
  });

  it('adds interval minutes to the reference time', () => {
    expect(computeNextRun('interval', '15', T0)?.getTime()).toBe(T0.getTime() + 15 * 60_000);
  });

  it('returns null for non-positive or unparseable intervals', () => {
    expect(computeNextRun('interval', '0', T0)).toBeNull();
    expect(computeNextRun('interval', '-5', T0)).toBeNull();
    expect(computeNextRun('interval', 'abc', T0)).toBeNull();
    expect(computeNextRun('interval', '', T0)).toBeNull();
  });

  it('returns null when the computed interval overflows the Date range', () => {
    expect(computeNextRun('interval', '999999999999999', T0)).toBeNull();
    expect(computeNextRun('interval', '1e300', T0)).toBeNull();
  });

  it('finds the next minute for an every-minute cron expression regardless of timezone', () => {
    expect(computeNextRun('cron', '* * * * *', T0)?.toISOString()).toBe('2026-01-05T08:01:00.000Z');
  });

  it('finds the next local occurrence for a daily cron expression', () => {
    const next = computeNextRun('cron', '0 12 * * *', T0);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(T0.getTime());
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getSeconds()).toBe(0);
  });

  it('returns null for an invalid cron expression', () => {
    expect(computeNextRun('cron', 'not a cron', T0)).toBeNull();
    expect(computeNextRun('cron', '', T0)).toBeNull();
  });
});

describe('computeMissed', () => {
  it('selects enabled overdue tasks and filters the rest', () => {
    const now = new Date(T0.getTime() + 120_000);
    const overdue = makeTask({ id: 'overdue', nextRunAt: T0.getTime() + 60_000 });
    const future = makeTask({ id: 'future', nextRunAt: now.getTime() + 60_000 });
    const disabled = makeTask({ id: 'disabled', enabled: false, nextRunAt: T0.getTime() });
    const unscheduled = makeTask({ id: 'unscheduled', nextRunAt: null });
    const atBoundary = makeTask({ id: 'boundary', nextRunAt: now.getTime() });
    expect(
      computeMissed([future, disabled, overdue, unscheduled, atBoundary], now).map((t) => t.id),
    ).toEqual(['overdue']);
  });

  it('deduplicates repeated entries of the same task', () => {
    const now = new Date(T0.getTime() + 120_000);
    const first = makeTask({ id: 'm1', nextRunAt: T0.getTime() + 60_000 });
    const second = makeTask({ id: 'm2', nextRunAt: T0.getTime() + 30_000 });
    expect(computeMissed([first, second, first], now).map((t) => t.id)).toEqual(['m1', 'm2']);
  });
});

describe('SchedulerEngine', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function setup(tasks: ScheduledTask[]) {
    const harness = createTimerHarness();
    const listDue = vi.fn(() => tasks);
    const onFire = vi.fn(async (_task: ScheduledTask) => {});
    const engine = new SchedulerEngine({
      listDue,
      onFire,
      now: harness.nowFn,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    return { harness, listDue, onFire, engine };
  }

  it('arms a single timer for the earliest scheduled task', () => {
    const late = makeTask({ id: 'late', nextRunAt: T0.getTime() + 300_000 });
    const soon = makeTask({ id: 'soon', nextRunAt: T0.getTime() + 60_000 });
    const { harness, engine } = setup([late, soon]);
    engine.start();
    expect(harness.setTimer).toHaveBeenCalledTimes(1);
    expect(harness.pending?.ms).toBe(60_000);
  });

  it('ignores disabled tasks and tasks without a next run', () => {
    const { harness, engine } = setup([
      makeTask({ id: 'disabled', enabled: false }),
      makeTask({ id: 'unscheduled', nextRunAt: null }),
    ]);
    engine.start();
    expect(harness.setTimer).not.toHaveBeenCalled();
    expect(harness.pending).toBeNull();
  });

  it('fires only the tasks that are due when the timer fires', () => {
    const due = makeTask({ id: 'due', nextRunAt: T0.getTime() + 60_000 });
    const later = makeTask({ id: 'later', nextRunAt: T0.getTime() + 300_000 });
    const { harness, onFire, engine } = setup([due, later]);
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    harness.fire();
    expect(onFire.mock.calls.map((call) => call[0].id)).toEqual(['due']);
    expect(harness.pending?.ms).toBe(240_000);
  });

  it('fires every task due at the same moment in order', () => {
    const a = makeTask({ id: 'a', nextRunAt: T0.getTime() + 60_000 });
    const b = makeTask({ id: 'b', nextRunAt: T0.getTime() + 60_000 });
    const { harness, onFire, engine } = setup([a, b]);
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    harness.fire();
    expect(onFire.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b']);
    expect(harness.pending).toBeNull();
  });

  it('fires tasks in due order across several rounds', () => {
    const tasks = [
      makeTask({ id: 'c', nextRunAt: T0.getTime() + 300_000 }),
      makeTask({ id: 'a', nextRunAt: T0.getTime() + 60_000 }),
      makeTask({ id: 'e', nextRunAt: T0.getTime() + 500_000 }),
      makeTask({ id: 'b', nextRunAt: T0.getTime() + 120_000 }),
      makeTask({ id: 'd', nextRunAt: T0.getTime() + 420_000 }),
    ];
    const { harness, onFire, engine } = setup(tasks);
    engine.start();
    expect(harness.pending?.ms).toBe(60_000);
    const fired: string[] = [];
    for (const step of [60_000, 120_000, 300_000, 420_000, 500_000]) {
      harness.advanceTo(new Date(T0.getTime() + step));
      harness.fire();
      fired.push(...onFire.mock.calls.slice(fired.length).map((call) => call[0].id));
    }
    expect(fired).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(harness.pending).toBeNull();
  });

  it('does not fire a task twice for the same scheduled run', () => {
    const due = makeTask({ id: 'due', nextRunAt: T0.getTime() + 60_000 });
    const { harness, onFire, engine } = setup([due]);
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    harness.fire();
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(harness.pending).toBeNull();
  });

  it('never requeues a fired once task from its own state (P3)', () => {
    const once = makeTask({
      id: 'once',
      scheduleKind: 'once',
      scheduleExpr: '2026-01-05T08:01:00.000Z',
      nextRunAt: T0.getTime() + 60_000,
    });
    const { harness, listDue, onFire, engine } = setup([once]);
    engine.start();
    expect(listDue).toHaveBeenCalledTimes(1);
    harness.advanceTo(new Date(T0.getTime() + 120_000));
    harness.fire();
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(listDue).toHaveBeenCalledTimes(1);
    expect(harness.pending).toBeNull();
  });

  it('caps very long delays at the maximum timer delay', () => {
    const far = makeTask({ id: 'far', nextRunAt: T0.getTime() + 30 * 24 * 60 * 60 * 1000 });
    const { harness, engine } = setup([far]);
    engine.start();
    expect(harness.pending?.ms).toBe(2_147_483_647);
  });

  it('re-arms without firing when the timer wakes early', () => {
    const task = makeTask({ id: 't', nextRunAt: T0.getTime() + 600_000 });
    const { harness, onFire, engine } = setup([task]);
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    harness.fire();
    expect(onFire).not.toHaveBeenCalled();
    expect(harness.pending?.ms).toBe(540_000);
  });

  it('stop clears the pending timer and halts firing', () => {
    const due = makeTask({ id: 'due', nextRunAt: T0.getTime() + 60_000 });
    const { harness, onFire, engine } = setup([due]);
    engine.start();
    const stale = harness.pending!.fn;
    engine.stop();
    expect(harness.clearTimer).toHaveBeenCalledTimes(1);
    expect(harness.pending).toBeNull();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    stale();
    expect(onFire).not.toHaveBeenCalled();
  });

  it('restarts cleanly after stop', () => {
    const due = makeTask({ id: 'due', nextRunAt: T0.getTime() + 60_000 });
    const { harness, listDue, engine } = setup([due]);
    engine.start();
    engine.stop();
    engine.start();
    expect(listDue).toHaveBeenCalledTimes(2);
    expect(harness.pending?.ms).toBe(60_000);
  });

  it('reschedule replaces the timer with the nearest updated task', () => {
    const first = makeTask({ id: 'first', nextRunAt: T0.getTime() + 60_000 });
    const { harness, listDue, engine } = setup([first]);
    engine.start();
    expect(harness.pending?.ms).toBe(60_000);
    listDue.mockReturnValue([makeTask({ id: 'second', nextRunAt: T0.getTime() + 600_000 })]);
    engine.reschedule();
    expect(harness.clearTimer).toHaveBeenCalledTimes(1);
    expect(harness.pending?.ms).toBe(600_000);
  });

  it('reschedule while stopped does not arm a timer', () => {
    const { harness, engine } = setup([makeTask()]);
    engine.reschedule();
    expect(harness.setTimer).not.toHaveBeenCalled();
  });

  it('catches a rejected onFire and keeps the loop alive', async () => {
    const failing = makeTask({ id: 'failing', nextRunAt: T0.getTime() + 60_000 });
    const next = makeTask({ id: 'next', nextRunAt: T0.getTime() + 120_000 });
    const harness = createTimerHarness();
    const onFire = vi.fn(async (task: ScheduledTask) => {
      if (task.id === 'failing') throw new Error('boom');
    });
    const engine = new SchedulerEngine({
      listDue: () => [failing, next],
      onFire,
      now: harness.nowFn,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    harness.fire();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(harness.pending?.ms).toBe(60_000);
  });

  it('catches a synchronous onFire throw', () => {
    const due = makeTask({ id: 'due', nextRunAt: T0.getTime() + 60_000 });
    const harness = createTimerHarness();
    const engine = new SchedulerEngine({
      listDue: () => [due],
      onFire: () => {
        throw new Error('sync boom');
      },
      now: harness.nowFn,
      setTimer: harness.setTimer,
      clearTimer: harness.clearTimer,
    });
    engine.start();
    harness.advanceTo(new Date(T0.getTime() + 60_000));
    expect(() => harness.fire()).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });
});
