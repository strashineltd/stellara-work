import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScheduledRun, ScheduledTask } from '@shared/ipc';
import {
  _setDbPath, initDb, getDb,
  createScheduledTask, updateScheduledTask, deleteScheduledTask,
  listScheduledTasks, getScheduledTask, getOwnedScheduledTask, assertScheduledTaskOwned,
  recordRun, listRuns, pruneRuns,
} from './db';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-sched-'));
  _setDbPath(path.join(dir, 't.db'));
  initDb();
});
afterEach(async () => {
  _setDbPath(null);
  await fs.rm(dir, { recursive: true, force: true });
});

function makeTask(id: string, overrides: Partial<Parameters<typeof createScheduledTask>[0]> = {}): ScheduledTask {
  return createScheduledTask({
    id,
    name: `任务 ${id}`,
    prompt: '说 hello',
    scheduleKind: 'interval',
    scheduleExpr: '30',
    ...overrides,
  });
}

function makeRun(id: string, taskId: string, overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return { id, taskId, startedAt: 1_000, status: 'running', ...overrides };
}

describe('scheduled task repository', () => {
  it('creates the scheduler tables and indexes', () => {
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('scheduled_tasks', 'scheduled_runs')")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(['scheduled_runs', 'scheduled_tasks']);

    const indexes = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_scheduled_tasks_due', 'idx_scheduled_tasks_user')")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name).sort()).toEqual(['idx_scheduled_tasks_due', 'idx_scheduled_tasks_user']);
  });

  it('creates tasks with spec defaults and reads them back', () => {
    const task = makeTask('t1');
    expect(task).toMatchObject({
      id: 't1',
      name: '任务 t1',
      prompt: '说 hello',
      runtime: 'local',
      scheduleKind: 'interval',
      scheduleExpr: '30',
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      allowDangerous: false,
      userId: 'default',
    });
    expect(task.projectId).toBeUndefined();
    expect(getScheduledTask('t1')).toEqual(task);
    expect(getScheduledTask('nope')).toBeNull();
  });

  it('round-trips runtime, server, model and nullable schedule fields', () => {
    const nextRunAt = 1_800_000_000_000;
    makeTask('t1', {
      projectId: 'p1', workDir: '/tmp/w', runtime: 'server', serverId: 'srv', modelId: 'm1',
      nextRunAt, allowDangerous: true,
    });
    expect(getScheduledTask('t1')).toMatchObject({
      projectId: 'p1', workDir: '/tmp/w', runtime: 'server', serverId: 'srv', modelId: 'm1',
      nextRunAt, allowDangerous: true,
    });
  });

  it('filters tasks by user_id (H10)', () => {
    makeTask('u1-task', { userId: 'u1' });
    makeTask('u2-task', { userId: 'u2' });
    makeTask('default-task');
    expect(listScheduledTasks('u1').map((t) => t.id)).toEqual(['u1-task']);
    expect(listScheduledTasks('u2').map((t) => t.id)).toEqual(['u2-task']);
    expect(listScheduledTasks().map((t) => t.id)).toEqual(['default-task']);
    expect(listScheduledTasks('nobody')).toEqual([]);
  });

  it('guards task ownership like sessions do', () => {
    makeTask('t1', { userId: 'u1' });
    expect(getOwnedScheduledTask('t1', 'u1')?.id).toBe('t1');
    expect(getOwnedScheduledTask('t1', 'u2')).toBeUndefined();
    expect(() => assertScheduledTaskOwned('t1', 'u2')).toThrow(/无权限访问该数据/);
    expect(() => assertScheduledTaskOwned('t1', 'u1')).not.toThrow();
    expect(() => assertScheduledTaskOwned('missing', 'u1')).toThrow(/无权限访问该数据/);
  });

  it('updates task fields, clearing nullable columns and keeping ownership', () => {
    makeTask('t1', { nextRunAt: 111, userId: 'u1' });
    const updated = updateScheduledTask('t1', {
      name: '新名字',
      prompt: '新提示词',
      runtime: 'server',
      serverId: 'srv',
      workDir: null,
      scheduleKind: 'once',
      scheduleExpr: '2026-10-01T00:00:00.000Z',
      enabled: false,
      nextRunAt: null,
      lastRunAt: 222,
      lastStatus: 'success',
      allowDangerous: true,
    });
    expect(updated).toMatchObject({
      name: '新名字',
      prompt: '新提示词',
      runtime: 'server',
      serverId: 'srv',
      scheduleKind: 'once',
      scheduleExpr: '2026-10-01T00:00:00.000Z',
      enabled: false,
      nextRunAt: null,
      lastRunAt: 222,
      lastStatus: 'success',
      allowDangerous: true,
      userId: 'u1',
    });
    expect(updated.workDir).toBeUndefined();
    expect(getScheduledTask('t1')).toEqual(updated);
    expect(() => updateScheduledTask('missing', { name: 'x' })).toThrow(/任务不存在或已被删除/);
  });
});

