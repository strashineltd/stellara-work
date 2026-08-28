# Task Motion And Microinteraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate only live discrete task entries, convert progress to compositor-friendly transforms, bind loops to real activity/visibility, improve status semantics, and complete the approved microinteraction transition contract.

**Architecture:** Renderer-only presentation metadata gives every entry a stable key and optional one-shot motion role without changing IPC or persisted rows. MainView allocates keys outside React state updaters, while ChatStream renders classes only when metadata belongs to the active session.

**Tech Stack:** React 19, TypeScript, existing stream reducer, CSS animations/transitions, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-08-22-motion-system-design.md`

## Global Constraints

- Complete the first three motion plans before this plan.
- Do not modify `shared/ipc.ts`, preload, Electron handlers, database schema, or persisted message shape.
- Loaded history, session switches, task-page remounts, token streaming, Markdown reflow, code, shell, and diff content remain static.
- Only live user/assistant/tool/plan/summary/report entries use the 180ms/4px motion; status/error/verify feedback uses 120ms/2px.
- Allocate live keys before React state updater callbacks; updater functions must remain pure under Strict Mode.
- Approval, rejection, abort, and destructive actions remain immediate and never wait for exit animation.
- Progress may use `scaleX`; controls must not use scale.
- Do not add `transition: all`, `will-change`, shimmer, or decorative loops.
- Run commit commands only after an explicit user request.

---

## File Map

- Modify `src/lib/chat-utils.ts` and tests: entry presentation metadata, deterministic history keys, presenter-aware stream reduction, and marker clearing.
- Modify `src/components/MainView.tsx` and tests: key allocation, section-aware presentation, navigation marker cleanup, report/error tagging.
- Modify `src/components/chat/ChatStream.tsx` and tests: stable keys, active-session classes, status semantics, PlanCard running state.
- Modify `src/components/WorkspacePanel.tsx` and tests: transform progress and task-gate semantics.
- Create `src/hooks/usePageVisibilityMotion.ts` and test; call it once from App.
- Modify PlanCard, ErrorBanner, Onboarding, SettingsMcpSection, ApprovalTopBar, and corresponding tests.
- Modify active CSS and style contracts for entry/status animations, loop pausing, and microinteraction properties.

### Task 1: Add Renderer-Only Entry Identity And Motion Metadata

**Files:**
- Modify: `src/lib/chat-utils.test.ts`
- Modify: `src/lib/chat-utils.ts:10-20,67-160,166-200`

**Interfaces:**

```ts
export type EntryEnterMotion = 'discrete' | 'status';
export interface EntryPresentation {
  key: string;
  sessionId: string | null;
  enter?: EntryEnterMotion;
}
export type PresentEntry = (
  entry: DisplayEntry,
  enter: EntryEnterMotion,
) => DisplayEntry;
export function clearEntryEnterMotion(entries: DisplayEntry[]): DisplayEntry[];
```

`applyStreamEventToEntries` gains an optional final `presentEntry` parameter while retaining identity behavior by default.

- [ ] **Step 1: Write failing pure-function tests**

Add exact cases. Extend the local `apply` helper with a fifth `presentEntry` argument and pass it through to `applyStreamEventToEntries`:

```ts
it('gives history deterministic keys without enter motion', () => {
  const entries = messagesToEntries([
    { sessionId: 's1', position: 3, role: 'user', content: 'hi', createdAt: 1 },
  ]);
  expect(entries[0]?.presentation).toEqual({
    key: 'history:s1:3:user',
    sessionId: 's1',
  });
});

it('presents a tool call append as discrete', () => {
  const present = vi.fn((entry: DisplayEntry) => entry);
  applyStreamEventToEntries(
    [],
    {
      type: 'tool_call',
      toolCall: {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
      },
    },
    vi.fn(),
    vi.fn(),
    present,
  );
  expect(present).toHaveBeenCalledWith({
    kind: 'tool_call',
    id: 'tc-1',
    name: 'read_file',
    args: '{"path":"a.ts"}',
  }, 'discrete');
});

