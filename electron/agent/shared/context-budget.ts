/**
 * 迭代边界上下文预算检查（两条 loop 共用）：
 * 达到软阈值同步压缩；压缩后仍超硬阈值产出统一错误事件。
 */
import type { ChatStreamEvent } from '../../../shared/ipc';
import type { ContextHub } from '../../context/context-hub';

export interface BudgetCheckResult {
  compacted: boolean;
  hardLimited: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
  /** 待转发的 UI 事件：summary（压缩成功）或 error（压缩后仍超硬阈值） */
  events: ChatStreamEvent[];
}

export async function runBudgetCheck(input: {
  hub: ContextHub;
  requestTokens: number;
  summarize?: (transcript: string) => Promise<string | undefined>;
  signal?: AbortSignal;
}): Promise<BudgetCheckResult> {
  const { hub, requestTokens, summarize, signal } = input;
  const budget = await hub.ensureContextBudget({ extraTokens: requestTokens, signal, summarize });

  const result: BudgetCheckResult = {
    compacted: budget.compacted,
    hardLimited: budget.hardLimited,
    events: [],
  };

  if (budget.compacted) {
    result.tokensBefore = budget.tokensBefore;
    result.tokensAfter = budget.tokensAfter;
    result.compressedCount = budget.compressedCount;
    result.summary = budget.summary;
    result.events.push({
      type: 'summary',
      tokensBefore: budget.tokensBefore,
      tokensAfter: budget.tokensAfter,
      compressedCount: budget.compressedCount,
      summary: budget.summary,
    });
  }

  if (budget.hardLimited) {
    result.events.push({
      type: 'error',
      error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
      errorMeta: {
        kind: 'context_too_long',
        hint: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
        retryable: false,
      },
    });
  }

  return result;
}
