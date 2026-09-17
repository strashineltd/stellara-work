/**
 * 调度任务执行绑定：本地无 UI 运行 / 服务器运行 + 运行记录 + 调度推进 + 通知。
 *
 * - 纯 DI（不 import electron）：main.ts 注入真实依赖，runner.test.ts 用 fake。
 * - 安全（P9/C1）：本地运行不向 Agent 循环传 `onApproval`，危险工具失败关闭；
 *   `task.allowDangerous` 仅 UI 风险确认，运行时无效果（已知限制，见报告）。
 * - P16：本地运行落库最小消息（用户提示词 + 最终 assistant 文本），会话可在历史中查看。
 * - P17：服务器未连接 / 断线 → run 记 error 并通知；调度仍推进到下一次（不立即重试）。
 * - 运行生命周期：running → success / error / aborted → pruneRuns(200) →
 *   updateScheduledTask(lastRunAt/lastStatus + once 停用 / interval·cron 重算) → 通知。
 */
import type {
  ChatStreamEvent,
  CreateSessionArgs,
  ModelConfig,
  ScheduledRun,
  ScheduledTask,
} from '@shared/ipc';
import { computeNextRun } from './engine';

/** 每个任务的执行记录上限（P8：由执行方在运行结束后调用 pruneRuns） */
export const RUN_HISTORY_KEEP = 200;

/** 服务器任务等待终态（session.idle / error）的超时（spec §5.2：30 分钟） */
export const SERVER_RUN_TIMEOUT_MS = 30 * 60_000;

/** 本地无 UI 会话的落库入参（db.createSession 的子集） */
export interface RunnerSessionInput {
  id: string;
  title: string;
  modelId: string;
  workDir?: string;
  projectId?: string;
  runtime?: 'local' | 'server';
  serverId?: string;
  remoteSessionId?: string;
  userId?: string;
}

/** P16：最小消息（用户提示词 / 最终 assistant 文本） */
export interface RunnerMessage {
  sessionId: string;
  position: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
}

/** 执行结束后的任务簿记补丁（updateScheduledTask 的子集） */
export interface SchedulerTaskPatch {
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: string | null;
}

export interface RunnerDb {
  createSession(input: RunnerSessionInput): { id: string };
  recordRun(taskId: string, run: ScheduledRun): void;
  pruneRuns(taskId: string, keep?: number): number;
  updateScheduledTask(id: string, patch: SchedulerTaskPatch): unknown;
  appendMessage(message: RunnerMessage): void;
}

/** 服务器任务：经 SessionBridge.create 建立本地映射行（未连接时抛错） */
export interface RunnerSessionBridge {
  create(args: CreateSessionArgs, userId?: string): Promise<{ id: string }>;
}

export interface RunnerChatBridge {
  start(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
  ): Promise<{ streamId: string }>;
  abort(streamId: string): Promise<void>;
  /** 订阅某流的流事件（调度运行的无 UI sink）；返回退订函数 */
  watch(streamId: string, listener: (event: ChatStreamEvent) => void): () => void;
}

/**
 * 本地循环入参。刻意不含 `onApproval` —— 调度运行没有审批通道，
 * 危险工具按既有失败关闭语义被拒绝（C1/P9）。
 */
export interface LocalLoopRequest {
  prompt: string;
  sessionId: string;
  model: ModelConfig;
  cwd: string;
  signal: AbortSignal;
  memoryProjectId?: string;
  memoryUserId?: string;
}

export type LocalLoopRunner = (request: LocalLoopRequest) => AsyncIterable<ChatStreamEvent>;

export interface TaskEndNotificationState {
  completed: boolean;
  failed: boolean;
  aborted: boolean;
}

export interface SchedulerRunnerDeps {
  db: RunnerDb;
  /** 服务器任务的会话创建（SessionBridge）；本地运行不经此路径 */
  sessions: RunnerSessionBridge;
  chat: RunnerChatBridge;
  runLocalLoop: LocalLoopRunner;
  /** 解析任务使用的模型（task.modelId，否则活动模型）；无可用模型返回 null */
  resolveModel(task: ScheduledTask): Promise<ModelConfig | null>;
  isDirectory(path: string): Promise<boolean>;
  notify(state: TaskEndNotificationState): void;
  uuid(): string;
  now(): Date;
  /** 服务器任务等待终态的时长；默认 30 分钟 */
  serverTimeoutMs?: number;
}