it('presents an error append as status', () => {
  const present = vi.fn((entry: DisplayEntry) => entry);
  applyStreamEventToEntries(
    [{ kind: 'user', content: 'x' }],
    { type: 'error', error: 'offline' },
    vi.fn(),
    vi.fn(),
    present,
  );
  expect(present).toHaveBeenCalledWith({
    kind: 'error',
    message: 'offline',
    meta: undefined,
  }, 'status');
});

it('does not present update-only events', () => {
  const events: ChatStreamEvent[] = [
    { type: 'content', content: 'x' },
    { type: 'plan_progress', planSteps: [{ description: 'a', status: 'completed' }] },
    { type: 'approval_required', approval: { id: 'a', toolName: 'edit_file', args: '{}', toolCallId: 'tc' } },
    { type: 'plan_approval_required', planApproval: { id: 'p', plan: ['a'] } },
    { type: 'usage', totals: { promptTokens: 1, completionTokens: 2 } },
    { type: 'subagent_progress', subagentId: 'sub-1', subagentTool: 'read_file' },
  ];
  for (const event of events) {
    const present = vi.fn((entry: DisplayEntry) => entry);
    applyStreamEventToEntries(
      [{ kind: 'assistant', content: '' }, { kind: 'plan', steps: [] }],
      event,
      vi.fn(),
      vi.fn(),
      present,
    );
    expect(present, event.type).not.toHaveBeenCalled();
  }
});

it('clears enter motion without changing keys or untouched entry identity', () => {
  const animated = { kind: 'user', content: 'x', presentation: { key: 'k', sessionId: 's', enter: 'discrete' } } as DisplayEntry;
  const stable = { kind: 'assistant', content: 'y', presentation: { key: 'y', sessionId: 's' } } as DisplayEntry;
  const result = clearEntryEnterMotion([animated, stable]);
  expect(result[0]?.presentation).toEqual({ key: 'k', sessionId: 's', enter: undefined });
  expect(result[1]).toBe(stable);
});
```

Use complete literal `ChatStreamEvent` fixtures in the real test; do not generate expectations from production helpers.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/lib/chat-utils.test.ts`

Expected: FAIL because presentation types/functions and deterministic history keys do not exist.

- [ ] **Step 3: Extend DisplayEntry without touching persistence contracts**

```ts
export type EntryEnterMotion = 'discrete' | 'status';

export interface EntryPresentation {
  key: string;
  sessionId: string | null;
  enter?: EntryEnterMotion;
}

export type DisplayEntry = (
  | { kind: 'user'; content: string; attachments?: AttachmentMeta[] }
  | { kind: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { kind: 'tool_call'; id: string; name: string; args: string }
  | { kind: 'tool_result'; toolCallId?: string; name: string; ok: boolean; output: string; error?: string; meta?: ToolResultMeta }
  | { kind: 'error'; message: string; meta?: import('../../shared/ipc').ErrorMeta }
  | { kind: 'summary'; tokensBefore: number; tokensAfter: number; compressedCount: number; summary: string }
  | { kind: 'report'; summary: string; files: Array<{ path: string; kind: 'write' | 'edit' }>; commands: Array<{ command: string; exitCode: number; ok: boolean }> }
  | { kind: 'plan'; steps: Array<{ description: string; status: string }> }
  | { kind: 'verify'; phase: string; target?: string }
  | { kind: 'subagent_summary'; results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }> }
) & { presentation?: EntryPresentation };

export type PresentEntry = (entry: DisplayEntry, enter: EntryEnterMotion) => DisplayEntry;
```

- [ ] **Step 4: Tag only reducer append branches**

Add `presentEntry: PresentEntry = (entry) => entry` to the reducer signature. Wrap appended tool/result/summary/plan/subagent entries with `'discrete'`, and error/verify entries with `'status'`. Do not invoke it for content, plan progress, approvals, usage, or subagent progress.

