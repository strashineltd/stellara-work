import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent, CreateSessionArgs, ModelConfig, ScheduledRun, ScheduledTask } from '@shared/ipc';
import {
  _resetActiveRunsForTests,
  abortRun,
  executeTask,
  isRunning,
  runLocalTask,
  runServerTask,
  type LocalLoopRequest,
  type RunnerDb,
  type RunnerMessage,
  type RunnerSessionInput,
  type SchedulerRunnerDeps,
  type SchedulerTaskPatch,
  type TaskEndNotificationState,
} from './runner';
import { SchedulerEngine } from './engine';

const T0 = new Date('2026-01-05T08:00:00.000Z');

const MODEL: ModelConfig = {
  id: 'custom',
  label: 'Custom',
  baseUrl: 'https://example.test/v1',
  model: 'gpt-test',
  apiKey: 'sk-test',
  workDir: '/tmp/model-workdir',
  isCustom: true,
  wireApi: 'responses',
};

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
    userId: 'u1',
    ...overrides,
  };
}

function successLoop(text: string) {
  return async function* (): AsyncGenerator<ChatStreamEvent> {
    const half = Math.ceil(text.length / 2);
    yield { type: 'content', content: text.slice(0, half) };
    yield { type: 'content', content: text.slice(half) };
    yield { type: 'task_complete' };
    yield { type: 'done' };
  };
}

function errorLoop(message: string) {
  return async function* (): AsyncGenerator<ChatStreamEvent> {
    yield { type: 'error', error: message };
  };
}

/** 模拟真实循环：中断后发出 error 事件，但运行结果应是 aborted。 */
function pendingUntilAbortedLoop(request: LocalLoopRequest) {
  return (async function* (): AsyncGenerator<ChatStreamEvent> {
    if (!request.signal.aborted) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    }
    yield { type: 'error', error: '用户中断' };
  })();
}

interface Harness {
  deps: SchedulerRunnerDeps;
  runs: Map<string, ScheduledRun>;
  runCalls: ScheduledRun[];
  taskPatches: Array<{ id: string; patch: SchedulerTaskPatch }>;
  pruneCalls: Array<[string, number | undefined]>;
  messages: RunnerMessage[];
  localSessions: Array<{ input: RunnerSessionInput }>;
  serverSessions: Array<{ args: CreateSessionArgs; userId?: string }>;
  notifications: TaskEndNotificationState[];
  loopRequests: LocalLoopRequest[];
  chatStarts: Array<{ sessionId: string; text: string; model?: { providerID: string; modelID: string }; agent?: string }>;
  chatAborts: string[];
  emit(streamId: string, event: ChatStreamEvent): void;
  /** 模拟运行期间任务行被编辑 / 删除（完成补丁必须重读该行） */
  setTaskRow(task: ScheduledTask | null): void;
}

