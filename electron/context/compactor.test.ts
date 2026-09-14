import { describe, it, expect } from 'vitest';
import {
  compact,
  digestItem,
  stableJSON,
  transactionComponents,
  adjustCutForTransactions,
  type CompactOptions,
} from './compactor';
import type { ResponseItem } from '../../shared/responses';

function msg(text: string): ResponseItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}
function call(id: string): ResponseItem {
  return { type: 'function_call', call_id: id, name: 'read_file', arguments: '{}', status: 'completed' };
}
function out(id: string, text: string): ResponseItem {
  return { type: 'function_call_output', call_id: id, output: text };
}
function options(partial: Partial<CompactOptions>): CompactOptions {
  return {
    targetTokens: 1_000_000,
    hardLimitTokens: 1_000_000,
    previousWindowStartIndex: 0,
    reason: 'soft_threshold',
    ...partial,
  };
}
function assertNoOrphanOutputs(items: ResponseItem[]): void {
  const calls = new Set(
    items.filter((i) => i.type === 'function_call').map((i) => i.call_id),
  );
  for (const item of items) {
    if (item.type === 'function_call_output') expect(calls.has(item.call_id)).toBe(true);
  }
}

describe('stableJSON / digestItem', () => {
  it('键顺序不影响 digest', () => {
    expect(stableJSON({ b: 1, a: 2 })).toBe(stableJSON({ a: 2, b: 1 }));
    expect(digestItem(msg('x'))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('transactionComponents / adjustCutForTransactions', () => {
  it('配对调用与输出，交错调用合并为同一组件', () => {
    expect(transactionComponents([call('c1'), out('c1', 'x')])).toEqual([{ start: 0, end: 1 }]);
    expect(
      transactionComponents([call('c1'), call('c2'), out('c1', 'x'), out('c2', 'y')]),
    ).toEqual([{ start: 0, end: 3 }]);
  });

  it('切点落入事务内部时向外扩张', () => {
    const items = [call('c1'), out('c1', 'x'), msg('tail')];
    expect(adjustCutForTransactions(items, 1)).toBe(2);
  });

  it('无法部分切割的轮次整体保留（不清空窗口）', () => {
    const items = [call('c1'), call('c2'), out('c1', 'x'), out('c2', 'y')];
    expect(adjustCutForTransactions(items, 2)).toBe(0);
  });
});

describe('compact', () => {
  it('保留最后一次事务，不产生孤立 output', () => {
    const items = [msg('a'.repeat(800)), call('c1'), out('c1', 'b'), call('c2'), out('c2', 'c')];
    const result = compact(items, options({ targetTokens: 20 }));
    expect(result.droppedCount).toBe(3);
    assertNoOrphanOutputs(result.keptItems);
    expect(result.keptItems[0]).toMatchObject({ type: 'function_call', call_id: 'c2' });
  });

  it('windowStartIndex 累计且 digest 指向首个保留项', () => {
    const items = [msg('a'.repeat(800)), call('c1'), out('c1', 'b')];
    const result = compact(items, options({ targetTokens: 20, previousWindowStartIndex: 7 }));
    expect(result.droppedCount).toBe(1);
    expect(result.windowStartIndex).toBe(8);
    expect(result.windowDigest).toBe(digestItem(result.keptItems[0]!));
  });

  it('单个巨事务无法压缩时 ok=false', () => {
    const items = [call('c1'), out('c1', 'b'.repeat(8000))];
    const result = compact(items, options({ targetTokens: 10, hardLimitTokens: 10 }));
    expect(result.ok).toBe(false);
    expect(result.droppedCount).toBe(0);
  });

  it('满足硬阈值时 ok=true 且 tokensAfter 下降', () => {
    const items = [msg('x'.repeat(800)), msg('y'.repeat(800)), msg('z'.repeat(40))];
    const result = compact(items, options({ targetTokens: 50, hardLimitTokens: 1_000_000 }));
    expect(result.ok).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });
});
