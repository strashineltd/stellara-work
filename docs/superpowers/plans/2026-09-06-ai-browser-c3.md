# AI Browser C3 Implementation Plan (浏览记忆：会话末并入提取 + web kind)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed browsing material (web_search + browser_* tool outputs) into the session-end memory extraction, with a new `web` memory kind.

**Architecture:** `chat-utils.entriesToMessages` starts persisting `ok` into the tool row's `meta` JSON so success/failure is knowable. A pure `buildBrowserMaterial(messages)` filters tool rows by name + success and truncates to 30k. `memory-extractor.extractMemories` gains an optional `browserMaterial` appended to the transcript, and the extraction prompt + valid-kind list accept `web`. `main.ts`'s session-end hook passes the material; MemoryCenter's kind filter gains `网页`.

**Tech Stack:** Electron 43, TypeScript, React 19, Vitest + jsdom, existing memory-store/memory-extractor/chat-utils patterns.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-browser-c3-design.md`

## Global Constraints

- No new dependencies; no new IPC channels.
- `buildBrowserMaterial` filters `role === 'tool'` with `toolName === 'web_search'` or `toolName.startsWith('browser_')`; only successful results (meta `ok !== false`; rows without meta kept); prefix each line `[工具名] `; total ≤ 30_000 chars (keep head, append `…[已截断]`); empty → `''`.
- `browserMaterial` is appended to the transcript only when non-empty, with the exact separator `\n\n--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---\n`.
- Extraction prompt: kind list gains `"web"`; new extract rule for web facts from browsing material; new rule: web entries must come from the material, never invented from conversation.
- No browsing material is injected into Agent context (extraction only).
- TDD: failing test first, RED, minimal implementation, GREEN; `npm test -- <file>` + `npm run typecheck` per task.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Modify `src/lib/chat-utils.ts`: `entriesToMessages` tool_result rows persist `ok` inside `meta` JSON.
- Modify `src/lib/chat-utils.test.ts`: meta round-trip includes ok.
- Modify `electron/memory/memory-extractor.ts`: `buildBrowserMaterial(messages: MessageRow[]): string` export + `extractMemories` gains `browserMaterial?: string` + prompt/kind updates.
- Modify `electron/memory/memory-extractor.test.ts` (create if missing — check first): buildBrowserMaterial matrix + browserMaterial append + web kind pass.
- Modify `shared/ipc.ts`: `Memory['kind']` gains `'web'`.
- Modify `electron/memory/memory-store.test.ts` (or equivalent): kind='web' save/search/filter round-trip.
- Modify `electron/main.ts`: `extractMemoriesFromSession` passes `buildBrowserMaterial(messages)`.
- Modify `src/components/memory/MemoryCenter.tsx`: `KIND_OPTIONS` gains `{ value: 'web', label: '网页' }`.
- Modify `src/components/memory/MemoryCenter.test.tsx` (or memory-components.test.tsx): filter option renders.
- Modify `CHANGELOG.md` (Task 5).

---

### Task 1: Persist Tool Result `ok` + buildBrowserMaterial

**Files:**
- Modify: `src/lib/chat-utils.ts:295-306`
- Modify: `src/lib/chat-utils.test.ts`
- Create: `electron/memory/memory-extractor.ts` additions (buildBrowserMaterial in Task 3 — no; see note)

**Interfaces:**
- Consumes: `MessageRow` shape (`role`, `content`, `toolName`, `meta` string).
- Produces: `ok` present in persisted tool-row `meta` JSON (consumed by Task 3's `buildBrowserMaterial`).

- [ ] **Step 1: Write the failing test for persisted ok**

Append to `src/lib/chat-utils.test.ts` (find the existing `entriesToMessages` describe and its display-entry factory):

```ts
it('persists ok inside tool_result meta JSON', () => {
  const entries: DisplayEntry[] = [
    { kind: 'tool_result', toolCallId: 'tc-1', name: 'web_search', ok: false, output: 'boom', error: 'network' },
  ];
  const rows = entriesToMessages(entries, 's');
  const row = rows.find((r) => r.role === 'tool')!;
  expect(row.toolName).toBe('web_search');
  const meta = JSON.parse(row.meta ?? '{}') as { ok?: boolean };
  expect(meta.ok).toBe(false);
});
```

Adjust the entry shape to the actual `DisplayEntry` union (check the file's existing factories). Expected RED: `meta.ok` is `undefined`.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/lib/chat-utils.test.ts`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Minimal implementation**