type TerminalStatus = 'success' | 'error' | 'aborted';

interface RunOutcome {
  status: TerminalStatus;
  sessionId?: string;
  error?: string;
}

interface ActiveRun {
  abort(): void;
}

interface RunContext {
  startedAt: number;
  userId: string;
  signal: AbortSignal;
  /** 会话创建后补写运行记录的 sessionId */
  setSessionId(sessionId: string): void;
  /** 追加取消动作（服务器 /abort）；信号中止仍会执行 */
  setAbortAction(action: () => void): void;
}

/** 进行中的运行登记（abortRun 入口；按任务 id 索引，运行结束即清理） */
const activeRuns = new Map<string, ActiveRun>();

/** 取消进行中的运行（本地置 abort 信号 / 服务器调 /abort）。返回是否命中。 */
export function abortRun(taskId: string): boolean {
  const active = activeRuns.get(taskId);
  if (!active) return false;
  active.abort();
  return true;
}

/**
 * 任务是否正在运行。运行期间其 DB 行的 nextRunAt 仍是过去值，因此调用方在
 * 重排 / 错过补偿前必须用它过滤，否则同一个到期周期会被重复触发（并发会话 / 通知，
 * once 任务还会重复执行）。
 */
export function isRunning(taskId: string): boolean {
  return activeRuns.has(taskId);
}

/** 仅供测试：清空进行中运行登记（模块级状态） */
export function _resetActiveRunsForTests(): void {
  activeRuns.clear();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `providerID/modelID` → 服务器模型映射（无 / 或残缺时返回 undefined）。 */
function parseServerModel(modelId: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!modelId) return undefined;
  const slash = modelId.indexOf('/');
  if (slash <= 0 || slash === modelId.length - 1) return undefined;
  return { providerID: modelId.slice(0, slash), modelID: modelId.slice(slash + 1) };
}

/**
 * 执行任务：按 `task.runtime` 分派。运行结果已落库，返回值便于调用方/测试使用。
 */
export function executeTask(task: ScheduledTask, deps: SchedulerRunnerDeps): Promise<ScheduledRun> {
  return task.runtime === 'server' ? runServerTask(task, deps) : runLocalTask(task, deps);
}

/** 本地无 UI 运行（复用现有 Agent 循环，不传 onApproval）。 */
export function runLocalTask(task: ScheduledTask, deps: SchedulerRunnerDeps): Promise<ScheduledRun> {
  return runWithLifecycle(task, deps, (context) => runLocalBody(task, deps, context));
}

/** 服务器运行（SessionBridge 建会话 → promptAsync → 等待 done/error，30 分钟超时）。 */
export function runServerTask(task: ScheduledTask, deps: SchedulerRunnerDeps): Promise<ScheduledRun> {
  return runWithLifecycle(task, deps, (context) => runServerBody(task, deps, context));
}

async function runWithLifecycle(
  task: ScheduledTask,
  deps: SchedulerRunnerDeps,
  body: (context: RunContext) => Promise<RunOutcome>,
): Promise<ScheduledRun> {
  const runId = deps.uuid();
  const startedAt = deps.now().getTime();
  const userId = task.userId ?? 'default';
  const base = { id: runId, taskId: task.id, startedAt, userId };
  deps.db.recordRun(task.id, { ...base, status: 'running' });

  const controller = new AbortController();
  const activeRun: ActiveRun = { abort: () => controller.abort() };
  activeRuns.set(task.id, activeRun);

  let outcome: RunOutcome;
  try {
    outcome = await body({
      startedAt,
      userId,
      signal: controller.signal,
      setSessionId: (sessionId) => {
        deps.db.recordRun(task.id, { ...base, status: 'running', sessionId });
      },
      setAbortAction: (action) => {
        activeRun.abort = () => {
          controller.abort();
          action();
        };
        if (controller.signal.aborted) action();
      },
    });
  } catch (error) {
    const message = errorMessage(error);
    outcome = controller.signal.aborted
      ? { status: 'aborted', error: message }
      : { status: 'error', error: message };
  } finally {
    if (activeRuns.get(task.id) === activeRun) activeRuns.delete(task.id);
  }

  const run: ScheduledRun = {
    ...base,
    finishedAt: deps.now().getTime(),
    status: outcome.status,
    ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  };
  deps.db.recordRun(task.id, run);
  deps.db.pruneRuns(task.id, RUN_HISTORY_KEEP);

  const once = task.scheduleKind === 'once';
  deps.db.updateScheduledTask(task.id, {
    lastRunAt: startedAt,
    lastStatus: outcome.status,
    ...(once
      ? { enabled: false, nextRunAt: null }
      : { nextRunAt: computeNextRun(task.scheduleKind, task.scheduleExpr, deps.now())?.getTime() ?? null }),
  });

  deps.notify({
    completed: outcome.status === 'success',
    failed: outcome.status === 'error',
    aborted: outcome.status === 'aborted',
  });

  return run;
}

