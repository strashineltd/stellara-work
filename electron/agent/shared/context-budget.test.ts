import { describe, expect, it, vi } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { runBudgetCheck } from './context-budget';

function bigItems(hub: ContextHub, count: number): void {
  for (let i = 0; i < count; i++) {
    hub.addResponseItem({
      type: 'message',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `m${i} `.repeat(100) }],
      status: 'completed',
    });
  }
}

describe('runBudgetCheck', () => {
  it('低于软阈值不压缩、不产出事件', async () => {
    const hub = new ContextHub('budget-1', '/tmp', 100_000, 16_384, { persist: false });
    const result = await runBudgetCheck({ hub, requestTokens: 100 });
    expect(result).toEqual({ compacted: false, hardLimited: false, events: [] });
  });

  it('达到软阈值压缩并产出 summary 事件', async () => {
    const hub = new ContextHub('budget-2', '/tmp', 8_000, 1_000, { persist: false });
    bigItems(hub, 60);

    const result = await runBudgetCheck({ hub, requestTokens: 100 });

    expect(result.compacted).toBe(true);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('summary');
    expect(event.tokensBefore!).toBeGreaterThan(event.tokensAfter!);
  });

  it('压缩后仍超硬阈值：产出统一错误事件', async () => {
    const hub = new ContextHub('budget-3', '/tmp', 100_000, 16_384, { persist: false });
    vi.spyOn(hub, 'ensureContextBudget').mockResolvedValue({ compacted: false, hardLimited: true });

    const result = await runBudgetCheck({ hub, requestTokens: 1 });

    expect(result.hardLimited).toBe(true);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'error',
        error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
        errorMeta: expect.objectContaining({ kind: 'context_too_long', retryable: false }),
      }),
    ]);
  });
});
