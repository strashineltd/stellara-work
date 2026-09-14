# 上下文压缩与 checkpoint 恢复（子项目 A）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让长会话在接近上下文硬阈值时自动在迭代边界压缩（确定性剪枝 + 结构化 checkpoint + 可选 LLM 摘要），并用事件溯源前缀指针在重启后恢复活跃窗口。

**Architecture:** 新增通道无关的 `token-estimator` 与 `compactor`；`ContextHub` 承担预算检查、压缩编排、事件指针与恢复；Responses loop 在每轮请求前调用 `ensureContextBudget()` 并发出 `summary` 流事件；工具结果入库前按上限 stub。Anthropic 通道本计划不动。

**Tech Stack:** Electron + TypeScript、vitest、tiktoken（已在依赖）、better-sqlite3（现有）、React 渲染层。

**Spec:** `docs/superpowers/specs/2026-09-14-context-compaction-design.md`

## Global Constraints

- 不新增任何依赖；`tiktoken` 已在 `package.json`。
- 阈值常量必须与 spec 一致：`usableInputBudget = contextWindow − maxOutputTokens − 2000 − 2000`；软 75%；硬 90%；保留目标 `usableInputBudget × 0.6`；工具结果入库上限 16000 tokens；摘要 ≤ 800 字。
- 活跃 items 一经持久化不得改写（digest 校验依赖这一点）。
- 不改 `electron/agent/anthropic-loop.ts` 的行为。
- 测试用 `npx vitest run <file>`；每个任务结束跑 `npm run typecheck`；最后跑 `npm test` 全量。
- 提交信息用仓库现有中文 scoped 风格（如 `feat(context): ...`），每个任务一次提交。
- 不改 `shared/ipc.ts` 中既有字段语义；新增字段只加在末尾或新接口里。

## 文件结构

- Create: `electron/context/token-estimator.ts` — 纯 token 估算（tiktoken + 字符回退）
- Create: `electron/context/compactor.ts` — 事务组件、切点、stub、摘要转写、常量与摘要 prompt
- Modify: `electron/context/context-hub.ts` — 预算、压缩编排、指针、恢复、校准
- Modify: `electron/agent/responses-loop.ts` — 迭代边界压缩、summary 事件、instructions 注入、ingest cap、校准上报
- Modify: `electron/chat/stream-registry.ts` — 流按会话登记（手动压缩的 busy 判定）
- Modify: `electron/main.ts` — `context:compact` IPC、配置透传
- Modify: `electron/preload.ts`、`shared/ipc.ts` — IPC 契约与设置字段
- Modify: `electron/config/config-v2.ts` — 设置白名单
- Modify: `src/components/WorkspacePanel.tsx`、`src/components/MainView.tsx`、`src/components/settings/SettingsAppPanel.tsx`、`src/dev-preview.ts` — UI
- Delete: `electron/agent/compress.ts`、`electron/agent/compress.test.ts`
- Tests: 对应 `*.test.ts`（每个新模块一个；扩展 hub / loop / registry 测试）

---

### Task 1: token 估算模块

**Files:**
- Create: `electron/context/token-estimator.ts`
- Test: `electron/context/token-estimator.test.ts`

**Interfaces:**
- Consumes: `ResponseItem`（`shared/responses.ts`）
- Produces:
  - `estimateTextTokens(text: string): number`
  - `estimateItemsTokens(items: ResponseItem[]): number`
  - `estimateRequestTokens(input: { items: ResponseItem[]; instructions?: string; tools?: unknown[] }): number`
  - `charFallbackTokens(text: string): number`
  - `_resetEncoderForTest(): void`

- [ ] **Step 1: 写失败测试**

```ts
// electron/context/token-estimator.test.ts
import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateItemsTokens,
  estimateRequestTokens,
  charFallbackTokens,
} from './token-estimator';
import type { ResponseItem } from '../../shared/responses';

function userMessage(text: string): ResponseItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}

describe('token-estimator', () => {
  it('空文本返回 0', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('中文估算显著高于字符数/4（修正现有低估）', () => {
    const text = '你好世界，这是一段用于测试的中文内容。'.repeat(10);
    expect(estimateTextTokens(text)).toBeGreaterThan(charFallbackTokens(text));
  });

  it('items 合计不小于逐条文本之和', () => {
    const items = [userMessage('hello'), userMessage('world')];
    expect(estimateItemsTokens(items)).toBeGreaterThanOrEqual(
      estimateTextTokens('hello') + estimateTextTokens('world'),
    );
  });

  it('estimateRequestTokens 覆盖 instructions 与 tools', () => {
    const base = estimateRequestTokens({ items: [] });
    const withAll = estimateRequestTokens({
      items: [userMessage('hello')],
      instructions: '你是助手',
      tools: [{ type: 'function', name: 'read_file', description: '读取文件', parameters: { type: 'object' } }],
    });
    expect(withAll).toBeGreaterThan(base + 5);
  });

  it('charFallbackTokens 向上取整', () => {
    expect(charFallbackTokens('abcde')).toBe(2);
    expect(charFallbackTokens('')).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/context/token-estimator.test.ts`
Expected: FAIL，报 `Cannot find module './token-estimator'`。

- [ ] **Step 3: 实现**