For errors, replace an empty assistant placeholder or append one ErrorBanner entry. Do not concatenate a second plain `[连接错误]` string into an existing assistant entry; the error entry owns alert and retry semantics.

- [ ] **Step 5: Add deterministic history presentations**

Use keys derived from `sessionId`, `position`, role, and tool-call ID. Examples:

```ts
function historyPresentation(row: MessageRow, suffix: string): EntryPresentation {
  return {
    key: `history:${row.sessionId}:${row.position}:${suffix}`,
    sessionId: row.sessionId,
  };
}
```

Tool calls emitted from one assistant row append `:tool-call:${toolCall.id}`. Tool results use `:tool-result:${row.toolCallId ?? row.toolName ?? 'tool'}`.

Update the two existing `messagesToEntries` exact-equality tests so expected history entries include deterministic `presentation` objects. Add a round-trip assertion proving `entriesToMessages` omits renderer presentation data.

- [ ] **Step 6: Implement marker clearing**

```ts
export function clearEntryEnterMotion(entries: DisplayEntry[]): DisplayEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (!entry.presentation?.enter) return entry;
    changed = true;
    return {
      ...entry,
      presentation: { ...entry.presentation, enter: undefined },
    };
  });
  return changed ? next : entries;
}
```

- [ ] **Step 7: Run tests and verify GREEN**

Run: `npm test -- src/lib/chat-utils.test.ts`

Expected: all utility tests pass and `entriesToMessages` output remains unchanged.

- [ ] **Step 8: Commit only if explicitly requested**

```bash
git add src/lib/chat-utils.ts src/lib/chat-utils.test.ts
git commit -m "feat(chat): add renderer entry presentation metadata"
```

### Task 2: Animate Only Live Entries In The Active Session

**Files:**
- Modify: `src/components/MainView.tsx:78-108,138-222,320-500,617-717,741-860`
- Modify: `src/components/chat/ChatStream.tsx:16-143`
- Modify: `src/components/MainView.test.tsx`
- Modify: `src/components/chat/ChatStream.test.tsx`
- Modify: `src/styles/workbench.css:2063-2070,4580-4589`
- Modify: `src/styles/motion-contract.test.ts`

**Interfaces:**
- MainView allocates `live:<sessionId>:<sequence>` keys outside state updater callbacks.
- ChatStream maps `presentation.enter` to `.entry--live` or `.entry--status-live` only when `presentation.sessionId` matches its current session.

- [ ] **Step 1: Add failing integration tests**

Cover these observable outcomes:

```text
History load has stable data-entry-key and no live class.
Send adds exactly two discrete live wrappers.
Content tokens preserve the assistant wrapper and key.
Tool call/result and final report are discrete live wrappers.
Error and verify are status live wrappers.
Session switch displays only static entries for the new session.
Navigate away and back removes all live classes.
Stream events received while another page is active are static.
```

Use the existing `SessionSwitchHarness` in `MainView.test.tsx` for the switch case.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/chat/ChatStream.test.tsx src/components/MainView.test.tsx src/styles/motion-contract.test.ts`

Expected: FAIL because wrappers still use index keys and no live classes exist.

- [ ] **Step 3: Add pure key allocation helpers in MainView**

```ts
const reducedMotion = useReducedMotion();
const entrySequenceRef = useRef(0);
const activeSectionRef = useRef(activeSection);
const activeSessionRef = useRef(activeSessionId);
const reducedMotionRef = useRef(reducedMotion);

activeSectionRef.current = activeSection;
activeSessionRef.current = activeSessionId;
reducedMotionRef.current = reducedMotion;

function nextLiveKey(): string {
  entrySequenceRef.current += 1;
  return `live:${activeSessionRef.current ?? 'none'}:${entrySequenceRef.current}`;
}

