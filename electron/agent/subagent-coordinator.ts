/**
 * 子代理协调器（会话级）
 *
 * 替代全局 setSubagentRunner 模式，每个会话有独立的协调器实例。
 * 核心功能（按计划 Section 8）：
 * 1. 会话级 coordinator（不跨会话覆盖）
 * 2. role/model/readOnly/fileScopes schema
 * 3. 并发策略（research/verify 并行，build 串行）
 * 4. 父取消级联
 * 5. context packet/result
 * 6. stale/conflict 合并
 * 7. usage 汇总
 */

import { v4 as uuid } from 'uuid';
import log from 'electron-log/main';
import type {
  SubagentDef,
  SubagentContextResult,
} from '../../shared/ipc';
import type { ContextHub, SubagentContextState } from '../context/context-hub';
import {
  updateSubagentRun,
} from '../store/db';

// ============================================
// 接口定义
// ============================================

/** 子代理执行器（注入外部实现） */
export type SubagentRunner = (
  definition: SubagentDef,
  packet: SubagentContextPacket,
  signal: AbortSignal,
) => Promise<{ summary: string; ok: boolean }>;

/** 子代理批次请求 */
export interface SubagentBatchRequest {
  subagents: SubagentDef[];
  /** 默认模型 ID（不指定时继承主模型） */
  defaultModelId?: string;
}

/** 子代理批次结果 */
export interface SubagentBatchResult {
  results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>;
  conflicts: string[];
  totalUsage: { promptTokens: number; completionTokens: number };
}

/** Context Packet（父→子） */
export interface SubagentContextPacket {
  parentContextRevision: number;
  workspaceRevision: number;
  task: string;
  role: 'research' | 'build' | 'verify';
  constraints: string[];
  relevantFiles: string[];
  relevantDecisions: Array<{ description: string; reason: string }>;
  planStep?: { id: string; description: string };
  expectedOutput: string;
}

// ============================================
// 常量
// ============================================

const MAX_PARALLEL = 4;
const MAX_SUBAGENTS = 10;

// ============================================
// SubagentCoordinator 类
// ============================================

export class SubagentCoordinator {
  private runner: SubagentRunner | null = null;
  private state: Map<string, SubagentContextState> = new Map();
  private abortController: AbortController | null = null;

  constructor(
    _sessionId: string,
    private contextHub: ContextHub,
  ) {}

  /**
   * 设置子代理执行器
   */
  setRunner(runner: SubagentRunner): void {
    this.runner = runner;
  }

  /**
   * 获取当前子代理状态
   */
  getState(): SubagentContextState[] {
    return Array.from(this.state.values());
  }

  /**
   * 取消所有子代理
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // 标记所有运行中的子代理为 cancelled
    for (const [id, subagent] of this.state) {
      if (subagent.status === 'running' || subagent.status === 'pending') {
        subagent.status = 'cancelled';
        updateSubagentRun(id, 'cancelled');
      }
    }
  }

  /**
   * 分发子代理批次
   */
  async dispatch(defs: SubagentDef[]): Promise<SubagentBatchResult> {
    if (!this.runner) {
      throw new Error('子代理执行器未设置');
    }

    // 验证
    const validationError = this.validate(defs);
    if (validationError) {
      return {
        results: defs.map(d => ({ id: d.id, summary: validationError, ok: false, elapsedMs: 0 })),
        conflicts: [validationError],
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // 检测 fileScopes 冲突
    const conflicts = this.detectConflicts(defs);
    if (conflicts.length > 0) {
      return {
        results: defs.map(d => ({ id: d.id, summary: 'fileScopes 冲突', ok: false, elapsedMs: 0 })),
        conflicts,
        totalUsage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // 初始化状态
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    for (const def of defs) {
      this.state.set(def.id, {
        id: def.id,
        task: def.task,
        role: def.role || 'research',
        modelId: def.modelId,
        status: 'pending',
        contextRevision: this.contextHub.getRevision(),
        workspaceRevision: this.contextHub.getWorkspaceRevision(),
      });

      // 记录事件（ContextHub 会自动插入 subagent_runs 表）
      await this.contextHub.commitEvent('subagent_started', {
        id: def.id,
        task: def.task,
        role: def.role || 'research',
        modelId: def.modelId,
      });
    }

    // 按角色分组执行
    const results = await this.executeByRole(defs, signal);

    // 计算总 usage
    const totalUsage = { promptTokens: 0, completionTokens: 0 };

    return {
      results,
      conflicts: [],
      totalUsage,
    };
  }

  /**
   * 按角色分组执行
   */
  private async executeByRole(
    defs: SubagentDef[],
    signal: AbortSignal,
  ): Promise<Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>> {
    const results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }> = [];

    // Research 和 Verify 可以并行
    const parallelDefs = defs.filter(d => d.role === 'research' || d.role === 'verify' || !d.role);
    const parallelResults = await this.executeParallel(parallelDefs, signal);
    results.push(...parallelResults);

    // Build 串行
    const buildDefs = defs.filter(d => d.role === 'build');
    for (const def of buildDefs) {
      if (signal.aborted) {
        results.push({ id: def.id, summary: '已取消', ok: false, elapsedMs: 0 });
        continue;
      }
      const result = await this.executeSingle(def, signal);
      results.push(result);
    }

    return results;
  }

  /**
   * 并行执行（research/verify）
   */
  private async executeParallel(
    defs: SubagentDef[],
    signal: AbortSignal,
  ): Promise<Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>> {
    if (defs.length === 0) return [];

    const results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }> = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= defs.length) return;
        if (signal.aborted) {
          results[index] = { id: defs[index]!.id, summary: '已取消', ok: false, elapsedMs: 0 };
          continue;
        }
        results[index] = await this.executeSingle(defs[index]!, signal);
      }
    };