```ts
// electron/context/token-estimator.ts
import { encoding_for_model, type Tiktoken } from 'tiktoken';
import type { ResponseItem } from '../../shared/responses';

let encoder: Tiktoken | null | undefined;

function getEncoder(): Tiktoken | null {
  if (encoder !== undefined) return encoder;
  try {
    encoder = encoding_for_model('gpt-4');
  } catch (err) {
    console.warn('[token-estimator] tiktoken 加载失败，回退字符估算:', err);
    encoder = null;
  }
  return encoder;
}

export function charFallbackTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const enc = getEncoder();
  if (!enc) return charFallbackTokens(text);
  try {
    return enc.encode(text).length;
  } catch {
    return charFallbackTokens(text);
  }
}

export function estimateItemsTokens(items: ResponseItem[]): number {
  let total = 0;
  for (const item of items) {
    total += estimateTextTokens(JSON.stringify(item)) + 4;
  }
  return total;
}

export function estimateRequestTokens(input: {
  items: ResponseItem[];
  instructions?: string;
  tools?: unknown[];
}): number {
  let total = estimateItemsTokens(input.items) + 2;
  if (input.instructions) total += estimateTextTokens(input.instructions) + 4;
  if (input.tools && input.tools.length > 0) total += estimateTextTokens(JSON.stringify(input.tools)) + 4;
  return total;
}

/** 测试 hook：重置编码器缓存 */
export function _resetEncoderForTest(): void {
  encoder = undefined;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/context/token-estimator.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck`
Expected: 无错误。

```bash
git add electron/context/token-estimator.ts electron/context/token-estimator.test.ts
git commit -m "feat(context): 新增基于 tiktoken 的 token 估算模块"
```

### Task 2: 压缩器核心（事务组件 + 切点 + 累计指针 + digest）

**Files:**
- Create: `electron/context/compactor.ts`
- Test: `electron/context/compactor.test.ts`

**Interfaces:**
- Consumes: `estimateItemsTokens`（Task 1）、`ResponseItem`
- Produces:
  - `interface CompactOptions { targetTokens: number; hardLimitTokens: number; previousWindowStartIndex: number; reason: 'soft_threshold' | 'hard_threshold' | 'manual' }`
  - `interface CompactResult { ok: boolean; keptItems: ResponseItem[]; droppedCount: number; windowStartIndex: number; windowDigest?: string; tokensBefore: number; tokensAfter: number; reason: CompactOptions['reason'] }`
  - `compact(items: ResponseItem[], opts: CompactOptions): CompactResult`
  - `transactionComponents(items: ResponseItem[]): Array<{ start: number; end: number }>`
  - `adjustCutForTransactions(items: ResponseItem[], candidate: number): number`
  - `stableJSON(value: unknown): string`、`digestText(text: string): string`、`digestItem(item: ResponseItem): string`

**关键不变量（测试必须覆盖）：** 切点不得落在任一 `function_call`/`function_call_output` 事务区间内部；交错调用（`call1, call2, out1, out2`）时该轮只能整体保留或整体丢弃；窗口至少保留最后一个事务组件。

- [ ] **Step 1: 写失败测试**

```ts
// electron/context/compactor.test.ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/context/compactor.test.ts`
Expected: FAIL，`Cannot find module './compactor'`。

- [ ] **Step 3: 实现**

```ts
// electron/context/compactor.ts
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
  if (cut >= items.length && components.length > 0) {
    cut = components[components.length - 1]!.start;
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/context/compactor.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add electron/context/compactor.ts electron/context/compactor.test.ts
git commit -m "feat(context): 压缩器核心（事务切点、累计指针、digest）"
```

### Task 3: 工具结果入库上限与摘要转写

**Files:**
- Modify: `electron/context/compactor.ts`
- Test: `electron/context/compactor.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1/2 的估算与 digest 函数
- Produces:
  - `capToolOutput(toolName: string, args: unknown, result: unknown, maxTokens?: number): unknown`
  - `buildSummaryTranscript(items: ResponseItem[], previousSummary?: string): string`
  - `const COMPACTION_SUMMARY_PROMPT: string`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 electron/context/compactor.test.ts
import { capToolOutput, buildSummaryTranscript } from './compactor';

describe('capToolOutput', () => {
  it('未超限时原样返回', () => {
    const result = { ok: true, output: 'small' };
    expect(capToolOutput('read_file', { path: 'a.txt' }, result)).toBe(result);
  });

  it('read_file 超限时保留路径与 digest', () => {
    const result = { ok: true, output: 'x'.repeat(200_000) };
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/context/compactor.test.ts`
Expected: FAIL，`capToolOutput is not a function`。

- [ ] **Step 3: 实现（追加到 `compactor.ts`）**

先把顶部 import 改为 `import { estimateItemsTokens, estimateTextTokens } from './token-estimator';`，然后追加：

