// shared/ipc.scheduled.test.ts
//
// v0.9.3 调度器 IPC 契约回归：
// - P6：scheduled 命名空间恰好暴露 list/create/update/remove/toggle/runNow/abort/runs/onChanged
// - H10：create/update 入参不含 userId（身份由主进程 getActiveUserId() 注入）
// - 方法签名与 ScheduledTask / ScheduledRun 返回类型一致
import { describe, expect, it } from 'vitest';
import type {
  ElectronAPI,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskPatch,
} from './ipc';

/** 字段存在性断言：含该字段时赋值 true 会在 typecheck 失败 */
type HasKey<T, K extends string> = K extends keyof T ? true : false;

/** 类型相等断言：任一侧不匹配时赋值 true 会在 typecheck 失败 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

type ScheduledNamespace = ElectronAPI['scheduled'];
type ExpectedScheduledKeys =
  | 'list'
  | 'create'
  | 'update'
  | 'remove'
  | 'toggle'
  | 'runNow'
  | 'abort'
  | 'runs'
  | 'onChanged';

describe('scheduled ipc contract (P6)', () => {
  it('scheduled 命名空间恰好暴露 list/create/update/remove/toggle/runNow/abort/runs/onChanged', () => {
    type Actual = keyof ScheduledNamespace;
    const exact: Equal<Actual, ExpectedScheduledKeys> = true;
    expect(exact).toBe(true);
  });

  it('scheduled 方法签名与任务/执行记录返回类型一致', () => {
    const list: Equal<ReturnType<ScheduledNamespace['list']>, Promise<ScheduledTask[]>> = true;
    const create: Equal<Parameters<ScheduledNamespace['create']>[0], ScheduledTaskInput> = true;
    const update: Equal<Parameters<ScheduledNamespace['update']>[1], ScheduledTaskPatch> = true;
    const runs: Equal<ReturnType<ScheduledNamespace['runs']>, Promise<ScheduledRun[]>> = true;
    const toggle: Equal<ReturnType<ScheduledNamespace['toggle']>, Promise<void>> = true;
    const runNow: Equal<ReturnType<ScheduledNamespace['runNow']>, Promise<void>> = true;
    const abort: Equal<ReturnType<ScheduledNamespace['abort']>, Promise<void>> = true;
    const remove: Equal<ReturnType<ScheduledNamespace['remove']>, Promise<void>> = true;
    const onChanged: Equal<ReturnType<ScheduledNamespace['onChanged']>, () => void> = true;
    expect([list, create, update, runs, toggle, runNow, abort, remove, onChanged]).toEqual([
      true, true, true, true, true, true, true, true, true,
    ]);
  });
});

describe('scheduled ipc contract (H10)', () => {
  it('create 入参不接受渲染层 userId / id / nextRunAt（由主进程注入）', () => {
    const userId: HasKey<ScheduledTaskInput, 'userId'> = false;
    const id: HasKey<ScheduledTaskInput, 'id'> = false;
    const nextRunAt: HasKey<ScheduledTaskInput, 'nextRunAt'> = false;
    expect([userId, id, nextRunAt]).toEqual([false, false, false]);
  });

  it('update 补丁不接受渲染层 userId', () => {
    const userId: HasKey<ScheduledTaskPatch, 'userId'> = false;
    expect(userId).toBe(false);
  });

  it('running 是可选的主进程注入视图字段（输入负载不接受）', () => {
    const tag: Equal<Pick<ScheduledTask, 'running'>, { running?: boolean }> = true;
    const createInput: HasKey<ScheduledTaskInput, 'running'> = false;
    const updatePatch: HasKey<ScheduledTaskPatch, 'running'> = false;
    expect([tag, createInput, updatePatch]).toEqual([true, false, false]);
  });

  it('create 负载可表达一次性 / 间隔 / cron 三种调度', () => {
    const once: ScheduledTaskInput = {
      name: '一次性', prompt: 'p', runtime: 'local',
      scheduleKind: 'once', scheduleExpr: '2026-12-31T00:00:00.000Z',
    };
    const interval: ScheduledTaskInput = {
      name: '间隔', prompt: 'p', runtime: 'server', serverId: 'srv-1',
      scheduleKind: 'interval', scheduleExpr: '30', enabled: false, allowDangerous: true,
    };
    const cron: ScheduledTaskInput = {
      name: 'cron', prompt: 'p', runtime: 'local', projectId: 'proj-1',
      workDir: '/tmp/work', modelId: 'm1', scheduleKind: 'cron', scheduleExpr: '0 9 * * 1',
    };
    expect([once.scheduleKind, interval.scheduleKind, cron.scheduleKind]).toEqual([
      'once', 'interval', 'cron',
    ]);
    expect(Object.keys(interval)).not.toContain('userId');
  });

  it('update 补丁为局部更新（全部可选）', () => {
    const patch: ScheduledTaskPatch = { enabled: false };
    const empty: ScheduledTaskPatch = {};
    expect([Object.keys(patch), Object.keys(empty)]).toEqual([['enabled'], []]);
  });
});