async function runLocalBody(
  task: ScheduledTask,
  deps: SchedulerRunnerDeps,
  context: RunContext,
): Promise<RunOutcome> {
  const model = await deps.resolveModel(task);
  if (!model) {
    throw new Error('任务未配置可用模型：请为该任务指定模型，或先在设置中配置模型');
  }
  const cwd = task.workDir ?? model.workDir;
  if (!cwd) {
    throw new Error('任务未配置工作目录：请为任务选择项目 / 工作目录，或为模型配置工作目录');
  }
  if (!(await deps.isDirectory(cwd))) {
    throw new Error(`工作目录不存在或无法访问：${cwd}`);
  }

  const sessionId = deps.uuid();
  deps.db.createSession({
    id: sessionId,
    title: task.name,
    modelId: model.id,
    workDir: cwd,
    runtime: 'local',
    ...(task.projectId !== undefined ? { projectId: task.projectId } : {}),
    userId: context.userId,
  });
  context.setSessionId(sessionId);

  // P16：先落用户提示词，会话在运行期间即可在历史中查看
  deps.db.appendMessage({
    sessionId,
    position: 0,
    role: 'user',
    content: task.prompt,
    createdAt: context.startedAt,
  });

  let finalText = '';
  let error: string | null = null;
  for await (const event of deps.runLocalLoop({
    prompt: task.prompt,
    sessionId,
    model: { ...model, workDir: cwd },
    cwd,
    signal: context.signal,
    ...(task.projectId !== undefined ? { memoryProjectId: task.projectId } : {}),
    memoryUserId: context.userId,
  })) {
    if (context.signal.aborted) break;
    if (event.type === 'content' && event.content) finalText += event.content;
    if (event.type === 'error') error = event.error ?? '任务执行失败';
  }

  if (finalText.trim() !== '') {
    deps.db.appendMessage({
      sessionId,
      position: 1,
      role: 'assistant',
      content: finalText,
      createdAt: deps.now().getTime(),
    });
  }

  if (context.signal.aborted) return { status: 'aborted', sessionId };
  if (error !== null) return { status: 'error', sessionId, error };
  return { status: 'success', sessionId };
}

async function runServerBody(
  task: ScheduledTask,
  deps: SchedulerRunnerDeps,
  context: RunContext,
): Promise<RunOutcome> {
  const serverModel = parseServerModel(task.modelId);
  const session = await deps.sessions.create(
    {
      title: task.name,
      runtime: 'server',
      ...(task.serverId !== undefined ? { serverId: task.serverId } : {}),
      ...(serverModel !== undefined ? { serverModel } : {}),
    },
    context.userId,
  );
  context.setSessionId(session.id);

  const { streamId } = await deps.chat.start(session.id, task.prompt, serverModel, undefined);
  context.setAbortAction(() => {
    void deps.chat.abort(streamId);
  });

  return waitForServerTerminal(deps, streamId, session.id, context.signal, deps.serverTimeoutMs ?? SERVER_RUN_TIMEOUT_MS);
}

function waitForServerTerminal(
  deps: SchedulerRunnerDeps,
  streamId: string,
  sessionId: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: RunOutcome): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const unsubscribe = deps.chat.watch(streamId, (event) => {
      if (event.type === 'done') {
        finish({ status: 'success', sessionId });
      } else if (event.type === 'error') {
        finish({ status: 'error', sessionId, error: event.error ?? '服务器任务执行失败' });
      }
    });
    const timer = setTimeout(() => {
      finish({
        status: 'error',
        sessionId,
        error: `服务器任务执行超时（${Math.round(timeoutMs / 60_000)} 分钟）`,
      });
    }, timeoutMs);
    const onAbort = (): void => {
      finish({ status: 'aborted', sessionId });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}