```ts
const INGEST_MAX_TOKENS = 16_000;

function splitLines(text: string): { head: string; tail: string } {
  const lines = text.split('\n');
  return { head: lines.slice(0, 20).join('\n'), tail: lines.slice(-20).join('\n') };
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
  const serialized = JSON.stringify(result ?? null);
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
    const parts = splitLines(stdout);
    return {
      ok: record.ok ?? true,
      output: '',
      truncation: {
        kind: 'command',
        command: record.meta?.command,
        exitCode: record.meta?.exitCode,
        head: parts.head,
        tail: parts.tail,
        stderrTail: splitLines(stderr).tail,
        digest,
        bytes: serialized.length,
        note: '命令输出过大已截断',
      },
    };
  }

  const parts = splitLines(record.output ?? serialized);
  return {
    ok: record.ok ?? true,
    output: '',
    truncation: {
      kind: 'generic',
      tool: toolName,
      head: parts.head,
      tail: parts.tail,
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/context/compactor.test.ts`
Expected: PASS（13 tests）。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add electron/context/compactor.ts electron/context/compactor.test.ts
git commit -m "feat(context): 工具结果入库上限与摘要转写"
```

### Task 4: ContextHub 压缩编排、指针与恢复

**Files:**
- Modify: `electron/context/context-hub.ts`
- Test: `electron/context/context-hub.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1–3 的 `estimateItemsTokens`、`compact`、`buildSummaryTranscript`、`digestItem`
- Produces（后续任务依赖）:
  - `ContextHub.ensureContextBudget(opts: { extraTokens?: number; summarize?: (transcript: string) => Promise<string | undefined>; force?: boolean; signal?: AbortSignal }): Promise<EnsureBudgetResult>`
  - `ContextHub.recordReportedInputTokens(reported: number): void`
  - `ContextHub.getCompactionSummary(): string | undefined`
  - `EnsureBudgetResult { compacted: boolean; hardLimited: boolean; tokensBefore?: number; tokensAfter?: number; compressedCount?: number; summary?: string }`
  - `TaskContext` 新字段：`compactionWindowStartIndex: number`、`compactionWindowDigest?: string`、`compactionSummary?: string`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 electron/context/context-hub.test.ts
// 顶部 import 增加：getContextEventsBySession（来自 '../store/db'）
import { getContextEventsBySession } from '../store/db';

describe('上下文压缩与恢复', () => {
  function addItems(hub: ContextHub, count: number, size = 2000): void {
    for (let i = 0; i < count; i++) {
      hub.addResponseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `${i}:${'x'.repeat(size)}` }],
      });
    }
  }

  it('低于软阈值不压缩', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 100_000, 1_000);
    addItems(hub, 2);
    const result = await hub.ensureContextBudget({});
    expect(result.compacted).toBe(false);
  });

  it('达到软阈值压缩并落事件', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const result = await hub.ensureContextBudget({});
    expect(result.compacted).toBe(true);
    expect(result.tokensAfter!).toBeLessThan(result.tokensBefore!);
    expect(hub.getResponseItems().length).toBeLessThan(60);
    const events = getContextEventsBySession('sess-001').filter((e) => e.event === 'context_compacted');
    expect(events).toHaveLength(1);
  });

  it('重开 hub 按指针恢复活跃窗口', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    await hub.ensureContextBudget({});
    const activeCount = hub.getResponseItems().length;

    const reopened = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    expect(reopened.getResponseItems()).toHaveLength(activeCount);
    expect(reopened.getContext().compactionWindowStartIndex).toBeGreaterThan(0);
  });

  it('digest 不匹配时忽略指针', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    await hub.ensureContextBudget({});
    await hub.commitEvent('context_compacted', {
      windowStartIndex: 5,
      droppedCount: 5,
      windowDigest: 'deadbeef',
      checkpointId: 'missing',
      tokensBefore: 0,
      tokensAfter: 0,
      compressedCount: 5,
      reason: 'soft_threshold',
    });
    const reopened = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    expect(reopened.getResponseItems()).toHaveLength(60);
  });

  it('摘要成功写入、失败不阻塞压缩', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const ok = await hub.ensureContextBudget({ summarize: async () => '这是一段摘要' });
    expect(ok.summary).toBe('这是一段摘要');
    expect(hub.getCompactionSummary()).toBe('这是一段摘要');

    addItems(hub, 60);
    const failed = await hub.ensureContextBudget({
      summarize: async () => {
        throw new Error('boom');
      },
    });
    expect(failed.compacted).toBe(true);
    expect(failed.summary).toBeUndefined();
    expect(hub.getCompactionSummary()).toBe('这是一段摘要');
  });

  it('recordReportedInputTokens 校准系数并 clamp', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 100_000, 1_000);
    addItems(hub, 1);
    await hub.ensureContextBudget({});
    const before = hub.getContext().usage.currentInputTokens;
    hub.recordReportedInputTokens(before * 10);
    const after = hub.getContext().usage.currentInputTokens;
    expect(after / before).toBeGreaterThan(1);
    expect(after / before).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/context/context-hub.test.ts`
Expected: FAIL，`hub.ensureContextBudget is not a function`。

- [ ] **Step 3: 实现（`context-hub.ts` 按序修改）**

3a. 顶部 import 增加：

```ts
import { compact, buildSummaryTranscript, digestItem } from './compactor';
import { estimateItemsTokens } from './token-estimator';
```

3b. `TaskContext` 增加字段（放在 `usage` 之前）：

```ts
  compactionWindowStartIndex: number;
  compactionWindowDigest?: string;
  compactionSummary?: string;
```

3c. `EnsureBudgetResult` 接口（文件顶部类型区）：

```ts
export interface EnsureBudgetResult {
  compacted: boolean;
  hardLimited: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
}
```

3d. 类字段（与 `responseItemSequence` 同区）：

```ts
  private extraTokens = 0;
  private calibrationRatio = 1;
  private lastEstimatedTokens = 0;
