/**
 * Context Hub - 任务上下文单一事实源
 *
 * 核心原则（按计划 Section 3）：
 * 1. Context Hub 是任务上下文唯一写入者
 * 2. Agent 和子代理只读取 Context Selector 生成的最小上下文
 * 3. 所有状态变化都产生带 sequence/revision 的 Context Event
 * 4. 文件、测试和子代理结果都必须带工作区 revision
 * 5. Responses Items 原样保留协议语义
 * 6. UI 通过事件观察状态，不自行推断任务是否完成
 */

import { v4 as uuid } from 'uuid';
import log from 'electron-log/main';
import {
  insertContextEvent,
  getContextEventsBySession,
  getMaxSequence,
  insertResponseItem,
  insertVerificationEvidence,
  markEvidenceStale,
  insertContextCheckpoint,
  getLatestCheckpoint,
  insertSubagentRun,
  updateSubagentRun,
} from '../store/db';
import type {
  ContextEventEnvelope,
  ContextEventType,
  VerificationEvidence,
  ContextCheckpoint,
} from '../../shared/ipc';
import type { ResponseItem } from '../../shared/responses';

// ============================================
// TaskContext 状态结构
// ============================================

export interface TaskContext {
  sessionId: string;
  revision: number;
  workspaceRevision: number;
  checkpointId?: string;

  objective: string;
  constraints: string[];
  decisions: ContextDecision[];
  plan: PlanState;
  responseItems: ResponseItem[];

  workspace: WorkspaceContext;
  tools: ToolContext;
  verification: VerificationContext;
  memory: MemoryContext;
  subagents: SubagentContextState[];
  usage: ContextUsage;
}

export interface ContextDecision {
  id: string;
  description: string;
  reason: string;
  relatedFiles: string[];
  createdAt: string;
}

export interface PlanState {
  steps: PlanStep[];
  currentStepId?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'blocked' | 'completed';
  ownerAgentId?: string;
  relatedFiles: string[];
  requiredVerification: string[];
  evidenceIds: string[];
  blockedReason?: string;
}

export interface WorkspaceContext {
  /** 工作目录 */
  workDir: string;
  /** 最近读取的文件（路径 → revision） */
  readFileRevisions: Map<string, number>;
  /** 最近修改的文件（路径 → 修改信息） */
  modifiedFiles: Map<string, FileModification>;
  /** 未验证的文件列表 */
  unverifiedFiles: Set<string>;
}

export interface FileModification {
  filePath: string;
  toolCallId?: string;
  agentId: string;
  planStepId?: string;
  workspaceRevision: number;
  contentHash?: string;
  createdAt: string;
}

export interface ToolContext {
  /** 运行中的工具调用 */
  running: Map<string, ToolCallState>;
  /** 最近完成的工具调用 */
  completed: ToolCallState[];
}

export interface ToolCallState {
  id: string;
  name: string;
  args: unknown;
  status: 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
  /** 关联的 plan step */
  planStepId?: string;
  /** 影响的文件 */
  affectedFiles: string[];
}

export interface VerificationContext {
  /** 验证证据列表 */
  evidence: VerificationEvidence[];
  /** stale 的证据 ID */
  staleEvidenceIds: Set<string>;
}

export interface MemoryContext {
  /** 最近注入的记忆 */
  injected: Array<{
    id: string;
    scope: string;
    kind: string;
    content: string;
    source: string;
    possiblyStale: boolean;
  }>;
}

export interface SubagentContextState {
  id: string;
  task: string;
  role: 'research' | 'build' | 'verify';
  modelId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  contextRevision: number;
  workspaceRevision: number;
  resultSummary?: string;
  conflictWith?: string[];
}

export interface ContextUsage {
  inputUsageRatio: number;
  softThreshold: number;
  hardThreshold: number;
  nearLimit: boolean;
  hardLimited: boolean;
  currentInputTokens: number;
  usableInputBudget: number;
  lastCompactedAt?: string;
}

// ============================================
// Context Hub 类
// ============================================

export class ContextHub {
  private context: TaskContext;
  private sequence: number;
  private eventQueue: ContextEventEnvelope[] = [];
  private processing = false;
  private listeners: Array<(event: ContextEventEnvelope) => void> = [];

  constructor(
    private sessionId: string,
    private workDir: string,
    private contextWindow: number = 256000,
    private maxOutputTokens: number = 16384,
  ) {
    // 从数据库恢复状态或初始化
    this.sequence = getMaxSequence(sessionId);
    this.context = this.initializeContext();
    this.replayEvents();
  }