In `src/lib/chat-utils.ts` tool_result branch:

```ts
} else if (e.kind === 'tool_result') {
  const metaWithOk = e.meta ? JSON.stringify({ ...e.meta, ok: e.ok }) : JSON.stringify({ ok: e.ok });
  out.push({
    sessionId,
    position: pos++,
    role: 'tool',
    content: e.output,
    toolCallId: e.toolCallId,
    toolName: e.name,
    meta: metaWithOk,
    createdAt: now,
  });
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/lib/chat-utils.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 2: Memory kind 'web' (shared type + store round-trip)

**Files:**
- Modify: `shared/ipc.ts` (`Memory['kind']`)
- Test: `electron/memory/memory-store.test.ts` (check existing file name first — `memory-store.test.ts` or `memory.test.ts`; use whichever exists)

**Interfaces:**
- Consumes: existing `saveMemory`/`searchMemories`/`listMemories`.
- Produces: `Memory['kind']` includes `'web'` — consumed by Task 3's valid-kind list and Task 4's MemoryCenter options.

- [ ] **Step 1: Write the failing store test**

Append to the existing memory-store test file:

```ts
it('saves and searches memories with kind web', async () => {
  const m = saveMemory({
    scope: 'personal',
    kind: 'web',
    content: 'Electron 43 支持 WebContentsView（调研结论）',
    importance: 0.7,
    tags: ['electron'],
  });
  expect(m.kind).toBe('web');
  const byKind = listMemories({ kind: 'web' });
  expect(byKind.some((x) => x.id === m.id)).toBe(true);
  const found = searchMemories({ query: 'WebContentsView' });
  expect(found.some((x) => x.id === m.id)).toBe(true);
});
```

Use the file's existing setup (temp DB dir injection — check how the current tests initialize `setMemoryDb`; copy that pattern). Expected RED: TS error `'web' is not assignable to kind` (and/or runtime pass — type error is the gate; run `npx tsc` on the test file if the suite can't see it, like earlier tasks, and note it).

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/memory/<existing-test-file>` + `npm run typecheck`
Expected: FAIL (type-level, or runtime if saveMemory rejects).

- [ ] **Step 3: Minimal implementation**

In `shared/ipc.ts`:

```ts
export interface Memory {
  ...
  kind: 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting' | 'web';
  ...
}
```

No store schema change (kind is TEXT; FTS5 has no kind column).

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/memory/<existing-test-file>` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 3: memory-extractor — buildBrowserMaterial + browserMaterial + web prompt

**Files:**
- Modify: `electron/memory/memory-extractor.ts`
- Modify: `electron/memory/memory-extractor.test.ts` (EXISTS with a `vi.mock('./memory-store')` block at the top — append new describes, do NOT re-declare the mock)

**Interfaces:**
- Consumes: Task 1's persisted `ok` in meta; Task 2's `'web'` kind.
- Produces: `buildBrowserMaterial(messages: MessageRow[]): string` + `extractMemories(..., browserMaterial?: string)` consumed by Task 4's main.ts hook.

- [ ] **Step 1: Write failing tests (append to the existing file, inside the existing mock)**

Append these describes after the existing `saveManualMemory` describe (the file's existing `vi.mock('./memory-store')` covers `saveMemory`/`findDuplicateMemory`; the `extractMemories` append test relies on it):

```ts
import { describe, it, expect } from 'vitest';
import type { MessageRow } from '../../shared/ipc';
import { buildBrowserMaterial, extractMemories } from './memory-extractor';

function toolRow(partial: Partial<MessageRow>): MessageRow {
  return {
    sessionId: 's', position: 0, role: 'tool', content: '', createdAt: 0,
    ...partial,
  } as MessageRow;
}