function presentWithKey(
  entry: DisplayEntry,
  enter: EntryEnterMotion,
  key: string,
): DisplayEntry {
  return {
    ...entry,
    presentation: {
      key,
      sessionId: activeSessionRef.current,
      enter: activeSectionRef.current === 'tasks' && !reducedMotionRef.current
        ? enter
        : undefined,
    },
  };
}
```

When reduced motion becomes active at runtime, clear existing one-shot markers so disabling and later re-enabling the media query cannot replay an old live entry:

```ts
useEffect(() => {
  if (reducedMotion) setEntries(clearEntryEnterMotion);
}, [reducedMotion]);
```

- [ ] **Step 4: Allocate keys before every state updater**

For send:

```ts
const userKey = nextLiveKey();
const assistantKey = nextLiveKey();
setEntries((prev) => [
  ...prev,
  presentWithKey({ kind: 'user', content: userContent, attachments: sentAttachments }, 'discrete', userKey),
  presentWithKey({ kind: 'assistant', content: '' }, 'discrete', assistantKey),
]);
```

For each stream event, allocate one key before `setEntries`, then pass a deterministic presenter closure:

```ts
const eventKey = nextLiveKey();
setEntries((prev) => {
  const next = applyStreamEventToEntries(
    prev,
    ev,
    setPendingApproval,
    setPendingPlanApproval,
    (entry, enter) => presentWithKey(entry, enter, eventKey),
  );
  return next ?? prev;
});
```

Allocate report and local-error keys before their own updater callbacks. Add one `appendLocalError(message)` helper and use it for every validation/attachment error path at current MainView lines 323, 331, 335, 516, 520, 528, 535, 539, and 546. A key may be unused for an update-only event; monotonic gaps are valid and safer than side effects inside an updater.

- [ ] **Step 5: Centralize section navigation and clear one-shot markers**

```ts
function navigateToSection(next: MainSection) {
  const previous = activeSectionRef.current;
  activeSectionRef.current = next;
  if (previous === 'tasks' && next !== 'tasks') {
    setEntries(clearEntryEnterMotion);
  }
  setActiveSection(next);
}
```

Replace every direct `setActiveSection` call with this helper. When Home sends a task, call `navigateToSection('tasks')` before adding user/assistant entries.

- [ ] **Step 6: Render stable keys and active-session classes**

```ts
function entryRenderMeta(entry: DisplayEntry, index: number) {
  const sessionId = props.sessionId ?? null;
  const key = entry.presentation?.key
    ?? `detached:${sessionId ?? 'none'}:${index}:${entry.kind}`;
  const enter = entry.presentation?.sessionId === sessionId
    ? entry.presentation.enter
    : undefined;
  const className = [
    'entry',
    enter === 'discrete' ? 'entry--live' : '',
    enter === 'status' ? 'entry--status-live' : '',
  ].filter(Boolean).join(' ');
  return { key, className };
}
```

Call `entryRenderMeta(e, i)` inside the existing map, use its `key` for both React `key` and `data-entry-key`, use its `className` on the wrapper, and keep every existing kind-specific child branch unchanged.

- [ ] **Step 7: Attach only explicit entry animations**

```css
.entry--live {
  animation: entry-enter var(--motion-base) var(--ease-out) both;
}

.entry--status-live {
  animation: status-enter var(--motion-fast) var(--ease-out) both;
}