describe('scheduled run repository', () => {
  it('records a running run and transitions it to each terminal status', () => {
    makeTask('t1');
    recordRun('t1', makeRun('r-success', 't1', { startedAt: 10, sessionId: 'sess-1' }));
    recordRun('t1', makeRun('r-success', 't1', { startedAt: 10, status: 'success', finishedAt: 20 }));
    recordRun('t1', makeRun('r-error', 't1', { startedAt: 30 }));
    recordRun('t1', makeRun('r-error', 't1', { startedAt: 30, status: 'error', finishedAt: 40, error: '模型未配置' }));
    recordRun('t1', makeRun('r-missed', 't1', { startedAt: 50, status: 'missed' }));
    recordRun('t1', makeRun('r-aborted', 't1', { startedAt: 60 }));
    recordRun('t1', makeRun('r-aborted', 't1', { startedAt: 60, status: 'aborted', finishedAt: 70 }));

    const runs = listRuns('t1');
    expect(runs.map((r) => [r.id, r.status])).toEqual([
      ['r-aborted', 'aborted'],
      ['r-missed', 'missed'],
      ['r-error', 'error'],
      ['r-success', 'success'],
    ]);
    expect(runs.find((r) => r.id === 'r-success')).toMatchObject({ startedAt: 10, finishedAt: 20, sessionId: 'sess-1' });
    expect(runs.find((r) => r.id === 'r-error')?.error).toBe('模型未配置');
    expect(runs.find((r) => r.id === 'r-missed')?.finishedAt).toBeNull();
  });

  it('upserts by run id without clobbering fields the update omits', () => {
    makeTask('t1');
    recordRun('t1', makeRun('r1', 't1', { startedAt: 10, sessionId: 'sess-1' }));
    recordRun('t1', makeRun('r1', 't1', { startedAt: 10, status: 'success', finishedAt: 20 }));
    expect(listRuns('t1')).toEqual([
      expect.objectContaining({ id: 'r1', startedAt: 10, status: 'success', finishedAt: 20, sessionId: 'sess-1' }),
    ]);
  });

  it('derives run ownership from the task, honoring an explicit userId', () => {
    makeTask('t1', { userId: 'u1' });
    recordRun('t1', makeRun('r-derived', 't1', { startedAt: 10 }));
    recordRun('t1', makeRun('r-explicit', 't1', { startedAt: 20, userId: 'u9' }));
    const rows = getDb()
      .prepare('SELECT id, user_id FROM scheduled_runs ORDER BY started_at ASC')
      .all() as Array<{ id: string; user_id: string }>;
    expect(rows).toEqual([
      { id: 'r-derived', user_id: 'u1' },
      { id: 'r-explicit', user_id: 'u9' },
    ]);
  });

  it('rejects runs for a missing task', () => {
    expect(() => recordRun('missing', makeRun('r0', 'missing'))).toThrow(/任务不存在或已被删除/);
  });

  it('lists runs newest first and honors the limit', () => {
    makeTask('t1');
    for (let i = 1; i <= 25; i++) {
      recordRun('t1', makeRun(`r${i}`, 't1', { startedAt: i, status: 'success' }));
    }
    expect(listRuns('t1')).toHaveLength(20);
    expect(listRuns('t1')[0].id).toBe('r25');
    expect(listRuns('t1', 3).map((r) => r.id)).toEqual(['r25', 'r24', 'r23']);
  });

  it('prunes runs beyond keep, keeping the newest and leaving other tasks alone', () => {
    makeTask('t1');
    makeTask('t2');
    for (let i = 1; i <= 205; i++) {
      recordRun('t1', makeRun(`r${i}`, 't1', { startedAt: i, status: 'success' }));
    }
    recordRun('t2', makeRun('other', 't2', { startedAt: 1 }));

    expect(pruneRuns('t1')).toBe(5);
    const kept = listRuns('t1', 500);
    expect(kept).toHaveLength(200);
    expect(kept[kept.length - 1].startedAt).toBe(6);
    expect(pruneRuns('t1')).toBe(0);
    expect(listRuns('t2', 10).map((r) => r.id)).toEqual(['other']);
  });

  it('cascades run deletion when the task is removed', () => {
    makeTask('t1');
    makeTask('t2');
    recordRun('t1', makeRun('r1', 't1', { status: 'success' }));
    recordRun('t2', makeRun('r2', 't2', { status: 'success' }));

    deleteScheduledTask('t1');
    expect(getScheduledTask('t1')).toBeNull();
    expect(listRuns('t1')).toEqual([]);
    expect(listRuns('t2').map((r) => r.id)).toEqual(['r2']);
    expect(() => deleteScheduledTask('t1')).toThrow(/任务不存在或已被删除/);
  });

  it('keeps runs reachable only through owned tasks (H10)', () => {
    makeTask('u1-task', { userId: 'u1' });
    makeTask('u2-task', { userId: 'u2' });
    recordRun('u1-task', makeRun('r1', 'u1-task', { status: 'success' }));
    recordRun('u2-task', makeRun('r2', 'u2-task', { status: 'success' }));

    expect(listScheduledTasks('u1').map((t) => t.id)).toEqual(['u1-task']);
    expect(listRuns(assertScheduledTaskOwned('u1-task', 'u1').id).map((r) => r.id)).toEqual(['r1']);
    expect(() => assertScheduledTaskOwned('u2-task', 'u1')).toThrow(/无权限访问该数据/);
  });

  it('policy JSON 往返', () => {
    const policy = { allowedTools: ['edit_file' as const, 'run_command' as const], fileScopes: ['src/**'], allowedCommands: ['npm test'] };
    makeTask('t-policy', { policy });
    expect(getScheduledTask('t-policy')!.policy).toEqual(policy);
  });

  it('update 缺省不动 policy；显式 null 清空', () => {
    makeTask('t-p2', { policy: { allowedTools: ['edit_file'], fileScopes: ['a/**'], allowedCommands: [] } });
    updateScheduledTask('t-p2', { name: '改名' });
    expect(getScheduledTask('t-p2')!.policy).toBeTruthy();
    updateScheduledTask('t-p2', { policy: null });
    expect(getScheduledTask('t-p2')!.policy).toBeUndefined();
  });
});
