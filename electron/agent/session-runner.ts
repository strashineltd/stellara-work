/**
 * IPC 会话编排（协议无关）。
 *
 * 合并原 main.ts 的 runResponsesLoopForIpc / runAnthropicLoopForIpc 两份近似实现：
 * 会话/身份解析、附件注入、ContextHub + 子代理接线、审批桥、事件转发、
 * 通知、资源清理与会话后记忆提取。协议差异仅剩循环选择。
 */
import { app, powerSaveBlocker, type BrowserWindow } from 'electron';
import type {
  ChatRequest,
  ChatStreamEvent,
  ModelConfig,
  OpenAITool,
  SkillDef,
  SubagentDef,
  ToolCall,
} from '../../shared/ipc';
import type { ResponseFunctionTool } from '../../shared/responses';
import type { ChatStreamRegistry } from '../chat/stream-registry';
import { ContextHub, type PlanStep } from '../context/context-hub';
import { SubagentCoordinator, type SubagentContextPacket } from './subagent-coordinator';
import { setSubagentRunner } from './tools/dispatch-subagents';
import { clampApprovalTimeout } from '../chat/approval-timing';
import { requiresNativeConfirm } from '../chat/tool-confirm';
import { runResponsesLoop } from './responses-loop';
import { runAnthropicAgentLoop } from './anthropic-loop';

export interface SessionRunnerDeps {
  getWindow: () => BrowserWindow | null;
  chatStreams: ChatStreamRegistry;
  attachContextEvents: (hub: ContextHub, send: (event: ChatStreamEvent) => void) => () => void;
  notifyTaskEnd: (
    state: { completed: boolean; failed: boolean; aborted: boolean },
    focus: () => void,
  ) => void;
  unregisterBrowserStream: (sessionId: string, streamId: string) => void;
  /**
   * S4：危险工具的主进程原生确认。缺省时回退渲染层审批（兼容测试）。
   * 提供后 write_file/edit_file/run_command/browser_exec_js/dispatch_subagents
   * 以原生手势为准，渲染层无法自批。
   */
  confirmDangerousTool?: (toolName: string, args: string) => Promise<boolean>;
  runSubagent: (
    definition: SubagentDef,
    packet: SubagentContextPacket,
    model: ModelConfig,
    cwd: string,
    sessionId: string,
    send: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
    parentStreamId: string,
    approvalTimeoutMs?: number,
  ) => Promise<{ summary: string; ok: boolean; usage: { promptTokens: number; completionTokens: number } }>;
  extractMemories: (request: ChatRequest, model: ModelConfig) => Promise<void>;
}