  /**
   * 初始化空的 TaskContext
   */
  private initializeContext(): TaskContext {
    return {
      sessionId: this.sessionId,
      revision: 0,
      workspaceRevision: 0,
      objective: '',
      constraints: [],
      decisions: [],
      plan: { steps: [] },
      responseItems: [],
      workspace: {
        workDir: this.workDir,
        readFileRevisions: new Map(),
        modifiedFiles: new Map(),
        unverifiedFiles: new Set(),
      },
      tools: {
        running: new Map(),
        completed: [],
      },
      verification: {
        evidence: [],
        staleEvidenceIds: new Set(),
      },
      memory: {
        injected: [],
      },
      subagents: [],
      usage: this.calculateUsage(),
    };
  }

  /**
   * 从数据库重放事件恢复状态
   */
  private replayEvents(): void {
    const events = getContextEventsBySession(this.sessionId);
    for (const event of events) {
      this.applyEvent(event);
    }
    log.info(`Context Hub: 重放 ${events.length} 个事件，revision=${this.context.revision}`);
  }

  /**
   * 计算 token 使用量
   */
  private calculateUsage(): ContextUsage {
    const toolReserveTokens = 2000;
    const safetyReserveTokens = 2000;
    const usableInputBudget = Math.max(0, this.contextWindow - this.maxOutputTokens - toolReserveTokens - safetyReserveTokens);
    const softThreshold = usableInputBudget * 0.75;
    const hardThreshold = usableInputBudget * 0.90;

    // 简化估算：基于 responseItems 数量（每个 item 约 100 tokens）
    const currentInputTokens = this.context?.responseItems.length * 100 || 0;
    const inputUsageRatio = usableInputBudget > 0 ? currentInputTokens / usableInputBudget : 1;

    return {
      inputUsageRatio,
      softThreshold,
      hardThreshold,
      nearLimit: usableInputBudget <= 0 || currentInputTokens >= softThreshold,
      hardLimited: usableInputBudget <= 0 || currentInputTokens >= hardThreshold,
      currentInputTokens,
      usableInputBudget,
      lastCompactedAt: this.context?.usage?.lastCompactedAt,
    };
  }

  // ============================================
  // 公共 API
  // ============================================

  /**
   * 获取当前上下文（只读）
   */
  getContext(): Readonly<TaskContext> {
    return { ...this.context };
  }

  /**
   * 获取当前 revision
   */
  getRevision(): number {
    return this.context.revision;
  }

  /**
   * 获取当前 workspace revision
   */
  getWorkspaceRevision(): number {
    return this.context.workspaceRevision;
  }