function createHarness(options: {
  loop?: (request: LocalLoopRequest) => AsyncIterable<ChatStreamEvent>;
  resolveModel?: (task: ScheduledTask) => Promise<ModelConfig | null>;
  isDirectory?: (path: string) => Promise<boolean>;
  createServerSession?: (args: CreateSessionArgs, userId?: string) => Promise<{ id: string }>;
  serverTimeoutMs?: number;
  /** 任务表当前行（默认 makeTask()；null 表示任务已被删除） */
  taskRow?: ScheduledTask | null;
} = {}): Harness {
  const runs = new Map<string, ScheduledRun>();
  const runCalls: ScheduledRun[] = [];
  const taskPatches: Array<{ id: string; patch: SchedulerTaskPatch }> = [];
  const pruneCalls: Array<[string, number | undefined]> = [];
  const messages: RunnerMessage[] = [];
  const localSessions: Harness['localSessions'] = [];
  const serverSessions: Harness['serverSessions'] = [];
  const notifications: TaskEndNotificationState[] = [];
  const loopRequests: LocalLoopRequest[] = [];
  const chatStarts: Harness['chatStarts'] = [];
  const chatAborts: string[] = [];
  const watchers = new Map<string, Set<(event: ChatStreamEvent) => void>>();
  let seq = 0;
  let taskRow: ScheduledTask | null = options.taskRow === undefined ? makeTask() : options.taskRow;

  const db: RunnerDb = {
    getScheduledTask: () => taskRow,
    createSession: (input) => {
      localSessions.push({ input });
      return { id: input.id };
    },
    recordRun: (taskId, run) => {
      runCalls.push({ ...run });
      runs.set(run.id, { ...runs.get(run.id), ...run, taskId });
    },
    pruneRuns: (taskId, keep) => {
      pruneCalls.push([taskId, keep]);
      return 0;
    },
    updateScheduledTask: (id, patch) => {
      taskPatches.push({ id, patch });
    },
    appendMessage: (message) => {
      messages.push(message);
    },
  };

  const deps: SchedulerRunnerDeps = {
    db,
    sessions: {
      create: async (args, userId) => {
        serverSessions.push({ args, userId });
        const create = options.createServerSession ?? (async () => ({ id: 'sess-server-1' }));
        return create(args, userId);
      },
    },
    chat: {
      start: async (sessionId, text, model, agent) => {
        chatStarts.push({ sessionId, text, ...(model ? { model } : {}), ...(agent ? { agent } : {}) });
        return { streamId: 'stream-1' };
      },
      abort: async (streamId) => {
        chatAborts.push(streamId);
      },
      watch: (streamId, listener) => {
        const listeners = watchers.get(streamId) ?? new Set<(event: ChatStreamEvent) => void>();
        listeners.add(listener);
        watchers.set(streamId, listeners);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    runLocalLoop: (request) => {
      loopRequests.push(request);
      return (options.loop ?? successLoop('hello world'))(request);
    },
    resolveModel: options.resolveModel ?? (async () => MODEL),
    isDirectory: options.isDirectory ?? (async () => true),
    notify: (state) => {
      notifications.push(state);
    },
    uuid: () => `id-${++seq}`,
    now: () => new Date(T0),
    ...(options.serverTimeoutMs !== undefined ? { serverTimeoutMs: options.serverTimeoutMs } : {}),
  };

  return {
    deps,
    runs,
    runCalls,
    taskPatches,
    pruneCalls,
    messages,
    localSessions,
    serverSessions,
    notifications,
    loopRequests,
    chatStarts,
    chatAborts,
    emit: (streamId, event) => {
      for (const listener of [...(watchers.get(streamId) ?? [])]) listener(event);
    },
    setTaskRow: (task) => {
      taskRow = task;
    },
  };
}

afterEach(() => {
  _resetActiveRunsForTests();
});

describe('runLocalTask', () => {
  it('creates a session for the task owner and records a successful run end to end', async () => {
    const h = createHarness();
    const task = makeTask({ workDir: '/tmp/task-workdir', projectId: 'p1' });

    const run = await runLocalTask(task, h.deps);

    expect(h.localSessions).toHaveLength(1);
    const session = h.localSessions[0]!.input;
    expect(session).toMatchObject({
      title: '任务 t1',
      modelId: 'custom',
      workDir: '/tmp/task-workdir',
      projectId: 'p1',
      runtime: 'local',
      userId: 'u1',
    });

    expect(h.loopRequests).toHaveLength(1);
    const request = h.loopRequests[0]!;
    expect(request.prompt).toBe('说 hello');
    expect(request.sessionId).toBe(session.id);
    expect(request.cwd).toBe('/tmp/task-workdir');
    expect(request.model.workDir).toBe('/tmp/task-workdir');
    expect(request.memoryProjectId).toBe('p1');
    expect(request.memoryUserId).toBe('u1');
    expect(request.signal.aborted).toBe(false);
    expect((request as { onApproval?: unknown }).onApproval).toBeUndefined();

    expect(h.messages).toEqual([
      { sessionId: session.id, position: 0, role: 'user', content: '说 hello', createdAt: T0.getTime() },
      { sessionId: session.id, position: 1, role: 'assistant', content: 'hello world', createdAt: T0.getTime() },
    ]);

    expect(h.runCalls[0]).toMatchObject({ id: 'id-1', taskId: 't1', status: 'running', startedAt: T0.getTime() });
    expect(h.runCalls[0]!.sessionId).toBeUndefined();
    expect(h.runCalls[1]).toMatchObject({ status: 'running', sessionId: session.id });
    expect(run).toMatchObject({
      id: 'id-1',
      taskId: 't1',
      status: 'success',
      startedAt: T0.getTime(),
      finishedAt: T0.getTime(),
      sessionId: session.id,
    });
    expect(h.pruneCalls).toEqual([['t1', 200]]);
    expect(h.taskPatches).toEqual([
      { id: 't1', patch: { lastRunAt: T0.getTime(), lastStatus: 'success', nextRunAt: T0.getTime() + 10 * 60_000 } },
    ]);
    expect(h.notifications).toEqual([{ completed: true, failed: false, aborted: false }]);
  });

  it('falls back to the model work directory when the task has none', async () => {
    const h = createHarness();
    await runLocalTask(makeTask(), h.deps);
    expect(h.localSessions[0]!.input.workDir).toBe('/tmp/model-workdir');
    expect(h.loopRequests[0]!.cwd).toBe('/tmp/model-workdir');
  });

  it('runner 不注入审批回调（审批由 main.ts 按策略构造）', async () => {
    const h = createHarness({
      loop: errorLoop('危险工具 write_file 已被拒绝（无审批通道）'),
    });
    const run = await runLocalTask(makeTask(), h.deps);

    expect(h.loopRequests).toHaveLength(1);
    expect((h.loopRequests[0] as { onApproval?: unknown }).onApproval).toBeUndefined();
    expect(h.loopRequests[0]!.policy).toBeUndefined();
    expect(run.status).toBe('error');
    expect(run.error).toBe('危险工具 write_file 已被拒绝（无审批通道）');
    expect(h.notifications).toEqual([{ completed: false, failed: true, aborted: false }]);
  });

  it('把任务的 policy 透传给本地循环', async () => {
    const policy = { allowedTools: ['edit_file'] as const, fileScopes: ['src/**'], allowedCommands: [] };
    const h = createHarness();
    await runLocalTask(makeTask({ policy: { ...policy, allowedTools: [...policy.allowedTools] } }), h.deps);
    expect(h.loopRequests[0]!.policy).toEqual({ ...policy, allowedTools: [...policy.allowedTools] });
  });

  it('records an error with the reason when the model cannot be resolved', async () => {
    const h = createHarness({ resolveModel: async () => null });
    const run = await runLocalTask(makeTask(), h.deps);

    expect(run.status).toBe('error');
    expect(run.error).toContain('模型');
    expect(h.localSessions).toHaveLength(0);
    expect(h.loopRequests).toHaveLength(0);
    expect(h.taskPatches[0]!.patch.lastStatus).toBe('error');
    expect(h.taskPatches[0]!.patch.nextRunAt).toBe(T0.getTime() + 10 * 60_000);
    expect(h.notifications).toEqual([{ completed: false, failed: true, aborted: false }]);
  });

  it('records an error when the work directory does not exist', async () => {
    const h = createHarness({ isDirectory: async () => false });
    const run = await runLocalTask(makeTask({ workDir: '/missing/dir' }), h.deps);

    expect(run.status).toBe('error');
    expect(run.error).toContain('/missing/dir');
    expect(h.localSessions).toHaveLength(0);
  });

  it('disables a once task after it runs', async () => {
    const task = makeTask({
      scheduleKind: 'once',
      scheduleExpr: '2026-01-05T09:00:00.000Z',
      nextRunAt: T0.getTime() + 3_600_000,
    });
    const h = createHarness({ taskRow: task });

    await runLocalTask(task, h.deps);

    expect(h.taskPatches).toEqual([
      { id: 't1', patch: { lastRunAt: T0.getTime(), lastStatus: 'success', enabled: false, nextRunAt: null } },
    ]);
  });

  it('does not overwrite a schedule edit made during the run when completing', async () => {
    const h = createHarness({ loop: pendingUntilAbortedLoop });
    const promise = runLocalTask(makeTask(), h.deps);
    await vi.waitFor(() => expect(isRunning('t1')).toBe(true));

    h.setTaskRow(makeTask({ scheduleExpr: '20' }));
    abortRun('t1');
    await promise;

    expect(h.taskPatches).toEqual([
      { id: 't1', patch: { lastRunAt: T0.getTime(), lastStatus: 'aborted', nextRunAt: T0.getTime() + 20 * 60_000 } },
    ]);
  });

  it('skips the lifecycle update when the task was deleted mid-run', async () => {
    const h = createHarness({ loop: pendingUntilAbortedLoop });
    const promise = runLocalTask(makeTask(), h.deps);
    await vi.waitFor(() => expect(isRunning('t1')).toBe(true));

    h.setTaskRow(null);
    abortRun('t1');
    const run = await promise;

    expect(run.status).toBe('aborted');
    expect(h.taskPatches).toEqual([]);
    expect(h.notifications).toEqual([{ completed: false, failed: false, aborted: true }]);
  });

  it('abortRun cancels an in-flight local run', async () => {
    const h = createHarness({ loop: pendingUntilAbortedLoop });
    const promise = runLocalTask(makeTask(), h.deps);
    await vi.waitFor(() => expect(h.loopRequests).toHaveLength(1));

    expect(abortRun('t1')).toBe(true);
    const run = await promise;

    expect(run.status).toBe('aborted');
    expect(h.notifications).toEqual([{ completed: false, failed: false, aborted: true }]);
    expect(abortRun('t1')).toBe(false);
  });
});

describe('runServerTask', () => {
  it('records an error when the server is not connected and still advances the schedule', async () => {
    const h = createHarness({
      createServerSession: async () => {
        throw new Error('服务器未连接');
      },
    });
    const task = makeTask({ runtime: 'server', serverId: 'srv-1', modelId: 'openai/gpt-5' });

    const run = await runServerTask(task, h.deps);

    expect(run.status).toBe('error');
    expect(run.error).toBe('服务器未连接');
    expect(h.chatStarts).toHaveLength(0);
    expect(h.taskPatches[0]!.patch.nextRunAt).toBe(T0.getTime() + 10 * 60_000);
    expect(h.notifications).toEqual([{ completed: false, failed: true, aborted: false }]);
  });

  it('creates the server session, starts with the mapped model and waits for done', async () => {
    const h = createHarness();
    const task = makeTask({ runtime: 'server', serverId: 'srv-1', modelId: 'openai/gpt-5' });

    const promise = runServerTask(task, h.deps);
    await vi.waitFor(() => expect(h.chatStarts).toHaveLength(1));

    expect(h.serverSessions[0]!.args).toMatchObject({
      title: '任务 t1',
      runtime: 'server',
      serverId: 'srv-1',
      serverModel: { providerID: 'openai', modelID: 'gpt-5' },
    });
    expect(h.serverSessions[0]!.userId).toBe('u1');
    expect(h.chatStarts[0]).toMatchObject({
      sessionId: 'sess-server-1',
      text: '说 hello',
      model: { providerID: 'openai', modelID: 'gpt-5' },
    });

    h.emit('stream-1', { type: 'content', content: '远端输出' });
    h.emit('stream-1', { type: 'done' });
    const run = await promise;

    expect(run).toMatchObject({ status: 'success', sessionId: 'sess-server-1' });
    expect(h.runCalls[1]).toMatchObject({ status: 'running', sessionId: 'sess-server-1' });
    expect(h.pruneCalls).toEqual([['t1', 200]]);
    expect(h.notifications).toEqual([{ completed: true, failed: false, aborted: false }]);
  });

  it('records an error event from the server stream', async () => {
    const h = createHarness();
    const task = makeTask({ runtime: 'server', serverId: 'srv-1' });

    const promise = runServerTask(task, h.deps);
    await vi.waitFor(() => expect(h.chatStarts).toHaveLength(1));
    h.emit('stream-1', { type: 'error', error: '远端会话失败' });

    const run = await promise;
    expect(run.status).toBe('error');
    expect(run.error).toBe('远端会话失败');
  });

  it('abortRun cancels an in-flight server run through chat.abort', async () => {
    const h = createHarness();
    const task = makeTask({ runtime: 'server', serverId: 'srv-1' });

    const promise = runServerTask(task, h.deps);
    await vi.waitFor(() => expect(h.chatStarts).toHaveLength(1));

    expect(abortRun('t1')).toBe(true);
    const run = await promise;

    expect(run.status).toBe('aborted');
    expect(h.chatAborts).toEqual(['stream-1']);
    expect(h.notifications).toEqual([{ completed: false, failed: false, aborted: true }]);
  });

  it('times out the server run as an error and aborts the remote prompt', async () => {
    vi.useFakeTimers();
    try {
      const h = createHarness({ serverTimeoutMs: 60_000 });
      const task = makeTask({ runtime: 'server', serverId: 'srv-1' });

      const promise = runServerTask(task, h.deps);
      await vi.advanceTimersByTimeAsync(60_000);
      const run = await promise;

      expect(run.status).toBe('error');
      expect(run.error).toContain('超时');
      expect(h.chatAborts).toEqual(['stream-1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('in-flight protection (duplicate re-fire)', () => {
  it('isRunning reflects in-flight tasks and clears after completion', async () => {
    const h = createHarness({ loop: pendingUntilAbortedLoop });
    const promise = runLocalTask(makeTask(), h.deps);
    await vi.waitFor(() => expect(isRunning('t1')).toBe(true));
    expect(isRunning('t2')).toBe(false);

    abortRun('t1');
    await promise;

    expect(isRunning('t1')).toBe(false);
  });

  it('does not re-fire a still-running task when the heap is rebuilt', async () => {
    const h = createHarness({ loop: pendingUntilAbortedLoop });
    const task = makeTask({ nextRunAt: T0.getTime() - 60_000 });
    const timers: Array<() => void> = [];
    const setTimer = vi.fn((fn: () => void) => {
      timers.push(fn);
      return timers.length;
    });
    const clearTimer = vi.fn();
    const fired: string[] = [];
    let running: Promise<unknown> | undefined;

    const engine = new SchedulerEngine({
      // 与 main.ts 接线一致：重排前过滤运行中的任务
      listDue: () => [task].filter((candidate) => !isRunning(candidate.id)),
      onFire: async (firedTask) => {
        fired.push(firedTask.id);
        try {
          running = runLocalTask(firedTask, h.deps);
          await running;
        } finally {
          engine.reschedule();
        }
      },
      now: () => new Date(T0),
      setTimer,
      clearTimer,
    });

    engine.start();
    expect(setTimer).toHaveBeenCalledTimes(1);

    // 到点触发一次（定时器只有一个，且指向过期任务）
    timers[0]!();
    await vi.waitFor(() => expect(isRunning('t1')).toBe(true));
    expect(fired).toEqual(['t1']);

    // 运行期间重建堆（等价于其它任务完成 / runNow / toggle / reload）：不得重排该任务
    engine.reschedule();
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(fired).toEqual(['t1']);

    abortRun('t1');
    await running;
    engine.stop();
    expect(isRunning('t1')).toBe(false);
    expect(fired).toEqual(['t1']);
  });
});

describe('executeTask', () => {
  it('dispatches by task.runtime', async () => {
    const local = createHarness();
    await executeTask(makeTask(), local.deps);
    expect(local.loopRequests).toHaveLength(1);

    const server = createHarness();
    const promise = executeTask(makeTask({ runtime: 'server', serverId: 'srv-1' }), server.deps);
    await vi.waitFor(() => expect(server.chatStarts).toHaveLength(1));
    server.emit('stream-1', { type: 'done' });
    await promise;
    expect(server.serverSessions).toHaveLength(1);
  });
});