@keyframes status-enter {
  from { opacity: 0; transform: translateY(var(--motion-distance-xs)); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 8: Run tests and verify GREEN**

Run the command from Step 2. Expected: all live/history/session/remount cases pass and token updates retain DOM identity.

- [ ] **Step 9: Commit only if explicitly requested**

```bash
git add src/components/MainView.tsx src/components/MainView.test.tsx src/components/chat/ChatStream.tsx src/components/chat/ChatStream.test.tsx src/styles/workbench.css src/styles/motion-contract.test.ts
git commit -m "feat(chat): animate only live task entries"
```

### Task 3: Convert Dynamic Progress To ScaleX

**Files:**
- Modify: `src/components/WorkspacePanel.tsx:262-348`
- Modify: `src/components/WorkspacePanel.test.tsx`
- Modify: `src/styles/workbench.css:3292-3372`
- Modify: `src/styles/tokens.test.ts`

- [ ] **Step 1: Add failing progress tests**

```ts
expect(taskFill.style.width).toBe('');
expect(taskFill.style.transform).toBe('scaleX(0.33)');
expect(taskProgress.getAttribute('aria-valuenow')).toBe('33');
expect(contextFill.style.width).toBe('');
expect(contextFill.style.transform).toBe('scaleX(0.8)');
```

Add source assertions rejecting `transition: width` in active `workbench.css` and requiring `transform-origin: left center`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/WorkspacePanel.test.tsx src/styles/tokens.test.ts`

Expected: FAIL because inline width and width transitions remain.

- [ ] **Step 3: Clamp and render transform values**

```ts
function progressScale(value: number): number {
  return Math.min(100, Math.max(0, value)) / 100;
}
```

Use `style={{ transform: `scaleX(${progressScale(pct)})` }}` for task and context fills while preserving existing ARIA values.

- [ ] **Step 4: Replace width transition CSS**

```css
.progress-bar,
.context-stats__bar-fill {
  width: 100%;
  transform-origin: left center;
}

.progress-bar {
  transition: transform var(--motion-slow) var(--ease-out);
}

.context-stats__bar-fill {
  transition:
    transform var(--motion-slow) var(--ease-out),
    background-color var(--motion-fast) var(--ease-standard);
}
```

Do not change static tool-count bars.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/WorkspacePanel.tsx src/components/WorkspacePanel.test.tsx src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "perf(ui): animate progress with transforms"
```

### Task 4: Bind Loops To True Activity And Page Visibility

**Files:**
- Create: `src/hooks/usePageVisibilityMotion.test.tsx`
- Create: `src/hooks/usePageVisibilityMotion.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/PlanCard.tsx`
- Modify: `src/components/PlanCard.test.tsx`
- Modify: `src/components/chat/ChatStream.tsx`
- Modify: `src/styles/workbench.css`
- Modify: `src/styles/tokens.test.ts`

**Interfaces:**
- `usePageVisibilityMotion(): void` toggles root `data-page-hidden`.
- `PlanCardProps` gains required `running: boolean`.

- [ ] **Step 1: Write failing visibility and Plan tests**

Test initial hidden state, `visibilitychange`, listener cleanup, and root attribute removal. Test `in_progress + running=true` adds `.is-active`, while `running=false` preserves visible status text/ring without the active loop class.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/hooks/usePageVisibilityMotion.test.tsx src/components/PlanCard.test.tsx src/styles/tokens.test.ts`

Expected: FAIL because the hook, running prop, and pause selector do not exist.

- [ ] **Step 3: Implement the document visibility observer**

```ts
import { useEffect } from 'react';

export function usePageVisibilityMotion(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute('data-page-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      root.removeAttribute('data-page-hidden');
    };
  }, []);
}
```

Call it once at the top of `App`, before any early return.

- [ ] **Step 4: Gate Plan spinner activity**

```tsx
<span
  className={`plan-step-spinner${running ? ' is-active' : ''}`}
  aria-hidden="true"
/>
```

Pass `running={props.busy}` from ChatStream. Move the loop declaration to `.plan-step-spinner.is-active`; leave the base ring static.

- [ ] **Step 5: Pause only approved loops in hidden pages**

```css
html[data-page-hidden] .loading-spinner,
html[data-page-hidden] .thinking::before,
html[data-page-hidden] .plan-step-spinner.is-active,
html[data-page-hidden] .kbd.rec {
  animation-play-state: paused;
}
```

Do not pause all animations because one-shot Presence cleanup must still complete.

- [ ] **Step 6: Run tests and verify GREEN**

Run the command from Step 2 plus `npm test -- src/components/chat/ChatStream.test.tsx`.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/hooks/usePageVisibilityMotion.ts src/hooks/usePageVisibilityMotion.test.tsx src/App.tsx src/components/PlanCard.tsx src/components/PlanCard.test.tsx src/components/chat/ChatStream.tsx src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "feat(ui): bind motion loops to active state"
```