    const parallelCount = Math.min(defs.length, MAX_PARALLEL);
    await Promise.all(Array.from({ length: parallelCount }, () => worker()));

    return results;
  }

  /**
   * 执行单个子代理
   */
  private async executeSingle(
    def: SubagentDef,
    signal: AbortSignal,
  ): Promise<{ id: string; summary: string; ok: boolean; elapsedMs: number }> {
    const startTime = Date.now();

    // 更新状态为 running
    const state = this.state.get(def.id);
    if (state) {
      state.status = 'running';
      updateSubagentRun(def.id, 'running');
    }

    try {
      // 执行（context packet 可选：用于调试或日志）
      const context = this.contextHub.getContext();
      const currentStep = context.plan.steps.find((step) => step.status === 'in_progress');
      const packet: SubagentContextPacket = {
        parentContextRevision: this.contextHub.getRevision(),
        workspaceRevision: this.contextHub.getWorkspaceRevision(),
        task: def.task,
        role: def.role ?? 'research',
        constraints: [...context.constraints],
        relevantFiles: def.fileScopes ?? [],
        relevantDecisions: context.decisions.map((decision) => ({
          description: decision.description,
          reason: decision.reason,
        })),
        planStep: currentStep ? { id: currentStep.id, description: currentStep.description } : undefined,
        expectedOutput: def.expectedOutput ?? '返回结论、涉及文件、验证结果和未解决问题。',
      };
      const result = await this.runner!(def, packet, signal);

      // 更新状态为 completed
      if (state) {
        state.status = 'completed';
        state.resultSummary = result.summary;
      }
      updateSubagentRun(def.id, 'completed', result.summary);

      // 记录事件
      await this.contextHub.commitEvent('subagent_completed', {
        id: def.id,
        status: 'completed',
        resultSummary: result.summary,
      });

      return {
        id: def.id,
        summary: result.summary,
        ok: result.ok,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = (err as Error).message;
      const elapsedMs = Date.now() - startTime;

      // 更新状态为 failed/cancelled
      if (state) {
        state.status = signal.aborted ? 'cancelled' : 'failed';
        state.resultSummary = error;
      }
      updateSubagentRun(def.id, signal.aborted ? 'cancelled' : 'failed', error);

      // 记录事件
      await this.contextHub.commitEvent('subagent_completed', {
        id: def.id,
        status: signal.aborted ? 'cancelled' : 'failed',
        resultSummary: error,
      });

      return {
        id: def.id,
        summary: error,
        ok: false,
        elapsedMs,
      };
    }
  }

  /**
   * 验证子代理定义
   */
  private validate(defs: SubagentDef[]): string | null {
    if (!Array.isArray(defs) || defs.length < 1 || defs.length > MAX_SUBAGENTS) {
      return `subagents 必须是 1-${MAX_SUBAGENTS} 项的非空数组`;
    }

    for (let i = 0; i < defs.length; i++) {
      if (typeof defs[i]!.id !== 'string' || defs[i]!.id.trim() === '') {
        return `subagents[${i}].id 不能为空`;
      }
      if (typeof defs[i]!.task !== 'string' || defs[i]!.task.trim() === '') {
        return `subagents[${i}].task 不能为空`;
      }
      if (defs[i]!.role === 'build' && (!defs[i]!.fileScopes || defs[i]!.fileScopes!.length === 0)) {
        return `build 子代理 ${defs[i]!.id} 必须声明 fileScopes`;
      }
    }

    if (new Set(defs.map(d => d.id)).size !== defs.length) {
      return 'subagents 的 id 必须唯一';
    }

    return null;
  }

  /**
   * 检测 fileScopes 冲突
   */
  private detectConflicts(defs: SubagentDef[]): string[] {
    const conflicts: string[] = [];

    // 只检查 build 角色的 fileScopes 冲突
    const buildDefs = defs.filter(d => d.role === 'build' && d.fileScopes);

    for (let i = 0; i < buildDefs.length; i++) {
      for (let j = i + 1; j < buildDefs.length; j++) {
        const scopesA = buildDefs[i]!.fileScopes ?? [];
        const scopesB = buildDefs[j]!.fileScopes ?? [];

        for (const left of scopesA) {
          for (const right of scopesB) {
            const a = left.replaceAll('\\', '/').replace(/\/$/, '');
            const b = right.replaceAll('\\', '/').replace(/\/$/, '');
            if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
              conflicts.push(`fileScopes 冲突: ${buildDefs[i]!.id} 的 ${left} 与 ${buildDefs[j]!.id} 的 ${right} 重叠`);
            }
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * 合并子代理结果到 Context Hub
   */
  async mergeResults(results: SubagentContextResult[]): Promise<void> {
    for (const result of results) {
      // 检查 workspace revision 是否一致
      if (result.basedOnRevision < this.contextHub.getWorkspaceRevision()) {
        log.warn(`子代理结果基于旧 revision (${result.basedOnRevision} < ${this.contextHub.getWorkspaceRevision()})，标记为 stale`);
        // 可以标记为 stale，但不自动覆盖
      }

      // 合并验证证据
      for (const evidence of result.verification) {
        await this.contextHub.commitEvent('verification_completed', {
          kind: evidence.kind,
          command: evidence.command,
          relatedFiles: evidence.relatedFiles,
          planStepIds: evidence.planStepIds,
          ok: evidence.ok,
          summary: evidence.summary,
        });
      }

      // 合并决策
      for (const decision of result.decisionsProposed) {
        this.contextHub.getContext().decisions.push({
          id: uuid(),
          description: decision.description,
          reason: decision.reason,
          relatedFiles: decision.relatedFiles || [],
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.cancel();
    this.state.clear();
  }
}