```

3e. `initializeContext()` 返回值增加：`compactionWindowStartIndex: 0,`。

3f. 构造函数中 `restoreResponseItems();` 之后加 `this.applyCompactionPointer();`。

3g. `calculateUsage()` 替换估算部分（预算公式不变）：

```ts
    const itemsTokens = this.context?.responseItems
      ? estimateItemsTokens(this.context.responseItems)
      : 0;
    const currentInputTokens = Math.round(itemsTokens * this.calibrationRatio) + this.extraTokens;
    this.lastEstimatedTokens = currentInputTokens;
```

3h. `handleContextCompacted()` 替换为：

```ts
  private handleContextCompacted(event: ContextEventEnvelope): void {
    const data = event.data as { windowStartIndex?: number; windowDigest?: string; summary?: string };
    if (typeof data.windowStartIndex === 'number') {
      this.context.compactionWindowStartIndex = data.windowStartIndex;
    }
    this.context.compactionWindowDigest = data.windowDigest;
    if (data.summary) this.context.compactionSummary = data.summary;
    this.context.usage.lastCompactedAt = event.createdAt;
  }
```

3i. 新增私有方法 `applyCompactionPointer()`：

```ts
  private applyCompactionPointer(): void {
    const start = this.context.compactionWindowStartIndex;
    if (start <= 0) return;
    const items = this.context.responseItems;
    if (start > items.length) {
      log.warn(`Context Hub: 压缩指针越界 (${start} > ${items.length})，忽略`);
      this.context.compactionWindowStartIndex = 0;
      this.context.compactionWindowDigest = undefined;
      return;
    }
    if (start < items.length && this.context.compactionWindowDigest) {
      if (digestItem(items[start]!) !== this.context.compactionWindowDigest) {
        log.warn('Context Hub: 压缩指针 digest 不匹配，忽略并保持全量窗口');
        this.context.compactionWindowStartIndex = 0;
        this.context.compactionWindowDigest = undefined;
        return;
      }
    }
    this.context.responseItems = items.slice(start);
    this.context.usage = this.calculateUsage();
  }
```

3j. `restoreResponseItems()` 中 sequence 改为最大值：

```ts
    this.responseItemSequence = rows.reduce((max, row) => Math.max(max, row.sequence), 0);