### Task 5: Make Status Feedback Immediate And Accessible

**Files:**
- Modify: `src/components/ApprovalTopBar.tsx`, `src/components/ApprovalTopBar.test.tsx`
- Modify: `src/components/ErrorBanner.tsx`
- Create: `src/components/ErrorBanner.test.tsx`
- Modify: `src/components/PlanCard.tsx` and test
- Modify: `src/components/Onboarding.tsx` and test
- Modify: `src/components/MainView.tsx` and test
- Modify: `src/components/WorkspacePanel.tsx` and test
- Modify: `src/components/settings/SettingsMcpSection.tsx` and test
- Modify: `src/components/settings/SettingsShortcutsPanel.test.tsx`
- Modify: `src/components/chat/ChatStream.tsx` and test
- Modify: `src/styles/workbench.css`, `src/styles/motion-contract.test.ts`

- [ ] **Step 1: Add failing semantic tests**

Require:

```text
ErrorBanner root: role=alert.
Model-missing warning: role=alert.
Memory-extracted notice: role=status.
Onboarding success: status; failure: alert; active test/save: status.
Plan approval action group: alertdialog semantics without delayed removal.
MCP success: status; MCP failure: alert.
Workspace task-gate blocked state: alert; ready state: status.
Assistant thinking and shortcut recording retain visible status text.
```

Approval/rejection tests must assert callbacks and immediate logical disappearance in the same `act`, with no timers.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- src/components/ApprovalTopBar.test.tsx src/components/ErrorBanner.test.tsx src/components/PlanCard.test.tsx src/components/Onboarding.test.tsx src/components/MainView.test.tsx src/components/WorkspacePanel.test.tsx src/components/settings/SettingsMcpSection.test.tsx src/components/settings/SettingsShortcutsPanel.test.tsx src/components/chat/ChatStream.test.tsx
```

Expected: missing roles and feedback class assertions fail.

- [ ] **Step 3: Add semantics without new lifecycle delays**

Add literal `role` attributes based on existing state. Use `aria-live="polite"` only for nonurgent status regions; alerts already announce assertively. Do not wrap approvals/errors in Presence.

- [ ] **Step 4: Add one-shot status motion class**

```css
.motion-feedback-enter {
  animation: status-enter var(--motion-fast) var(--ease-out) both;
}
```

Apply only when a status node newly mounts. Do not add pulse or shake.

- [ ] **Step 5: Normalize connection exceptions**

In MainView's `catch`, pass a synthetic `{ type: 'error', error: message }` event through the same reducer/presenter path rather than appending plain `[连接错误]` text. Allocate its live status key before the state updater. Add a reducer regression assertion that a nonempty assistant remains unchanged and receives a following error entry.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2 plus `npm test -- src/styles/motion-contract.test.ts`.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/components src/styles/workbench.css src/styles/motion-contract.test.ts
git commit -m "fix(ui): clarify animated status feedback"
```

### Task 6: Complete The Microinteraction Property Contract

