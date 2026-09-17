import { Cron } from 'croner';
import type { ScheduledTask, ScheduledTaskKind } from '@shared/ipc';

/**
 * Node setTimeout clamps delays above 2^31-1 ms to 1 ms; capping keeps a single
 * timer armed without spinning the event loop for schedules weeks away.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * 计算任务下一次运行时间。纯函数，不抛异常：非法表达式返回 null。
 * - once：ISO 字符串，必须严格晚于 from
 * - interval：正数分钟数
 * - cron：croner 表达式
 */
export function computeNextRun(
  kind: ScheduledTaskKind,
  expr: string,
  from: Date,
): Date | null {
  if (kind === 'once') {
    const at = Date.parse(expr);
    if (Number.isNaN(at)) return null;
    const date = new Date(at);
    return date.getTime() > from.getTime() ? date : null;
  }
  if (kind === 'interval') {
    const minutes = Number(expr);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const next = new Date(from.getTime() + minutes * 60_000);
    return Number.isFinite(next.getTime()) ? next : null;
  }
  try {
    return new Cron(expr).nextRun(from);
  } catch {
    return null;
  }
}

/**
 * 启动时扫描错过的任务：启用、已排期且原定时间早于 now。
 * 同一任务只返回一次（多个错过周期不连续追补）。
 */
export function computeMissed(tasks: readonly ScheduledTask[], now: Date): ScheduledTask[] {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const missed: ScheduledTask[] = [];
  for (const task of tasks) {
    if (!task.enabled || task.nextRunAt === null || task.nextRunAt >= nowMs) continue;
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    missed.push(task);
  }
  return missed;
}

export interface SchedulerEngineDeps {
  /** 返回启用且有 nextRunAt 的任务（执行方注入，引擎不持久化） */
  listDue(now: Date): ScheduledTask[];
  /** 到点执行；异常由引擎捕获记日志，不中断调度 */
  onFire(task: ScheduledTask): Promise<void>;
  now?(): Date;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * 单计时器 + 最小堆调度引擎。触发后不重排任务（P3）：
 * 执行方在落库后调用 reschedule() 注入新的 nextRunAt。
 */
export class SchedulerEngine {
  private readonly listDue: (now: Date) => ScheduledTask[];
  private readonly onFire: (task: ScheduledTask) => Promise<void>;
  private readonly nowFn: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private heap: ScheduledTask[] = [];
  private timer: { handle: unknown } | null = null;
  private running = false;

  constructor(deps: SchedulerEngineDeps) {
    this.listDue = deps.listDue;
    this.onFire = deps.onFire;
    this.nowFn = deps.now ?? (() => new Date());
    this.setTimer = deps.setTimer;
    this.clearTimer = deps.clearTimer;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.reschedule();
  }

  stop(): void {
    this.running = false;
    this.heap = [];
    this.disarm();
  }

  reschedule(): void {
    this.heap = [];
    for (const task of this.listDue(this.nowFn())) {
      if (task.enabled && task.nextRunAt !== null) this.push(task);
    }
    this.arm();
  }

  private push(task: ScheduledTask): void {
    if (this.heap.some((scheduled) => scheduled.id === task.id)) return;
    this.heap.push(task);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.at(parent) <= this.at(index)) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private pop(): ScheduledTask {
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.heap.length && this.at(left) < this.at(smallest)) smallest = left;
        if (right < this.heap.length && this.at(right) < this.at(smallest)) smallest = right;
        if (smallest === index) break;
        [this.heap[smallest], this.heap[index]] = [this.heap[index], this.heap[smallest]];
        index = smallest;
      }
    }
    return top;
  }

  private at(index: number): number {
    return this.heap[index].nextRunAt ?? Number.POSITIVE_INFINITY;
  }

  private arm(): void {
    this.disarm();
    if (!this.running || this.heap.length === 0) return;
    const delay = this.at(0) - this.nowFn().getTime();
    this.timer = { handle: this.setTimer(() => this.tick(), Math.max(0, Math.min(delay, MAX_TIMER_DELAY_MS))) };
  }

  private disarm(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer.handle);
    this.timer = null;
  }

  private tick(): void {
    this.timer = null;
    if (!this.running) return;
    const nowMs = this.nowFn().getTime();
    const due: ScheduledTask[] = [];
    while (this.heap.length > 0 && this.at(0) <= nowMs) {
      due.push(this.pop());
    }
    for (const task of due) this.fire(task);
    this.arm();
  }

  private fire(task: ScheduledTask): void {
    try {
      void Promise.resolve(this.onFire(task)).catch((err) => {
        console.error('[scheduler] 任务触发失败', task.id, err);
      });
    } catch (err) {
      console.error('[scheduler] 任务触发失败', task.id, err);
    }
  }
}