```

3k. 新增公共方法（建议放在 `isNearLimit()` 之后）：

```ts
  async ensureContextBudget(opts: {
    extraTokens?: number;
    summarize?: (transcript: string) => Promise<string | undefined>;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<EnsureBudgetResult> {
    if (typeof opts.extraTokens === 'number') this.extraTokens = opts.extraTokens;
    this.context.usage = this.calculateUsage();
    if (!opts.force && !this.context.usage.nearLimit) {
      return { compacted: false, hardLimited: this.context.usage.hardLimited };
    }

    const usage = this.context.usage;
    const checkpoint = this.createCheckpoint();
    const activeItems = [...this.context.responseItems];
    const result = compact(activeItems, {
      targetTokens: Math.floor(usage.usableInputBudget * 0.6),
      hardLimitTokens: usage.hardThreshold,
      previousWindowStartIndex: this.context.compactionWindowStartIndex,
      reason: opts.force ? 'manual' : usage.hardLimited ? 'hard_threshold' : 'soft_threshold',
    });
    if (!result.ok) {
      this.context.usage = this.calculateUsage();
      return { compacted: false, hardLimited: this.context.usage.hardLimited };
    }

    let summary: string | undefined;
    if (opts.summarize) {
      try {
        const transcript = buildSummaryTranscript(
          activeItems.slice(0, result.droppedCount),
          this.context.compactionSummary,
        );
        const text = await opts.summarize(transcript);
        if (text && text.trim()) summary = text.trim();
      } catch (err) {
        log.warn('上下文压缩摘要失败，保留确定性压缩结果:', err);
      }
    }

    this.context.responseItems = result.keptItems;
    await this.commitEvent('context_compacted', {
      windowStartIndex: result.windowStartIndex,
      droppedCount: result.droppedCount,
      windowDigest: result.windowDigest,
      checkpointId: checkpoint.id,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      compressedCount: result.droppedCount,
      summary,
      reason: result.reason,
    });
    return {
      compacted: true,
      hardLimited: this.context.usage.hardLimited,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      compressedCount: result.droppedCount,
      summary,
    };
  }

  recordReportedInputTokens(reported: number): void {
    if (!Number.isFinite(reported) || reported <= 0) return;
    const estimated = this.lastEstimatedTokens > 0 ? this.lastEstimatedTokens : this.calculateUsage().currentInputTokens;
    if (estimated <= 0) return;
    const sample = reported / estimated;
    if (!Number.isFinite(sample) || sample <= 0) return;
    const next = this.calibrationRatio * 0.7 + sample * 0.3;
    this.calibrationRatio = Math.min(2, Math.max(0.5, next));
    this.context.usage = this.calculateUsage();
  }

  getCompactionSummary(): string | undefined {
    return this.context.compactionSummary;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/context/context-hub.test.ts`
Expected: PASS（原有 + 新增 6 tests）。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add electron/context/context-hub.ts electron/context/context-hub.test.ts
git commit -m "feat(context): ContextHub 压缩编排、指针恢复与用量校准"
```

### Task 5: Responses Loop 接线

**Files:**
- Modify: `electron/agent/responses-loop.ts`
- Test: `electron/agent/responses-loop.test.ts`（追加 describe）

**Interfaces:**
- Consumes: `ContextHub.ensureContextBudget`（Task 4）、`capToolOutput` / `COMPACTION_SUMMARY_PROMPT`（Task 3）、`estimateRequestTokens`（Task 1）、`summarizeWithModel`（`electron/llm/client-factory.ts:21`）
- Produces: `ResponsesLoopOptions.compactionSummaryEnabled?: boolean`；`summary` 流事件（`ChatStreamEvent` 既有字段）；`context_too_long` 错误语义

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 electron/agent/responses-loop.test.ts（新 describe 内自带 toolCallStream，避免依赖其他 describe 的局部函数）
describe('上下文压缩接线', () => {
  function toolCallStream(name: string, args: string): Array<Record<string, unknown>> {
    return [
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'function_call', id: 'fc-1', call_id: 'fc-1', name, arguments: args, status: 'in_progress' },
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-001',
          object: 'response',
          model: 'test',
          status: 'completed',
          output: [{ type: 'function_call', id: 'fc-1', call_id: 'fc-1', name, arguments: args, status: 'completed' }],
        },
      },
    ];
  }

  it('压缩后发出 summary 事件并可继续', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const budgetSpy = vi.spyOn(hub, 'ensureContextBudget').mockResolvedValue({
      compacted: true,
      hardLimited: false,
      tokensBefore: 900,
      tokensAfter: 300,
      compressedCount: 5,
      summary: '早前对话摘要',
    });
    const events: Array<{ type: string; summary?: string; compressedCount?: number }> = [];

    for await (const event of runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    })) {
      events.push(event);
    }

    expect(budgetSpy).toHaveBeenCalled();
    expect(events.find((e) => e.type === 'summary')).toMatchObject({
      compressedCount: 5,
      summary: '早前对话摘要',
    });
    expect(events.map((e) => e.type)).toContain('done');
  });

  it('压缩后仍超硬阈值 → 明确错误并终止', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    vi.spyOn(hub, 'ensureContextBudget').mockResolvedValue({ compacted: false, hardLimited: true });
    const events: string[] = [];

    for await (const event of runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    })) {
      events.push(event.type);
    }

    expect(events).toContain('error');
    expect(events).not.toContain('done');
  });

  it('开启摘要开关时传入 summarize 回调', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const spy = vi.spyOn(hub, 'ensureContextBudget').mockResolvedValue({ compacted: false, hardLimited: false });

    for await (const _event of runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
      compactionSummaryEnabled: true,
    })) {
    }

    expect(typeof spy.mock.calls[0]![0]!.summarize).toBe('function');
  });

  it('工具结果超限时以 stub 进入上下文', async () => {
    const marker = 'UNIQUE-MARKER-20000';
    const content = Array.from({ length: 30_000 }, (_, i) => (i === 20_000 ? marker : `line ${i}`)).join('\n');
    await fs.writeFile(path.join(tmpDir, 'big.txt'), content);
    streamQueue.push(() => toolCallStream('read_file', '{"path":"big.txt"}'));

    const hub = new ContextHub('sess-001', tmpDir);
    for await (const _event of runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    })) {
    }

    const outputs = hub.getResponseItems().filter((item) => item.type === 'function_call_output');
    expect(JSON.stringify(outputs)).toContain('"truncation"');
    expect(JSON.stringify(outputs)).not.toContain(marker);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/agent/responses-loop.test.ts`
Expected: FAIL（`summary` 事件缺失、硬阈值错误文案不匹配、无 `truncation`）。

- [ ] **Step 3: 实现（`responses-loop.ts`）**

3a. 顶部 import 增加：

```ts
import { capToolOutput, COMPACTION_SUMMARY_PROMPT } from '../context/compactor';
import { estimateRequestTokens } from '../context/token-estimator';
import { summarizeWithModel } from '../llm/client-factory';
```

3b. `ResponsesLoopOptions` 增加：

```ts
  /** 压缩时是否调用 LLM 生成对话摘要（默认 false；主会话由配置传 true） */
  compactionSummaryEnabled?: boolean;
```

3c. 把现有「检查硬阈值」块（`if (contextHub.isHardLimited()) { ... return; }`）与之后的请求构建开头替换为：

```ts
    // 上下文预算检查：达到软阈值时在迭代边界同步压缩
    const context = contextHub.getContext();
    let instructions = buildInstructions(systemPrompt, context);
    const budget = await contextHub.ensureContextBudget({
      extraTokens: estimateRequestTokens({ instructions, tools }),
      signal,
      summarize:
        options.compactionSummaryEnabled === true
          ? (transcript) => summarizeWithModel(model, COMPACTION_SUMMARY_PROMPT, transcript, signal)
          : undefined,
    });
    if (budget.compacted) {
      yield {
        type: 'summary',
        tokensBefore: budget.tokensBefore,
        tokensAfter: budget.tokensAfter,
        compressedCount: budget.compressedCount,
        summary: budget.summary,
      };
      instructions = buildInstructions(systemPrompt, contextHub.getContext());
    }
    if (budget.hardLimited) {
      yield {
        type: 'error',
        error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
        errorMeta: {
          kind: 'context_too_long',
          hint: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
          retryable: false,
        },
      };
      return;
    }

    const inputItems = contextHub.getResponseItems();
```

3d. `result.usage` 分支加校准上报（在累计 token 之前）：

```ts
          if (result.usage) {
            contextHub.recordReportedInputTokens(result.usage.input_tokens);
            totalInputTokens += result.usage.input_tokens;
```

3e. 工具执行结果入库前套上限：

```ts
        const result = await invokeTool(fc.name as ToolName, args, cwd, toolContext);
        const cappedResult = capToolOutput(fc.name, args, result);

        toolResults.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify(cappedResult),
        });