describe('buildBrowserMaterial', () => {
  it('keeps web_search and browser_* rows with [工具名] prefix; skips other tools and failed results', () => {
    const rows: MessageRow[] = [
      toolRow({ toolName: 'web_search', content: '搜到 A', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_navigate', content: '已导航', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_snapshot', content: '页面正文', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'read_file', content: '不该出现', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_navigate', content: '失败', meta: JSON.stringify({ ok: false }) }),
    ];
    const out = buildBrowserMaterial(rows);
    expect(out).toContain('[web_search] 搜到 A');
    expect(out).toContain('[browser_navigate] 已导航');
    expect(out).toContain('[browser_snapshot] 页面正文');
    expect(out).not.toContain('不该出现');
    expect(out).not.toContain('失败');
  });

  it('keeps tool rows without meta', () => {
    const out = buildBrowserMaterial([toolRow({ toolName: 'browser_act', content: '已点击' })]);
    expect(out).toContain('[browser_act] 已点击');
  });

  it('truncates at 30000 chars with a marker', () => {
    const big = 'x'.repeat(40000);
    const out = buildBrowserMaterial([toolRow({ toolName: 'web_search', content: big })]);
    expect(out.length).toBeLessThanOrEqual(30000 + 6);
    expect(out).toContain('…[已截断]');
  });

  it('returns empty string for no browser rows', () => {
    expect(buildBrowserMaterial([])).toBe('');
    expect(buildBrowserMaterial([toolRow({ toolName: 'read_file', content: 'x' })])).toBe('');
  });
});

describe('extractMemories with browserMaterial', () => {
  it('appends the material block to the transcript and accepts kind web', async () => {
    let transcriptSent = '';
    const llmCall = vi.fn().mockImplementation(async (_sys: string, user: string) => {
      transcriptSent = user;
      return JSON.stringify([{ kind: 'web', content: '调研结论', importance: 0.6, tags: ['web'] }]);
    });
    const saved = await extractMemories(
      [{ role: 'user', content: '帮我调研 Electron' }],
      'personal', undefined, 'session:s1',
      llmCall,
      'material-line-1',
    );
    expect(transcriptSent).toContain('--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---');
    expect(transcriptSent).toContain('material-line-1');
    expect(saved.length).toBe(1);
    expect(saved[0]!.kind).toBe('web');
  });

  it('does not append the block when browserMaterial is empty', async () => {
    let transcriptSent = '';
    const llmCall = vi.fn().mockImplementation(async (_sys: string, user: string) => {
      transcriptSent = user;
      return '[]';
    });
    await extractMemories([{ role: 'user', content: 'hi' }], 'personal', undefined, 'session:s1', llmCall);
    expect(transcriptSent).not.toContain('网页浏览材料');
  });
});
```

Note: `extractMemories` calls `saveMemory` — the existing test file already mocks `./memory-store` (top of file), so the append test needs no extra mock. Do not add a second `vi.mock`.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/memory/memory-extractor.test.ts`
Expected: FAIL — `buildBrowserMaterial` missing, `extractMemories` signature has no 6th param.

- [ ] **Step 3: Minimal implementation**

In `electron/memory/memory-extractor.ts`:

1. Import `MessageRow` type: `import type { ChatMessage, Memory, MessageRow } from '../../shared/ipc';`

2. Add before `EXTRACTION_PROMPT`:

```ts
const BROWSER_TOOL_RE = /^(web_search|browser_)/;
const BROWSER_MATERIAL_MAX = 30_000;

/** 从消息历史构建浏览材料：仅成功的 web_search/browser_* 工具结果，[工具名] 前缀，30k 截断 */
export function buildBrowserMaterial(messages: MessageRow[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool' || !m.toolName) continue;
    if (!BROWSER_TOOL_RE.test(m.toolName)) continue;
    let ok = true;
    if (m.meta) {
      try {
        const meta = JSON.parse(m.meta) as { ok?: boolean };
        if (meta.ok === false) ok = false;
      } catch {
        // meta 解析失败按成功处理（老数据无 ok 字段）
      }
    }
    if (!ok) continue;
    lines.push(`[${m.toolName}] ${m.content}`);
  }
  if (!lines.length) return '';
  let joined = lines.join('\n');
  if (joined.length > BROWSER_MATERIAL_MAX) {
    joined = joined.slice(0, BROWSER_MATERIAL_MAX) + '…[已截断]';
  }
  return joined;
}
```

3. `EXTRACTION_PROMPT`: replace the kind line with `- kind: "fact" | "preference" | "decision" | "codebase" | "requirement" | "meeting" | "web"`, add under 要提取:

```
- web：网页浏览材料中值得长期记忆的调研结论/事实（tags 含来源站点与话题）
```

and add under 不要提取:

```
- 非浏览材料的凭空网页总结；web 条目必须来自浏览材料
```

4. Signature + transcript assembly:

```ts
export async function extractMemories(
  messages: ChatMessage[],
  scope: Memory['scope'],
  scopeId: string | undefined,
  source: string,
  llmCall: (systemPrompt: string, userMessage: string) => Promise<string>,
  browserMaterial?: string,
): Promise<Memory[]> {
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n');

  const withMaterial = browserMaterial
    ? `${transcript}\n\n--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---\n${browserMaterial}`
    : transcript;

  if (withMaterial.length < 50) return [];
  ...
  const response = await llmCall(EXTRACTION_PROMPT, withMaterial);
```

5. Valid-kind check at line ~80:

```ts
if (!['fact', 'preference', 'decision', 'codebase', 'requirement', 'meeting', 'web'].includes(item.kind)) continue;
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/memory/memory-extractor.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 4: main.ts Hook + MemoryCenter Filter

**Files:**
- Modify: `electron/main.ts` (`extractMemoriesFromSession`)
- Modify: `src/components/memory/MemoryCenter.tsx`
- Modify: `src/components/memory/MemoryCenter.test.tsx` (or memory-components.test.tsx — use whichever covers the filter options)

**Interfaces:**
- Consumes: Task 3's `buildBrowserMaterial` + `extractMemories` 6-arg signature.
- Produces: session-end extraction includes browsing material; MemoryCenter filter offers `网页`.

- [ ] **Step 1: Write failing MemoryCenter test**

Append to the MemoryCenter test file (follow its existing render pattern):

```tsx
it('offers the 网页 kind filter option', async () => {
  // render MemoryCenter with existing harness
  const opt = container.querySelector('select') as HTMLSelectElement | null;
  const hasWeb = Array.from(opt?.options ?? []).some((o) => o.value === 'web' && o.textContent === '网页');
  expect(hasWeb).toBe(true);
});
```

Expected RED: no `web` option.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/memory/MemoryCenter.test.tsx` (or the memory components test file)
Expected: FAIL.

- [ ] **Step 3: Minimal implementation**

`src/components/memory/MemoryCenter.tsx` KIND_OPTIONS:

```tsx
const KIND_OPTIONS: Array<{ value: Memory['kind']; label: string }> = [
  { value: 'fact', label: '事实' },
  { value: 'preference', label: '偏好' },
  { value: 'decision', label: '决策' },
  { value: 'codebase', label: '代码库' },
  { value: 'requirement', label: '需求' },
  { value: 'meeting', label: '会议' },
  { value: 'web', label: '网页' },
];
```

`electron/main.ts` `extractMemoriesFromSession` — after building `chatMessages`:

```ts
const { buildBrowserMaterial } = await import('./memory/memory-extractor');
const browserMaterial = buildBrowserMaterial(messages);
const saved = await extractMemories(chatMessages, scope, scopeId, `session:${request.sessionId}`, llmCall, browserMaterial);
```

(Adjust the existing import line: `const { extractMemories, buildBrowserMaterial } = await import('./memory/memory-extractor');`)

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/components/memory/MemoryCenter.test.tsx src/lib/chat-utils.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 5: Full Verification + Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run full gates**

Run: `npm test`
Expected: all PASS.

Run: `npm run typecheck`
Expected: clean for both tsconfigs.

- [ ] **Step 2: Manual verification notes (record in report)**

- Unit mapping: material build → memory-extractor tests; web kind store → memory-store test; prompt/append → extractor tests; MemoryCenter filter → its test; main.ts hook → design-verified (main.ts has no test harness).
- Spot-check idea for a human: run a session doing web_search + browser_navigate, end session, open 记忆中心 → 网页 filter shows extracted web memories with source `session:<id>`.

- [ ] **Step 3: CHANGELOG entry**

Add under Unreleased:

`AI 浏览器 C3：浏览记忆 — 会话末将 web_search/browser_* 成果并入记忆提取（新增「网页」记忆类型，记忆中心可筛选）`