export async function runAgentSession(
  deps: SessionRunnerDeps,
  request: ChatRequest,
  model: ModelConfig,
  streamId: string,
): Promise<void> {
  const send = (event: ChatStreamEvent) => {
    const win = deps.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('chat-stream', { streamId, event });
    }
  };

  // 记忆注入按项目 + 归属身份检索：解析会话所属项目与身份
  let memoryProjectId: string | undefined;
  let memoryUserId: string | undefined;
  try {
    const { getSession } = await import('../store/db');
    const session = getSession(request.sessionId);
    memoryProjectId = session?.projectId ?? undefined;
    memoryUserId = session?.userId;
  } catch {
    // 会话解析失败时按个人记忆注入
  }

  const messages = request.messages.map(({ attachments: _a, ...rest }) => rest);
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    send({ type: 'error', error: '消息历史末尾必须是 user 消息' });
    return;
  }

  // 附件注入
  let userContent = last.content;
  if (request.attachments && request.attachments.length > 0) {
    const attachmentLines = request.attachments.map(
      (a) => `- ${a.name} → ${a.relPath}（${a.kind === 'image' ? '图片' : '文件'}）`,
    );
    userContent = `用户附带附件（位于工作区 .stellara-attachments/ 目录，可用 read_file 读取）：\n${attachmentLines.join('\n')}\n\n${userContent}`;
  }

  // 防御：初始化失败（如数据库表缺失）时向 UI 回传错误，而不是无事件挂起
  let contextHub: ContextHub;
  try {
    contextHub = new ContextHub(
      request.sessionId,
      model.workDir || '.',
      model.contextWindow || 256000,
      model.maxOutputTokens || 16384,
    );
  } catch (err) {
    send({ type: 'error', error: `会话上下文初始化失败：${err instanceof Error ? err.message : String(err)}` });
    send({ type: 'done' });
    return;
  }
  const coordinator = new SubagentCoordinator(request.sessionId, contextHub);
  deps.attachContextEvents(contextHub, send);

  // 创建 AbortController
  const ctrl = deps.chatStreams.start(streamId, request.sessionId);
  let terminalEventSent = false;
  let taskCompleted = false;
  let taskFailed = false;

  // macOS：阻止系统休眠
  let powerSaveId: number | null = null;
  if (process.platform === 'darwin') {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  }

  const onApproval = async (toolCall: ToolCall): Promise<boolean> => {
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = clampApprovalTimeout(request.approvalTimeoutMs, 60_000);
    send({
      type: 'approval_required',
      approval: {
        id: approvalId,
        toolName: toolCall.function.name,
        args: toolCall.function.arguments,
        toolCallId: toolCall.id,
        expiresAt: Date.now() + timeoutMs,
      },
    });
    // S4：高危工具先走原生确认（不可被 renderer 代点）。原生通过后再放行；
    // 原生拒绝时同步 settle 渲染层待决审批，避免 UI 卡住。
    const toolName = toolCall.function.name;
    if (deps.confirmDangerousTool && requiresNativeConfirm(toolName)) {
      const nativeOk = await deps.confirmDangerousTool(toolName, toolCall.function.arguments);
      deps.chatStreams.respond(approvalId, nativeOk);
      return nativeOk;
    }
    return deps.chatStreams.requestApproval(streamId, approvalId, timeoutMs);
  };
  const onPlanApproval = async (plan: { objective: string; constraints: string[]; steps: PlanStep[] }): Promise<boolean> => {
    const approvalId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = clampApprovalTimeout(request.approvalTimeoutMs, 300_000);
    send({
      type: 'plan_approval_required',
      planApproval: { id: approvalId, plan: plan.steps.map((step) => step.description), expiresAt: Date.now() + timeoutMs },
    });
    return deps.chatStreams.requestApproval(streamId, approvalId, timeoutMs);
  };

  try {
    const cwd = model.workDir!;

    const { loadConfig } = await import('../config/config-v2');
    const appConfig = await loadConfig();
    const compactionSummaryEnabled = appConfig.app.contextCompactionSummaryEnabled !== false;

    // 加载 skills + /skill 精确调用目标
    let skills: SkillDef[] = [];
    let activeSkill: SkillDef | undefined;
    try {
      const { loadSkillsWithErrors, findSkill } = await import('./skills');
      const { items } = await loadSkillsWithErrors(cwd);
      skills = items.filter((s) => s.enabled !== false);
      if (request.activeSkillName) {
        activeSkill = findSkill(items.filter((s) => s.enabled !== false), request.activeSkillName) ?? undefined;
      }
    } catch {
      // skills 加载失败不影响 agent 运行
    }

    // 加载 MCP 工具（全量 + plan 模式可见的子集）
    let extraTools: OpenAITool[] = [];
    let planExtraTools: OpenAITool[] = [];
    try {
      const { mcpManager } = await import('../mcp/mcp-manager');
      extraTools = await mcpManager.getEnabledTools();
      planExtraTools = await mcpManager.getEnabledTools(true);
    } catch {
      // MCP 工具加载失败不影响 agent 运行
    }

    // 设置子代理执行器
    coordinator.setRunner(async (definition, packet, signal) => {
      return deps.runSubagent(definition, packet, model, cwd, request.sessionId, send, signal, streamId, request.approvalTimeoutMs);
    });
    setSubagentRunner(request.sessionId, {
      dispatch: (definitions) => coordinator.dispatch(definitions),
    });

    const loop = model.wireApi === 'anthropic'
      ? runAnthropicAgentLoop(userContent, {
          model,
          cwd,
          sessionId: request.sessionId,
          contextHub,
          history: messages.slice(0, -1),
          planMode: request.planMode ?? false,
          platform: { platform: process.platform, arch: process.arch },
          skills,
          activeSkill,
          extraTools,
          planExtraTools,
          memoryProjectId,
          memoryUserId,
          compactionSummaryEnabled,
          signal: ctrl.signal,
          onApproval,
          onPlanApproval,
        })
      : runResponsesLoop(userContent, {
          model,
          cwd,
          sessionId: request.sessionId,
          contextHub,
          history: messages.slice(0, -1),
          planMode: request.planMode ?? false,
          platform: { platform: process.platform, arch: process.arch },
          skills,
          activeSkill,
          extraTools: extraTools as unknown as ResponseFunctionTool[],
          planExtraTools: planExtraTools as unknown as ResponseFunctionTool[],
          memoryProjectId,
          memoryUserId,
          compactionSummaryEnabled,
          signal: ctrl.signal,
          onApproval,
          onPlanApproval,
        });

    for await (const event of loop) {
      if (ctrl.signal.aborted) break;
      send(event);
      if (event.type === 'task_complete') taskCompleted = true;
      if (event.type === 'error') taskFailed = true;
      if (event.type === 'done' || event.type === 'error') terminalEventSent = true;
    }

    // 任务结束通知
    const win = deps.getWindow();
    const windowActive = win !== null && !win.isDestroyed() && win.isFocused();
    if (!windowActive && !ctrl.signal.aborted && (taskCompleted || taskFailed)) {
      if (process.platform === 'darwin') {
        app.dock?.bounce(taskFailed ? 'critical' : 'informational');
      }
      deps.notifyTaskEnd(
        { completed: taskCompleted, failed: taskFailed, aborted: false },
        () => {
          const focusWin = deps.getWindow();
          if (focusWin && !focusWin.isDestroyed()) {
            if (focusWin.isMinimized()) focusWin.restore();
            focusWin.show();
            focusWin.focus();
          }
        },
      );
    }
  } catch (err) {
    if (!ctrl.signal.aborted) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    setSubagentRunner(request.sessionId, null);
    coordinator.dispose();
    contextHub.dispose();
    deps.chatStreams.cleanup(streamId);
    deps.unregisterBrowserStream(request.sessionId, streamId);
    if (!terminalEventSent) send({ type: 'done' });

    // macOS：恢复系统休眠
    if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }

    // 异步提取记忆
    void deps.extractMemories(request, model).catch(() => {});
  }
}