```

3f. `buildInstructions()` 末尾（未验证文件之后）增加：

```ts
  // 注入压缩摘要（早期对话已移出活跃窗口）
  if (context.compactionSummary) {
    instructions += `\n\n## 早期对话摘要（已压缩）\n${context.compactionSummary}`;
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/agent/responses-loop.test.ts`
Expected: PASS（原有 + 新增 4 tests）。若有旧测试直接断言「上下文达到硬阈值」文案，按新语义更新为 `ensureContextBudget` 的 `hardLimited` 路径。

- [ ] **Step 5: typecheck + 提交**

Run: `npm run typecheck`

```bash
git add electron/agent/responses-loop.ts electron/agent/responses-loop.test.ts
git commit -m "feat(agent): Responses loop 接入上下文预算压缩与摘要事件"
```

### Task 6: 手动压缩入口（registry + IPC + preload + UI 按钮）

**Files:**
- Modify: `electron/chat/stream-registry.ts`
- Modify: `electron/chat/stream-registry.test.ts`
- Modify: `electron/main.ts`（两处 `start(streamId)` + `context:compact` handler）
- Modify: `shared/ipc.ts`（`ContextCompactResult` + `ElectronAPI.context.compact`）
- Modify: `electron/preload.ts`、`src/dev-preview.ts`
- Modify: `src/components/WorkspacePanel.tsx`、`src/components/MainView.tsx`

**Interfaces:**
- Consumes: `ContextHub.ensureContextBudget`、`contextStateView`、`openPersistedContextHub`（main.ts）
- Produces:
  - `ChatStreamRegistry.start(streamId: string, sessionId?: string): AbortController`
  - `ChatStreamRegistry.isSessionActive(sessionId: string): boolean`
  - `interface ContextCompactResult { ok: boolean; busy?: boolean; compacted?: boolean; snapshot?: ContextStateView }`
  - `window.electronAPI.context.compact(sessionId: string): Promise<ContextCompactResult>`
  - `WorkspacePanelProps.onCompact?: () => Promise<{ ok: boolean; busy?: boolean }>`

- [ ] **Step 1: registry 失败测试**

```ts
// 追加到 electron/chat/stream-registry.test.ts
it('isSessionActive 按会话匹配并在 cleanup 后失效', () => {
  const registry = new ChatStreamRegistry();
  registry.start('a', 'sess-1');
  registry.start('b', 'sess-2');
  expect(registry.isSessionActive('sess-1')).toBe(true);
  registry.cleanup('a');
  expect(registry.isSessionActive('sess-1')).toBe(false);
  expect(registry.isSessionActive('sess-2')).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/chat/stream-registry.test.ts`
Expected: FAIL，`isSessionActive is not a function`。

- [ ] **Step 3: 实现 registry**

```ts
// stream-registry.ts：类字段区
  private readonly sessions = new Map<string, string>();

// start 替换为：
  start(streamId: string, sessionId?: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(streamId, controller);
    if (sessionId) this.sessions.set(streamId, sessionId);
    return controller;
  }

// 新增方法（getSignal 附近）：
  isSessionActive(sessionId: string): boolean {
    for (const sid of this.sessions.values()) {
      if (sid === sessionId) return true;
    }
    return false;
  }

// cleanup 中增加一行：
    this.sessions.delete(streamId);
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/chat/stream-registry.test.ts`
Expected: PASS。

- [ ] **Step 5: IPC 契约与主进程**

```ts
// shared/ipc.ts：ContextStateView 之后新增
export interface ContextCompactResult {
  ok: boolean;
  /** true = 该会话有运行中的任务，已拒绝手动压缩 */
  busy?: boolean;
  compacted?: boolean;
  snapshot?: ContextStateView;
}

// shared/ipc.ts：ElectronAPI.context 增加（与 createCheckpoint 并列）
    compact: (sessionId: string) => Promise<ContextCompactResult>;
```

```ts
// electron/preload.ts：context 段增加
    compact: (sessionId: string) => ipcRenderer.invoke('context:compact', sessionId),
```

```ts
// electron/main.ts：两处 chatStreams.start(streamId) 改为
  const ctrl = chatStreams.start(streamId, request.sessionId);
```

```ts
// electron/main.ts：context:createCheckpoint handler 之后新增（顶部需 import type { ContextCompactResult }）
  handle('context:compact', async (_e, sessionId: string): Promise<ContextCompactResult> => {
    if (!sessionId) throw new Error('缺少会话 ID');
    if (chatStreams.isSessionActive(sessionId)) {
      return { ok: false, busy: true };
    }
    const [{ loadConfig }, { getSession }, { summarizeWithModel }, { COMPACTION_SUMMARY_PROMPT }] = await Promise.all([
      import('./config/config-v2'),
      import('./store/db'),
      import('./llm/client-factory'),
      import('./context/compactor'),
    ]);
    const config = await loadConfig();
    const session = getSession(sessionId);
    const model = config.models.find((item) => item.id === session?.modelId);
    const hub = await openPersistedContextHub(sessionId);
    try {
      const summaryEnabled = config.app.contextCompactionSummaryEnabled !== false && model != null;
      const result = await hub.ensureContextBudget({
        force: true,
        summarize: summaryEnabled
          ? (transcript) => summarizeWithModel(model, COMPACTION_SUMMARY_PROMPT, transcript)
          : undefined,
      });
      return { ok: true, busy: false, compacted: result.compacted, snapshot: contextStateView(hub) };
    } finally {
      hub.dispose();
    }
  });
```

```ts
// src/dev-preview.ts：context 段增加
      compact: async (sessionId: string) => ({
        ok: true,
        busy: false,
        compacted: true,
        snapshot: previewContextState(sessionId),
      }),
```

- [ ] **Step 6: UI**

```tsx
// WorkspacePanel.tsx：WorkspacePanelProps 增加
  onCompact?: () => Promise<{ ok: boolean; busy?: boolean }>;

// 解构 props 处与 ContextCheckpointSection 调用处透传 onCompact
// ContextCheckpointSection props 增加 onCompact 并渲染按钮：

function ContextCheckpointSection({
  checkpoint,
  unverifiedFiles,
  staleEvidence,
  taskGate,
  onCreateCheckpoint,
  onCompact,
}: {
  checkpoint?: { id: string; objective: string; createdAt: string } | null;
  unverifiedFiles?: string[];
  staleEvidence?: Array<{ id: string; summary: string }>;
  taskGate?: { ok: boolean; reasons: string[] };
  onCreateCheckpoint?: () => Promise<void>;
  onCompact?: () => Promise<{ ok: boolean; busy?: boolean }>;
}) {
  const [creating, setCreating] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactNotice, setCompactNotice] = useState<string | null>(null);
  // ...现有 JSX 不变，在 onCreateCheckpoint 按钮之后追加：
  {onCompact && (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-small checkpoint-create"
        disabled={compacting}
        onClick={() => {
          setCompacting(true);
          setCompactNotice(null);
          void onCompact()
            .then((res) => {
              if (res.ok) setCompactNotice('已压缩');
              else if (res.busy) setCompactNotice('任务运行中，将在下一轮自动压缩');
            })
            .catch(() => setCompactNotice('压缩失败'))
            .finally(() => setCompacting(false));
        }}
      >
        {compacting ? '正在压缩…' : '立即压缩'}
      </button>
      {compactNotice && <div className="empty-hint">{compactNotice}</div>}
    </>
  )}
```

```tsx
// MainView.tsx：WorkspacePanel 的 onCreateCheckpoint 之后增加
            onCompact={activeSessionId ? async () => {
              const result = await window.electronAPI.context.compact(activeSessionId);
              if (result.ok && result.snapshot) setContextState(result.snapshot);
              return { ok: result.ok, busy: result.busy };
            } : undefined}
```

- [ ] **Step 7: typecheck + 测试 + 提交**

Run: `npm run typecheck && npx vitest run electron/chat/stream-registry.test.ts`
Expected: 均通过。

```bash
git add electron/chat/stream-registry.ts electron/chat/stream-registry.test.ts electron/main.ts shared/ipc.ts electron/preload.ts src/dev-preview.ts src/components/WorkspacePanel.tsx src/components/MainView.tsx
git commit -m "feat(context): 手动立即压缩入口（IPC/预载/工作区面板）"
```

### Task 7: 压缩摘要设置开关

**Files:**
- Modify: `shared/ipc.ts`（`AppSettings`）
- Modify: `electron/config/config-v2.ts`（白名单）
- Modify: `electron/config/config-v2.test.ts`
- Modify: `src/components/settings/SettingsAppPanel.tsx`
- Modify: `electron/main.ts`（`runResponsesLoopForIpc` 透传）

**Interfaces:**
- Produces: `AppSettings.contextCompactionSummaryEnabled?: boolean`（默认 undefined = 开）；`ResponsesLoopOptions.compactionSummaryEnabled` 由主会话按设置传入，子代理不传（默认关）

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 electron/config/config-v2.test.ts 的 sanitizeSettingsPatch describe 内
it('允许 contextCompactionSummaryEnabled', () => {
  const { patch, rejected } = sanitizeSettingsPatch({ contextCompactionSummaryEnabled: false } as Partial<AppSettings>);
  expect(patch.contextCompactionSummaryEnabled).toBe(false);
  expect(rejected).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run electron/config/config-v2.test.ts`
Expected: FAIL，`rejected` 包含 `contextCompactionSummaryEnabled`。

- [ ] **Step 3: 实现**

```ts
// shared/ipc.ts：AppSettings 中 workspaceMode 之后
  /** 上下文压缩时是否调用模型生成对话摘要（默认开；false = 仅确定性剪枝） */
  contextCompactionSummaryEnabled?: boolean;
```

```ts
// electron/config/config-v2.ts
const SETTINGS_PATCH_WHITELIST: readonly string[] = [
  'shortcuts',
  'theme',
  'workspaceMode',
  'browser',
  'contextCompactionSummaryEnabled',
];
```

```ts
// electron/main.ts：runResponsesLoopForIpc 内，const cwd = model.workDir!; 之后
    const { loadConfig } = await import('./config/config-v2');
    const appConfig = await loadConfig();
```

```ts
// electron/main.ts：runResponsesLoop(userContent, { ... }) 选项对象内（memoryProjectId 附近）增加
      compactionSummaryEnabled: appConfig.app.contextCompactionSummaryEnabled !== false,
```

```tsx
// SettingsAppPanel.tsx：applyWorkspaceMode 之后增加
  function applyCompactionSummary(enabled: boolean) {
    setSettings((s) => ({ ...s, contextCompactionSummaryEnabled: enabled }));
    void window.electronAPI.settings.update({ contextCompactionSummaryEnabled: enabled });
    onChanged?.();
  }

// 组件内取值
  const compactionSummaryEnabled = settings.contextCompactionSummaryEnabled !== false;

// 「界面」settings-group 内、工作区模式之后增加同样的 settings-item：
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">压缩对话摘要</div>
              <div className="settings-item__hint">上下文压缩时调用一次模型生成摘要（默认开）</div>
            </div>
            <div className="radio-group">
              <button
                className={`radio-card ${compactionSummaryEnabled ? 'on' : ''}`}
                role="radio"
                aria-checked={compactionSummaryEnabled}
                aria-label="压缩对话摘要：开"
                onClick={() => applyCompactionSummary(true)}
                type="button"
              >
                开
              </button>
              <button
                className={`radio-card ${!compactionSummaryEnabled ? 'on' : ''}`}
                role="radio"
                aria-checked={!compactionSummaryEnabled}
                aria-label="压缩对话摘要：关"
                onClick={() => applyCompactionSummary(false)}
                type="button"
              >
                关
              </button>
            </div>
          </div>
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run electron/config/config-v2.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/ipc.ts electron/config/config-v2.ts electron/config/config-v2.test.ts src/components/settings/SettingsAppPanel.tsx electron/main.ts
git commit -m "feat(settings): 压缩摘要开关与主会话透传"
```

---

### Task 8: 清理死代码、集成测试、全量回归

**Files:**
- Delete: `electron/agent/compress.ts`、`electron/agent/compress.test.ts`
- Create: `electron/context/compaction-integration.test.ts`
- Verify: 全仓库无 `compress` 生产引用

**Interfaces:**
- Consumes: Task 1–7 全部
- Produces: 长会话预算稳定性的端到端证明；`compress.ts` 退场

- [ ] **Step 1: 写集成测试**

```ts
// electron/context/compaction-integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ContextHub } from './context-hub';
import { estimateItemsTokens } from './token-estimator';
import { _setDbPath, getDb, createSession, initContextTables } from '../store/db';
import type { ResponseItem } from '../../shared/responses';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-compact-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initContextTables();
  createSession({ id: 'sess-001', title: 'Test', modelId: 'test' });
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('长会话压缩集成', () => {
  it('300 轮持续注入后活跃窗口有界且始终低于硬阈值', async () => {
    const hub = new ContextHub('sess-001', tmpDir, 40_000, 1_000);
    const hardLimit = hub.getContext().usage.hardThreshold;
    let compactionEvents = 0;

    for (let turn = 0; turn < 300; turn++) {
      const item: ResponseItem = {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `turn ${turn}: ${'x'.repeat(900)}` }],
      };
      hub.addResponseItem(item);
      const result = await hub.ensureContextBudget({});
      if (result.compacted) compactionEvents++;
      expect(estimateItemsTokens(hub.getResponseItems())).toBeLessThan(hardLimit);
    }

    expect(compactionEvents).toBeGreaterThan(0);
    expect(hub.getResponseItems().length).toBeLessThan(300);

    const reopened = new ContextHub('sess-001', tmpDir, 40_000, 1_000);
    expect(reopened.getResponseItems().length).toBe(hub.getResponseItems().length);
  });
});
```

- [ ] **Step 2: 运行确认通过（依赖 Task 4 已完成）**

Run: `npx vitest run electron/context/compaction-integration.test.ts`
Expected: PASS。

- [ ] **Step 3: 删除死代码并确认无引用**

```bash
git rm electron/agent/compress.ts electron/agent/compress.test.ts
grep -rn "agent/compress\|from './compress'" electron shared src | grep -v dist
```

Expected: `grep` 无输出（若有引用，改用 `token-estimator` / `compactor` 后重跑本步骤）。

- [ ] **Step 4: 全量回归**

Run: `npm test && npm run typecheck`
Expected: 全部通过；若 `compress.test.ts` 之外有旧测试依赖 `compress.ts`，随 Step 3 的 grep 一并修复。

- [ ] **Step 5: 提交**

```bash
git add electron/context/compaction-integration.test.ts
git commit -m "chore(context): 移除旧 compress 死代码并补长会话集成测试"
```

---

## 计划自审记录

- **Spec 覆盖**：§3 估算/预算 → Task 1/4；§4 压缩器（切点、ingest cap、摘要转写、迭代收缩）→ Task 2/3；§5 编排与事件 → Task 4；§6 恢复与 digest → Task 4（applyCompactionPointer）；§7 loop 接线 → Task 5；§8 UI/设置/IPC → Task 6/7；§9 测试 → 各任务 + Task 8；§12 验收 → Task 8 集成 + 各任务断言。
- **接口一致性**：`CompactResult` / `EnsureBudgetResult` / `ContextCompactResult` 命名与字段在 Task 2/4/6 中一致；`capToolOutput(name, args, result, maxTokens?)` 统一四参签名；`windowStartIndex` 一律为累计值。
- **已知偏差**：spec §4.2 的“保留窗口内改写”按计划阶段发现的一致性问题改为“仅 ingest cap、入库后不改写”（已同步更新 spec）；`CompactResult` 的 `summary` 由 Hub 层附加而非 compactor 返回。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码与运行命令。

