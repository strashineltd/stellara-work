import { createHash } from 'node:crypto';
import type { ResponseItem } from '../../shared/responses';
import { estimateItemsTokens, estimateTextTokens } from './token-estimator';

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

/** 把候选切点调整到合法位置；只要有事务组件，就至少保留最后一个组件。 */
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

const INGEST_MAX_TOKENS = 16_000;
const STUB_HEAD_CHARS = 4_000;
const STUB_TAIL_CHARS = 4_000;

function takeHead(text: string): string {
  const head = text.split('\n').slice(0, 20).join('\n');
  return head.length > STUB_HEAD_CHARS ? head.slice(0, STUB_HEAD_CHARS) : head;
}

function takeTail(text: string): string {
  const tail = text.split('\n').slice(-20).join('\n');
  return tail.length > STUB_TAIL_CHARS ? tail.slice(-STUB_TAIL_CHARS) : tail;
}

/**
 * 工具结果入库上限：超限时替换为 stub。UI 的 tool_result 事件不受影响。
 */
export function capToolOutput(
  toolName: string,
  args: unknown,
  result: unknown,
  maxTokens: number = INGEST_MAX_TOKENS,
): unknown {
  const serialized = JSON.stringify(result ?? null) ?? '';
  if (serialized.length === 0) return result;
  if (estimateTextTokens(serialized) <= maxTokens) return result;

  const digest = digestText(serialized);
  const record = (result ?? {}) as {
    ok?: boolean;
    output?: string;
    error?: string;
    meta?: { kind?: string; command?: string; stdout?: string; stderr?: string; exitCode?: number };
  };

  if (toolName === 'read_file') {
    const readArgs = (args ?? {}) as { path?: string; offset?: number; limit?: number };
    return {
      ok: record.ok ?? true,
      output: '',
      truncation: {
        kind: 'read_file',
        path: readArgs.path,
        offset: readArgs.offset,
        limit: readArgs.limit,
        digest,
        bytes: serialized.length,
        note: '文件内容过大已省略，可带 offset/limit 重新读取',
      },
    };
  }

  if (toolName === 'run_command' || record.meta?.kind === 'command') {
    const stdout = record.meta?.stdout ?? record.output ?? '';
    const stderr = record.meta?.stderr ?? '';
    return {
      ok: record.ok ?? true,
      output: '',
      truncation: {
        kind: 'command',
        command: record.meta?.command,
        exitCode: record.meta?.exitCode,
        head: takeHead(stdout),
        tail: takeTail(stdout),
        stderrTail: takeTail(stderr),
        digest,
        bytes: serialized.length,
        note: '命令输出过大已截断',
      },
    };
  }

  return {
    ok: record.ok ?? true,
    output: '',
    truncation: {
      kind: 'generic',
      tool: toolName,
      head: takeHead(record.output ?? serialized),
      tail: takeTail(record.output ?? serialized),
      digest,
      bytes: serialized.length,
      note: '工具输出过大已截断',
    },
  };
}

export const COMPACTION_SUMMARY_PROMPT = `你是对话摘要助手。把给出的对话历史压缩成简洁摘要，保留：
1. 用户的关键需求、约束与偏好
2. 已完成的工作（修改的文件、运行的命令与结果）
3. 重要的失败与排除过程
4. 当前进展与未完成事项
直接输出摘要正文，不要标题，不超过 800 字，不得编造历史中没有的信息。`;

/** 把被丢弃的前缀转写成摘要输入：工具结果一行化 + 去重。 */
export function buildSummaryTranscript(items: ResponseItem[], previousSummary?: string): string {
  const callNames = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'function_call') callNames.set(item.call_id, item.name);
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  if (previousSummary) lines.push(`【此前摘要】${previousSummary}`, '');
  for (const item of items) {
    if (item.type === 'message') {
      const text = item.content.map((part) => part.text).join('\n').trim();
      if (text) lines.push(`[${item.role}] ${text}`);
    } else if (item.type === 'function_call_output') {
      const digest = digestText(item.output);
      if (seen.has(digest)) continue;
      seen.add(digest);
      const firstLine = (item.output.split('\n')[0] ?? '').slice(0, 200);
      lines.push(`[tool ${callNames.get(item.call_id) ?? 'unknown'}] ${firstLine} (digest ${digest.slice(0, 8)})`);
    }
  }
  return lines.join('\n');
}