**Files:**
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/styles/workbench.css`

- [ ] **Step 1: Add failing prohibitions and property-coverage tests**

```ts
expect(workbench).not.toMatch(/transition\s*:\s*all\b/);
expect(workbench).not.toMatch(/transition\s*:\s*width\b/);
expect(workbench).not.toMatch(/\.btn-danger:hover[^}]*filter\s*:/);
expect(workbench).not.toContain('0.15s ease');
expect(workbench).not.toMatch(/transform:\s*scale\((?!X)/);
expect(workbench).toMatch(/\.continue-row\s*\{[^}]*border-color var\(--motion-fast\)/);
```

Also parse attachment and Settings switch blocks to require `background-color`, not the `background` shorthand, in transitions.

- [ ] **Step 2: Run the style contract and verify RED**

Run: `npm test -- src/styles/tokens.test.ts`

Expected: FAIL for danger filter, continue-row border, shorthand transitions, and hardcoded Settings switch timing.

- [ ] **Step 3: Replace only known snapping properties**

- Replace danger hover filter with `color-mix(in srgb, var(--color-danger) 90%, var(--color-text-strong))` for both border and background color.
- Add border-color to `.continue-row` transition.
- Replace attachment `background` transitions with `background-color`.
- Replace both Settings switch `0.15s ease` transitions with `var(--motion-fast) var(--ease-standard)`.
- Add explicit 120ms property lists to `.model-pill`, shared floating-menu items, `.attach-chip-remove`, `.attach-thumb-wrap`, `.new-entry-menu__item`, `.radio-card`, `.settings-skill-row`, `.settings-mcp-row`, `.settings-mcp-expand`, `.settings-shortcut-row`, and `.hoverable-path`; include only the color/background-color/border-color/box-shadow/transform properties each selector actually changes.
- Do not animate hidden/display changes, tree heights, editor bodies, or resize width.

- [ ] **Step 4: Run style and representative component tests**

```bash
npm test -- src/styles/tokens.test.ts src/components/HomeDashboard.test.tsx src/components/chat/TabBar.test.tsx src/components/settings/SettingsPanel.test.tsx src/components/WorkspacePanel.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "refactor(ui): unify microinteraction transitions"
```

### Task 7: Final Motion-System Quality Gate And Review

**Files:**
- Review all files changed across all four motion plans.

- [ ] **Step 1: Run all motion-focused suites**

```bash
npm test -- src/hooks/useReducedMotion.test.tsx src/hooks/usePresence.test.tsx src/hooks/usePageVisibilityMotion.test.tsx src/lib/presence-ui.test.ts src/lib/chat-utils.test.ts src/styles/tokens.test.ts src/styles/motion-contract.test.ts src/components/MainView.test.tsx src/components/chat/ChatStream.test.tsx src/components/WorkspacePanel.test.tsx src/components/PlanCard.test.tsx
```

Expected: all pass with no leaked timer, listener, portal, or `act` warnings.

- [ ] **Step 2: Run complete repository quality gates**

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: every command exits `0`; capture exact test counts and build output for the final report.

- [ ] **Step 3: Review requirements line by line**

Re-read `docs/superpowers/specs/2026-08-22-motion-system-design.md` sections 3-13 and map each requirement to a changed selector, hook, component, or test. Any unmapped requirement remains incomplete.

- [ ] **Step 4: Review the complete diff**

Check for:

```text
Accidental legacy stylesheet edits.
New dependencies.
Business actions delayed by animation.
Closing nodes left focusable or clickable.
Index keys remaining in ChatStream.
Presentation metadata leaking into persisted rows or IPC.
Layout-size transitions, transition: all, control scale, shimmer, or decorative loops.
Unrelated refactors in already-dirty files.
```

- [ ] **Step 5: Perform the full visual and interaction matrix**

Run `npm run dev` and inspect macOS/Windows behavior where available, light/dark themes, widths above/below 920px, reduced motion, rapid reopen, long history, session switch, live streaming, tool events, approval/rejection, abort, hidden-window loops, and all core overlays/menus.

- [ ] **Step 6: Request an independent code review**

Provide reviewers the spec, all four plans, and only the task-relevant diff. Fix all Critical and Important findings, then rerun Steps 1-5.

- [ ] **Step 7: Commit the complete motion system only if explicitly requested**

```bash
git add src docs/superpowers/specs/2026-08-22-motion-system-design.md docs/superpowers/plans/2026-08-22-motion-foundation.md docs/superpowers/plans/2026-08-22-core-surface-motion.md docs/superpowers/plans/2026-08-22-navigation-motion.md docs/superpowers/plans/2026-08-22-task-motion-polish.md
git commit -m "feat(ui): add restrained motion system"
```
