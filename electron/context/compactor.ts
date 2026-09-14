import { createHash } from 'node:crypto';
import type { ResponseItem } from '../../shared/responses';
import { estimateItemsTokens } from './token-estimator';

export interface CompactOptions {
  targetTokens: number;
  hardLimitTokens: number;
  previousWindowStartIndex: number;
  reason: 'soft_threshold' | 'hard_threshold' | 'manual';
}

export interface CompactResult {
  ok: boolean;
  keptItems: ResponseItem[];
  droppedCount: number;
  windowStartIndex: number;
  windowDigest?: string;
  tokensBefore: number;
  tokensAfter: number;
  reason: CompactOptions['reason'];
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortValue(source[key]);
    return sorted;
  }
  return value;
}

export function stableJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function digestItem(item: ResponseItem): string {
  return digestText(stableJSON(item));
}

/**
 * 把 items 切成互不相交的“事务组件”：一个 function_call 到它配对 output 的区间。
 * 交错调用（call1, call2, out1, out2）会合并为一个组件——该轮不可部分切割。
 */
export function transactionComponents(items: ResponseItem[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const callIndex = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.type === 'function_call') callIndex.set(item.call_id, index);
  });
  const paired = new Set<string>();
  items.forEach((item, index) => {
    if (item.type !== 'function_call_output') return;
    const callAt = callIndex.get(item.call_id);
    if (callAt == null) return;
    paired.add(item.call_id);
    spans.push({ start: Math.min(callAt, index), end: Math.max(callAt, index) });
  });
  items.forEach((item, index) => {
    if (item.type === 'function_call' && !paired.has(item.call_id)) {
      spans.push({ start: index, end: index });
    }
  });
  spans.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** 把候选切点调整到合法位置；若会清空窗口则保留最后一个事务组件。 */
export function adjustCutForTransactions(items: ResponseItem[], candidate: number): number {
  const components = transactionComponents(items);
  let cut = Math.min(Math.max(candidate, 0), items.length);
  let changed = true;
  while (changed && cut < items.length) {
    changed = false;
    for (const { start, end } of components) {
      if (start < cut && cut <= end) {
        cut = end + 1;
        changed = true;
      }
    }
  }
  if (components.length > 0) {
    const last = components[components.length - 1]!;
    if (cut > last.start) cut = last.start;
  }
  return cut;
}

function findItemCut(items: ResponseItem[], targetTokens: number): number {
  let total = 0;
  let cut = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = estimateItemsTokens([items[i]!]);
    if (cut < items.length && total + cost > targetTokens) break;
    total += cost;
    cut = i;
  }
  return cut;
}

export function compact(items: ResponseItem[], opts: CompactOptions): CompactResult {
  const tokensBefore = estimateItemsTokens(items);
  let cut = adjustCutForTransactions(items, findItemCut(items, opts.targetTokens));
  let tokensAfter = estimateItemsTokens(items.slice(cut));

  for (let attempt = 1; attempt < 3 && tokensAfter >= opts.hardLimitTokens; attempt++) {
    const target = Math.max(1, Math.floor(opts.targetTokens * Math.pow(0.5, attempt)));
    cut = adjustCutForTransactions(items, findItemCut(items, target));
    tokensAfter = estimateItemsTokens(items.slice(cut));
  }

  const keptItems = items.slice(cut);
  return {
    ok: tokensAfter < opts.hardLimitTokens,
    keptItems,
    droppedCount: cut,
    windowStartIndex: opts.previousWindowStartIndex + cut,
    windowDigest: keptItems.length > 0 ? digestItem(keptItems[0]!) : undefined,
    tokensBefore,
    tokensAfter,
    reason: opts.reason,
  };
}
