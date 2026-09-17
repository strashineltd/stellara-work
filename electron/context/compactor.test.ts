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
    const items = [call('c1'), out('c1', 'x'), call('c2'), out('c2', 'y'), msg('tail')];
    expect(adjustCutForTransactions(items, 1)).toBe(2);
  });

  it('目标极小也至少保留最后一个事务组件', () => {
    const items = [call('c1'), out('c1', 'x'.repeat(800)), msg('tail')];
    const result = compact(items, options({ targetTokens: 1, hardLimitTokens: 1_000_000 }));
    expect(result.keptItems.some((i) => i.type === 'function_call')).toBe(true);
    assertNoOrphanOutputs(result.keptItems);
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

  it('reasoning 与后续调用同组，切点不拆开', () => {
    const items: ResponseItem[] = [
      msg('x'.repeat(400)),
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'r1' }] },
      call('c1'),
      out('c1', 'a'.repeat(400)),
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'r2' }] },
      call('c2'),
      out('c2', 'b'.repeat(400)),
    ];
    const result = compact(items, options({ targetTokens: 50, hardLimitTokens: 1_000_000 }));
    expect(result.keptItems[0]!.type).toBe('reasoning');
    assertNoOrphanOutputs(result.keptItems);
  });

  it('被保留的调用不会丢掉紧邻其前的 reasoning', () => {
    const all: ResponseItem[] = [
      msg('x'.repeat(400)),
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'r1' }] },
      call('c1'),
      out('c1', 'a'.repeat(400)),
      msg('tail'),
    ];
    const result = compact(all, options({ targetTokens: 30, hardLimitTokens: 1_000_000 }));
    const kept = new Set(result.keptItems);
    for (let i = 0; i < all.length; i++) {
      const item = all[i]!;
      if (item.type !== 'function_call' || !kept.has(item)) continue;
      const prev = all[i - 1];
      if (prev && prev.type === 'reasoning') expect(kept.has(prev)).toBe(true);
    }
  });
});

import { capToolOutput, buildSummaryTranscript } from './compactor';

describe('capToolOutput', () => {
  it('未超限时原样返回', () => {
    const result = { ok: true, output: 'small' };
    expect(capToolOutput('read_file', { path: 'a.txt' }, result)).toBe(result);
  });

  it('read_file 超限时保留路径与 digest', () => {
    const result = {
      ok: true,
      output: Array.from({ length: 30_000 }, (_, i) => `line ${i} ${(i * 7919).toString(36)}`).join('\n'),
    };
    const capped = capToolOutput('read_file', { path: 'a.txt', offset: 10, limit: 50 }, result, 100) as {
      truncation: { kind: string; path?: string; digest: string };
    };
    expect(capped.truncation.kind).toBe('read_file');
    expect(capped.truncation.path).toBe('a.txt');
    expect(capped.truncation.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('run_command 超限时保留退出码与头尾', () => {
    const stdout = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');
    const result = {
      ok: true,
      output: stdout,
      meta: { kind: 'command', command: 'run', stdout, stderr: 'boom', exitCode: 3, durationMs: 5 },
    };
    const capped = capToolOutput('run_command', {}, result, 10) as {
      truncation: { kind: string; exitCode?: number; head: string; tail: string };
    };
    expect(capped.truncation.kind).toBe('command');
    expect(capped.truncation.exitCode).toBe(3);
    expect(capped.truncation.head).toContain('line-0');
    expect(capped.truncation.tail).toContain('line-99');
  });

  it('单行超大输出也受字符上限约束', () => {
    const result = {
      ok: true,
      output: Array.from({ length: 50_000 }, (_, i) => (i * 31).toString(36)).join(''),
    };
    const capped = capToolOutput('generic_tool', {}, result, 100) as {
      truncation: { head: string; tail: string };
    };
    expect(capped.truncation.head.length).toBeLessThanOrEqual(4_000);
    expect(capped.truncation.tail.length).toBeLessThanOrEqual(4_000);
  });
});

describe('buildSummaryTranscript', () => {
  it('去重同内容工具输出、带工具名与首行、附带旧摘要', () => {
    const items = [
      msg('用户要求实现登录'),
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'file body A\nmore' },
      { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c2', output: 'file body A\nmore' },
    ] as ResponseItem[];
    const transcript = buildSummaryTranscript(items, '此前摘要');
    expect(transcript).toContain('此前摘要');
    expect(transcript).toContain('[user] 用户要求实现登录');
    expect(transcript).toContain('[tool read_file] file body A');
    expect(transcript.match(/\[tool read_file\]/g)).toHaveLength(1);
  });
});