  /**
   * 注册事件监听器
   */
  onEvent(listener: (event: ContextEventEnvelope) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * 提交事件（单写者串行队列）
   */
  async commitEvent<T extends ContextEventType>(
    eventType: T,
    data?: unknown,
    sourceAgentId: string = 'main',
  ): Promise<ContextEventEnvelope> {
    const event: ContextEventEnvelope = {
      id: uuid(),
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      contextRevision: this.context.revision,
      workspaceRevision: this.context.workspaceRevision,
      sourceAgentId,
      createdAt: new Date().toISOString(),
      event: eventType,
      data,
    };

    // 入队
    this.eventQueue.push(event);

    // 如果没有正在处理，开始处理队列
    if (!this.processing) {
      await this.processQueue();
    }

    return event;
  }

  /**
   * 处理事件队列（串行）
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift()!;
      try {
        // 应用事件到状态
        this.applyEvent(event);
        // 持久化到数据库
        insertContextEvent(event);
        // 通知监听器
        for (const listener of this.listeners) {
          listener(event);
        }
      } catch (err) {
        log.error(`Context Hub: 处理事件失败 ${event.event}:`, err);
      }
    }

    this.processing = false;
  }

  /**
   * 应用事件到状态（纯函数）
   */
  private applyEvent(event: ContextEventEnvelope): void {
    // 递增 revision
    this.context.revision = event.contextRevision + 1;

    switch (event.event) {
      case 'user_message_added':
        this.handleUserMessageAdded(event);
        break;
      case 'plan_created':
        this.handlePlanCreated(event);
        break;
      case 'plan_step_changed':
        this.handlePlanStepChanged(event);
        break;
      case 'tool_call_started':
        this.handleToolCallStarted(event);
        break;
      case 'tool_call_completed':
        this.handleToolCallCompleted(event);
        break;
      case 'approval_requested':
        this.handleApprovalRequested(event);
        break;
      case 'approval_resolved':
        this.handleApprovalResolved(event);
        break;
      case 'file_read':
        this.handleFileRead(event);
        break;
      case 'file_modified':
        this.handleFileModified(event);
        break;
      case 'command_completed':
        this.handleCommandCompleted(event);
        break;
      case 'verification_completed':
        this.handleVerificationCompleted(event);
        break;
      case 'subagent_started':
        this.handleSubagentStarted(event);
        break;
      case 'subagent_completed':
        this.handleSubagentCompleted(event);
        break;
      case 'memory_injected':
        this.handleMemoryInjected(event);
        break;
      case 'context_compacted':
        this.handleContextCompacted(event);
        break;
      case 'checkpoint_created':
        this.handleCheckpointCreated(event);
        break;
    }

    // 更新 usage
    this.context.usage = this.calculateUsage();
  }

  // ============================================
  // 事件处理函数
  // ============================================

  private handleUserMessageAdded(event: ContextEventEnvelope): void {
    const data = event.data as { content: string; attachments?: unknown[] };
    this.context.responseItems.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: data.content }],
    });
  }

  private handlePlanCreated(event: ContextEventEnvelope): void {
    const data = event.data as { objective: string; constraints: string[]; steps: PlanStep[] };
    this.context.objective = data.objective;
    this.context.constraints = data.constraints;
    this.context.plan.steps = data.steps;
  }

  private handlePlanStepChanged(event: ContextEventEnvelope): void {
    const data = event.data as { stepId: string; status: PlanStep['status']; reason?: string };
    const step = this.context.plan.steps.find(s => s.id === data.stepId);
    if (step) {
      step.status = data.status;
      if (data.reason) step.blockedReason = data.reason;
    }
  }

  private handleToolCallStarted(event: ContextEventEnvelope): void {
    const data = event.data as { id: string; name: string; args: unknown; planStepId?: string };
    this.context.tools.running.set(data.id, {
      id: data.id,
      name: data.name,
      args: data.args,
      status: 'running',
      startedAt: event.createdAt,
      planStepId: data.planStepId,
      affectedFiles: [],
    });
  }

  private handleToolCallCompleted(event: ContextEventEnvelope): void {
    const data = event.data as { id: string; result?: unknown; error?: string; affectedFiles?: string[] };
    const running = this.context.tools.running.get(data.id);
    if (running) {
      running.status = data.error ? 'failed' : 'completed';
      running.result = data.result;
      running.error = data.error;
      running.completedAt = event.createdAt;
      if (data.affectedFiles) running.affectedFiles = data.affectedFiles;
      this.context.tools.running.delete(data.id);
      this.context.tools.completed.push(running);
    }
  }

  private handleApprovalRequested(_event: ContextEventEnvelope): void {
    // 审批请求记录（UI 通过事件监听）
  }

  private handleApprovalResolved(_event: ContextEventEnvelope): void {
    // 审批解决记录
  }

  private handleFileRead(event: ContextEventEnvelope): void {
    const data = event.data as { filePath: string };
    this.context.workspace.readFileRevisions.set(data.filePath, this.context.workspaceRevision);
  }

  private handleFileModified(event: ContextEventEnvelope): void {
    const data = event.data as {
      filePath: string;
      toolCallId?: string;
      agentId: string;
      planStepId?: string;
      contentHash?: string;
    };

    // 递增 workspace revision
    this.context.workspaceRevision++;

    // 记录修改
    this.context.workspace.modifiedFiles.set(data.filePath, {
      filePath: data.filePath,
      toolCallId: data.toolCallId,
      agentId: data.agentId,
      planStepId: data.planStepId,
      workspaceRevision: this.context.workspaceRevision,
      contentHash: data.contentHash,
      createdAt: event.createdAt,
    });

    // 使读取缓存失效
    this.context.workspace.readFileRevisions.delete(data.filePath);

    // 标记为未验证
    this.context.workspace.unverifiedFiles.add(data.filePath);

    // 使相关 evidence 过期
    this.invalidateEvidenceForFile(data.filePath);

    // 关联的 plan step 回退到 in_progress
    if (data.planStepId) {
      const step = this.context.plan.steps.find(s => s.id === data.planStepId);
      if (step && step.status === 'completed') {
        step.status = 'in_progress';
        step.blockedReason = '文件已修改，需要重新验证';
      }
    }

    // 标记仍在读取旧版本文件的子代理为 stale
    this.markStaleSubagentsForFile(data.filePath);
  }

  private handleCommandCompleted(event: ContextEventEnvelope): void {
    const data = event.data as {
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      planStepId?: string;
    };

    // 命令完成产生验证证据
    const evidence: VerificationEvidence = {
      id: uuid(),
      kind: 'test',
      command: data.command,
      relatedFiles: [],
      planStepIds: data.planStepId ? [data.planStepId] : [],
      workspaceRevision: this.context.workspaceRevision,
      ok: data.exitCode === 0,
      summary: data.exitCode === 0 ? '命令执行成功' : `命令失败 (exit ${data.exitCode})`,
      createdAt: event.createdAt,
    };

    this.context.verification.evidence.push(evidence);
    insertVerificationEvidence({ ...evidence, sessionId: this.sessionId });
  }

  private handleVerificationCompleted(event: ContextEventEnvelope): void {
    const data = event.data as {
      kind: VerificationEvidence['kind'];
      command?: string;
      relatedFiles: string[];
      planStepIds: string[];
      ok: boolean;
      summary: string;
    };

    const evidence: VerificationEvidence = {
      id: uuid(),
      kind: data.kind,
      command: data.command,
      relatedFiles: data.relatedFiles,
      planStepIds: data.planStepIds,
      workspaceRevision: this.context.workspaceRevision,
      ok: data.ok,
      summary: data.summary,
      createdAt: event.createdAt,
    };

    this.context.verification.evidence.push(evidence);
    insertVerificationEvidence({ ...evidence, sessionId: this.sessionId });

    // 如果验证成功，移除 unverified 标记
    if (data.ok) {
      for (const file of data.relatedFiles) {
        this.context.workspace.unverifiedFiles.delete(file);
      }
    }
  }

  private handleSubagentStarted(event: ContextEventEnvelope): void {
    const data = event.data as {
      id: string;
      task: string;
      role: 'research' | 'build' | 'verify';
      modelId?: string;
    };

    this.context.subagents.push({
      id: data.id,
      task: data.task,
      role: data.role,
      modelId: data.modelId,
      status: 'running',
      contextRevision: this.context.revision,
      workspaceRevision: this.context.workspaceRevision,
    });

    insertSubagentRun({
      id: data.id,
      sessionId: this.sessionId,
      parentAgentId: event.sourceAgentId,
      role: data.role,
      modelId: data.modelId,
      task: data.task,
      status: 'running',
      contextRevision: this.context.revision,
      workspaceRevision: this.context.workspaceRevision,
    });
  }

  private handleSubagentCompleted(event: ContextEventEnvelope): void {
    const data = event.data as {
      id: string;
      status: 'completed' | 'failed' | 'cancelled';
      resultSummary?: string;
    };

    const subagent = this.context.subagents.find(s => s.id === data.id);
    if (subagent) {
      subagent.status = data.status;
      subagent.resultSummary = data.resultSummary;
    }

    updateSubagentRun(data.id, data.status, data.resultSummary);
  }

  private handleMemoryInjected(event: ContextEventEnvelope): void {
    const data = event.data as {
      id: string;
      scope: string;
      kind: string;
      content: string;
      source: string;
      possiblyStale?: boolean;
    };

    this.context.memory.injected.push({
      id: data.id,
      scope: data.scope,
      kind: data.kind,
      content: data.content,
      source: data.source,
      possiblyStale: data.possiblyStale || false,
    });
  }

  private handleContextCompacted(event: ContextEventEnvelope): void {
    const data = event.data as {
      tokensBefore: number;
      tokensAfter: number;
      compressedCount: number;
      summary: string;
    };

    this.context.usage.lastCompactedAt = event.createdAt;
    this.context.usage.currentInputTokens = data.tokensAfter;
  }

  private handleCheckpointCreated(event: ContextEventEnvelope): void {
    const data = event.data as { checkpointId: string };
    this.context.checkpointId = data.checkpointId;
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 使文件相关的 evidence 过期
   */
  private invalidateEvidenceForFile(filePath: string): void {
    for (const evidence of this.context.verification.evidence) {
      if (evidence.relatedFiles.includes(filePath)) {
        this.context.verification.staleEvidenceIds.add(evidence.id);
      }
    }
    // 更新数据库
    markEvidenceStale(this.sessionId, this.context.workspaceRevision);
  }

  /**
   * 标记读取旧版本文件的子代理为 stale
   */
  private markStaleSubagentsForFile(filePath: string): void {
    for (const subagent of this.context.subagents) {
      if (subagent.status === 'running' || subagent.status === 'pending') {
        // 如果子代理的工作区版本小于当前版本，标记为 stale
        if (subagent.workspaceRevision < this.context.workspaceRevision) {
          subagent.status = 'failed';
          subagent.resultSummary = `上下文已过期：文件 ${filePath} 已修改`;
          updateSubagentRun(subagent.id, 'failed', subagent.resultSummary);
        }
      }
    }
  }

  /**
   * 创建 checkpoint
   */
  createCheckpoint(): ContextCheckpoint {
    const checkpoint: ContextCheckpoint = {
      id: uuid(),
      sessionId: this.sessionId,
      contextRevision: this.context.revision,
      workspaceRevision: this.context.workspaceRevision,
      objective: this.context.objective,
      constraints: [...this.context.constraints],
      decisions: this.context.decisions.map(d => d.description),
      filesChanged: Array.from(this.context.workspace.modifiedFiles.keys()),
      verification: this.context.verification.evidence
        .filter(e => !this.context.verification.staleEvidenceIds.has(e.id))
        .map(e => e.summary),
      failures: this.context.verification.evidence
        .filter(e => !e.ok)
        .map(e => e.summary),
      planState: this.context.plan.steps.map(s => ({
        id: s.id,
        description: s.description,
        status: s.status,
      })),
      pendingWork: this.context.plan.steps
        .filter(s => s.status !== 'completed')
        .map(s => s.description),
      createdAt: new Date().toISOString(),
    };

    insertContextCheckpoint(checkpoint);
    this.context.checkpointId = checkpoint.id;

    return checkpoint;
  }

  /**
   * 获取最新 checkpoint
   */
  getLatestCheckpoint(): ContextCheckpoint | null {
    return getLatestCheckpoint(this.sessionId);
  }

  /**
   * 添加 Response Item
   */
  addResponseItem(item: ResponseItem): void {
    this.context.responseItems.push(item);
    insertResponseItem({
      id: uuid(),
      sessionId: this.sessionId,
      sequence: this.context.responseItems.length,
      contextRevision: this.context.revision,
      workspaceRevision: this.context.workspaceRevision,
      itemType: item.type,
      itemData: item,
    });
  }

  /**
   * 获取 Response Items（用于构建请求）
   */
  getResponseItems(): ResponseItem[] {
    return [...this.context.responseItems];
  }

  /**
   * 检查是否达到硬阈值
   */
  isHardLimited(): boolean {
    return this.context.usage.hardLimited;
  }

  /**
   * 检查是否达到软阈值
   */
  isNearLimit(): boolean {
    return this.context.usage.nearLimit;
  }

  /**
   * 获取所有验证证据
   */
  getVerificationEvidence(): VerificationEvidence[] {
    return [...this.context.verification.evidence];
  }

  /**
   * 获取 stale 的证据
   */
  getStaleEvidence(): VerificationEvidence[] {
    return this.context.verification.evidence.filter(
      e => this.context.verification.staleEvidenceIds.has(e.id),
    );
  }

  /**
   * 获取未验证的文件
   */
  getUnverifiedFiles(): string[] {
    return Array.from(this.context.workspace.unverifiedFiles);
  }

  /**
   * 获取运行中的子代理
   */
  getRunningSubagents(): SubagentContextState[] {
    return this.context.subagents.filter(s => s.status === 'running' || s.status === 'pending');
  }

  /**
   * 检查 task_complete 是否满足门禁
   */
  canCompleteTask(): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // 检查所有 plan steps 是否完成
    const incompleteSteps = this.context.plan.steps.filter(s => s.status !== 'completed');
    if (incompleteSteps.length > 0) {
      reasons.push(`还有 ${incompleteSteps.length} 个计划步骤未完成`);
    }

    // 检查是否有运行中的工具
    if (this.context.tools.running.size > 0) {
      reasons.push(`还有 ${this.context.tools.running.size} 个工具正在运行`);
    }

    // 检查是否有运行中的子代理
    const runningSubagents = this.getRunningSubagents();
    if (runningSubagents.length > 0) {
      reasons.push(`还有 ${runningSubagents.length} 个子代理正在运行`);
    }

    // 检查是否有未验证的文件
    if (this.context.workspace.unverifiedFiles.size > 0) {
      reasons.push(`还有 ${this.context.workspace.unverifiedFiles.size} 个文件未验证`);
    }

    // 检查是否有 stale 的证据
    const staleEvidence = this.getStaleEvidence();
    if (staleEvidence.length > 0) {
      reasons.push(`有 ${staleEvidence.length} 个验证证据已过期`);
    }

    // 检查是否有上下文冲突（stale 子代理）
    const staleSubagents = this.context.subagents.filter(s => s.status === 'failed' && s.resultSummary?.includes('过期'));
    if (staleSubagents.length > 0) {
      reasons.push(`有 ${staleSubagents.length} 个子代理因上下文过期而失败`);
    }

    return { ok: reasons.length === 0, reasons };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.listeners = [];
    this.eventQueue = [];
  }
}
