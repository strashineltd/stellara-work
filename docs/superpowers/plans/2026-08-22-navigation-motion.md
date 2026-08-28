# Navigation Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direction-aware menu exits, restrained page entrances, settings-content-only motion, onboarding continuity, and static task history.

**Architecture:** Menus use Batch 1 Presence with a 120ms exit and retain only the payload required for a leaving frame. Page motion remains entrance-only and is attached to page roots, never the task transcript; Settings keeps its shell fixed and remounts only a keyed content wrapper.

**Tech Stack:** React 19, TypeScript, Batch 1 Presence hooks, CSS transitions/keyframes, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-08-22-motion-system-design.md`

## Global Constraints

- Complete the motion foundation and core surface plans first.
- Menu `aria-expanded` follows the logical open boolean, not visual `mounted` state.
- Closing menus are inert and hidden immediately; actions still execute synchronously.
- Menus below triggers enter from `-4px`; menus above triggers enter from `+4px`.
- Standard menus enter in `180ms`; slash suggestions enter in `120ms`; every menu exits in `120ms`.
- Never animate loaded task history or the task page root.
- Page entrances use `180ms / 4px`; Settings tab content uses `120ms / 2px`.
- Do not animate page or panel width/height and do not introduce staggered lists.
- Run commit commands only after an explicit user request.

---

## File Map

- Create `src/styles/motion-contract.test.ts`: focused selectors, directions, durations, and static-history contracts.
- Create `src/components/FileTreeNode.test.tsx` and `src/components/files/NewEntryMenu.test.tsx` where dedicated unit coverage is absent.
- Modify Header, Sidebar, TabBar, FileTreeNode, NewEntryMenu, and InputArea for retained menu Presence.
- Modify HomeDashboard, MemoryCenter, SidebarFileView, SettingsPanel, and Onboarding with scoped entrance markers.
- Modify MainView/ChatStream styling so task history remains static until Batch 4 explicitly tags live entries.
- Modify `src/styles/workbench.css` and affected component tests.

### Task 1: Establish Shared Menu And Page Motion Contracts

**Files:**
- Create: `src/styles/motion-contract.test.ts`
- Modify: `src/styles/workbench.css`

**Interfaces:**
- Menu roots expose `data-motion="menu"`, `data-motion-state`, and `data-side="top" | "bottom"`.
- Page roots expose `data-motion="page-enter"` and `data-page`.
- Settings and onboarding roots use their dedicated data-motion values.

- [ ] **Step 1: Write failing source contracts**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'workbench.css'), 'utf8');

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('motion contracts', () => {
  it('uses direction-aware state-driven menu motion', () => {
    expect(css).toMatch(/\[data-motion=['"]menu['"]\]\s*\{/);
    expect(css).toMatch(/\[data-motion=['"]menu['"]\]\[data-side=['"]top['"]\]/);
    expect(css).toMatch(/--menu-offset-y:\s*var\(--motion-distance-sm\)/);
    expect(css).toMatch(/transition-duration:\s*var\(--motion-fast\)/);
    expect(css).not.toMatch(/@keyframes\s+(?:popover-enter|model-popover-enter)/);
  });

  it('keeps ordinary task entries static', () => {
    expect(block('.entry')).not.toMatch(/animation\s*:/);
    expect(css).not.toMatch(/\.main-chat[^}]*animation\s*:/);
  });

  it('uses approved page and settings distances', () => {
    expect(css).toMatch(/page-content-enter[\s\S]*var\(--motion-distance-sm\)/);
    expect(css).toMatch(/settings-content-enter[\s\S]*var\(--motion-distance-xs\)/);
    expect(block('.settings-panels')).not.toMatch(/(?:animation|width|height)\s*:/);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/styles/motion-contract.test.ts`

Expected: FAIL because menus still use keyframes, `.entry` still animates, and the new page/settings contracts do not exist.

- [ ] **Step 3: Implement shared state-driven menu CSS**

```css
[data-motion='menu'] {
  --menu-x: 0px;
  --menu-offset-y: calc(-1 * var(--motion-distance-sm));
  --menu-enter-duration: var(--motion-base);
  opacity: 1;
  transform: translate(var(--menu-x), 0);
  transition:
    opacity var(--menu-enter-duration) var(--ease-out),
    transform var(--menu-enter-duration) var(--ease-out);
}

[data-motion='menu'][data-side='top'] {
  --menu-offset-y: var(--motion-distance-sm);
}

[data-motion='menu'][data-motion-state='entering'],
[data-motion='menu'][data-motion-state='closing'] {
  opacity: 0;
  transform: translate(var(--menu-x), var(--menu-offset-y));
}

[data-motion='menu'][data-motion-state='closing'] {
  transition-duration: var(--motion-fast);
  transition-timing-function: var(--ease-in);
}

.model-switcher-menu {
  --menu-x: -50%;
}

.slash-menu {
  --menu-enter-duration: var(--motion-fast);
}
```

Remove the generic menu `animation:` and obsolete `popover-enter` / `model-popover-enter` keyframes only after all selector references are gone.

- [ ] **Step 4: Add approved entrance keyframes**

```css
[data-motion='page-enter'],
[data-motion='onboarding-step-enter'] {
  animation: page-content-enter var(--motion-base) var(--ease-out) both;
}

[data-motion='settings-content-enter'] {
  animation: settings-content-enter var(--motion-fast) var(--ease-out) both;
}

@keyframes page-content-enter {
  from { opacity: 0; transform: translateY(var(--motion-distance-sm)); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes settings-content-enter {
  from { opacity: 0; transform: translateY(var(--motion-distance-xs)); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 5: Remove unconditional entry animation**

Delete `animation: entry-enter ...` from the base `.entry` rule. Keep the `entry-enter` keyframe temporarily because Batch 4 will attach it to `.entry--live`.

- [ ] **Step 6: Re-run the contract**

Run: `npm test -- src/styles/motion-contract.test.ts`

Expected: all shared CSS contracts pass.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/styles/motion-contract.test.ts src/styles/workbench.css
git commit -m "feat(ui): define navigation motion contracts"
```

### Task 2: Add Presence To Header Menus

**Files:**
- Modify: `src/components/chat/Header.tsx:33-67,97-149,182-225`
- Modify: `src/components/chat/Header.test.tsx`

**Interfaces:**
- Two independent `usePresence(open, 120)` instances.
- Both roots use `data-side="bottom"`.

- [ ] **Step 1: Add failing Header tests**

Test model and main menu roots, logical ARIA, Escape, action immediacy, child/root transition filtering, and trigger focus:

```ts
expect(menu.getAttribute('data-motion')).toBe('menu');
expect(menu.getAttribute('data-side')).toBe('bottom');
expect(trigger.getAttribute('aria-expanded')).toBe('false');
expect(menu.getAttribute('data-motion-state')).toBe('closing');
expect(menu.hasAttribute('inert')).toBe(true);
act(() => menu.dispatchEvent(new Event('transitionend', { bubbles: true })));
expect(container.querySelector('.header-menu')).toBeNull();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/chat/Header.test.tsx`

Expected: FAIL because both menus unmount immediately and the model menu lacks Escape closure.

- [ ] **Step 3: Add independent Presence state**

```ts
const modelPresence = usePresence(modelMenuOpen, 120);
const menuPresence = usePresence(menuOpen, 120);
const modelTriggerRef = useRef<HTMLButtonElement>(null);
const menuTriggerRef = useRef<HTMLButtonElement>(null);
```

Render from `mounted` and apply:

```tsx
data-motion="menu"
data-motion-state={modelPresence.state}
data-side="bottom"
inert={modelPresence.state === 'closing' ? true : undefined}
aria-hidden={modelPresence.state === 'closing' ? true : undefined}
onTransitionEnd={modelPresence.completeExit}
```

- [ ] **Step 4: Centralize closure behavior**

Close logical state immediately on Escape, outside click, toggle, model selection, or action. Restore the durable trigger unless the action intentionally opens another modal and passes that trigger forward under Batch 2's focus-transfer contract.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2. Expected: all Header tests pass without delaying model switching or Settings opening.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/chat/Header.tsx src/components/chat/Header.test.tsx
git commit -m "feat(ui): animate header menus"
```

### Task 3: Retain And Directionally Animate Sidebar Menus

**Files:**
- Modify: `src/components/Sidebar.tsx:40-80,177-200,241-253,332-414,591-641`
- Modify: `src/components/Sidebar.test.tsx`

**Interfaces:**

```ts
type MenuSide = 'top' | 'bottom';
type SessionMenuState = SessionMenuPosition & {
  open: boolean;
  side: MenuSide;
  session: SessionSummary;
};
type ProjectMenuState = {
  open: boolean;
  project: ProjectSummary;
};
```

- [ ] **Step 1: Add failing top/bottom and retained-payload tests**

Use the existing measured flip test for a constrained viewport and add a roomy viewport case. Assert `data-side="top"` only when flipped. Replace immediate Escape-null assertions with closing/inert/root-transition expectations. Add a project-panel case with `data-side="bottom"`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/Sidebar.test.tsx`

Expected: FAIL because state is nulled immediately and no side is exposed.

- [ ] **Step 3: Split project and session menu state**

Use retained payload objects and separate `usePresence(..., 120)` calls. Closing changes only `open: false`; keep the session/project payload through exit. Derive side during layout measurement:

```ts
const shouldFlip = position.anchorTop + rect.height > visibleBottom;
const side: MenuSide = shouldFlip ? 'top' : 'bottom';
const top = shouldFlip ? position.flipBottom - rect.height : position.anchorTop;
setSessionMenu((current) => current ? { ...current, top, side } : current);
```

- [ ] **Step 4: Keep portal focus and panel closure safe**

Session menu Escape returns focus to its originating session row. Rename moves focus to the rename input instead. If Batch 2 marks Sidebar noninteractive/closing, close both menus without restoring focus into the closing panel.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2. Expected: dynamic side, retained portal, and focus tests pass.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat(ui): animate sidebar menus directionally"
```

### Task 4: Animate Tab And File Context Menus

**Files:**
- Modify: `src/components/chat/TabBar.tsx:21-45,47-140`
- Modify: `src/components/chat/TabBar.test.tsx`
- Modify: `src/components/FileTreeNode.tsx:24-94`
- Create: `src/components/FileTreeNode.test.tsx`

**Interfaces:**

```ts
type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  side: 'bottom';
};
```

Tab state also retains `tabId`.

- [ ] **Step 1: Add failing menu lifecycle tests**

For each component, right-click/open, then assert `data-side="bottom"`. Escape must collapse owner `aria-expanded` immediately while retaining an inert closing root. Actions fire before root transition completion.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/chat/TabBar.test.tsx src/components/FileTreeNode.test.tsx`

Expected: FileTreeNode test initially fails module behavior assertions; both menus lack Presence attributes.

- [ ] **Step 3: Retain context-menu payloads**

Replace nullable/immediate-clear state with `open` payload objects and `usePresence(logicalOpen, 120)`. Keep current pointer coordinates and truthful `bottom` placement; do not add unrequested collision/flip logic.

- [ ] **Step 4: Add ARIA and immediate actions**

Tab owner exposes `aria-haspopup="menu"` and logical `aria-expanded`. Close/close-others and file actions execute immediately, then logical menu state closes. Root transition removes only the visual shell.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/chat/TabBar.tsx src/components/chat/TabBar.test.tsx src/components/FileTreeNode.tsx src/components/FileTreeNode.test.tsx
git commit -m "feat(ui): animate context menus"
```

### Task 5: Animate New-Entry And Slash Menus

**Files:**
- Modify: `src/components/files/NewEntryMenu.tsx:18-155`
- Create: `src/components/files/NewEntryMenu.test.tsx`
- Modify: `src/components/chat/InputArea.tsx:51-129`
- Modify: `src/components/chat/InputArea.test.tsx`

**Interfaces:**
- New-entry menu uses `data-side="bottom"`.
- Slash menu uses `data-side="top"` and keeps textarea focus.

- [ ] **Step 1: Add failing high-frequency menu tests**

Test logical ARIA collapse, 120ms Presence, Escape, root transition, and immediate selection. For slash mouse selection, assert `onSlashApply` fires and textarea regains focus. For NewEntry selection, assert the focused form appears immediately rather than overlapping a closing dropdown.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/files/NewEntryMenu.test.tsx src/components/chat/InputArea.test.tsx`

Expected: FAIL because menus unmount immediately and the slash list has no top-side contract.

- [ ] **Step 3: Add Presence to both menus**

Use `usePresence(menuOpen, 120)` and `usePresence(props.slash.slashOpen, 120)`. Apply the shared data attributes and closing interaction guards.

- [ ] **Step 4: Handle menu-to-form replacement without overlap**

When NewEntryMenu chooses file/folder, set `kind` and logical menu false in the same action. Render the form immediately and retain the inert dropdown until its ordinary 120ms root transition completes; do not call `completeExit()` early and do not delay focus or form state until animation completion.

- [ ] **Step 5: Preserve textarea ownership**

Textarea ARIA follows logical `slashOpen`; the inert list may remain visually for exit. Mouse selection calls `onSlashApply` immediately and then focuses the textarea ref.

- [ ] **Step 6: Run tests and verify GREEN**

Run the command from Step 2.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/components/files/NewEntryMenu.tsx src/components/files/NewEntryMenu.test.tsx src/components/chat/InputArea.tsx src/components/chat/InputArea.test.tsx
git commit -m "feat(ui): animate composer and file menus"
```

### Task 6: Add Scoped Page Entrances And Keep Tasks Static

**Files:**
- Modify: `src/components/HomeDashboard.tsx:89-160`
- Modify: `src/components/memory/MemoryCenter.tsx:207-323`
- Modify: `src/components/files/SidebarFileView.tsx:81-137`
- Modify: `src/components/MainView.tsx:741-860`
- Modify tests: `HomeDashboard.test.tsx`, `MemoryCenter.test.tsx`, `SidebarFileView.test.tsx`, `MainView.test.tsx`

- [ ] **Step 1: Add failing page identity tests**

Assert Home/Projects root markers, Memory/File markers, stable roots during local updates, and no page marker anywhere in Tasks. Assert switching `home -> projects` replaces the host root but preserves HomeDashboard component state such as banner snooze.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/components/HomeDashboard.test.tsx src/components/memory/MemoryCenter.test.tsx src/components/files/SidebarFileView.test.tsx src/components/MainView.test.tsx
```

Expected: FAIL because page markers do not exist.

- [ ] **Step 3: Add root-only markers**

```tsx
<main
  key={section}
  className={`dashboard dashboard--${section}`}
  data-motion="page-enter"
  data-page={section}
>
```

Add analogous fixed markers to `.memory-center` and `.sidebar-file-view`. Do not key `HomeDashboard` in MainView; key only its returned host node.

- [ ] **Step 4: Assert task history remains static**

Ensure MainView does not place `data-motion="page-enter"` on ChatStream, TabBar, InputArea, `.messages`, or `.entry`. Batch 4 alone will add explicit live-entry classes.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2 plus `npm test -- src/styles/motion-contract.test.ts`.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/HomeDashboard.tsx src/components/HomeDashboard.test.tsx src/components/memory/MemoryCenter.tsx src/components/memory/MemoryCenter.test.tsx src/components/files/SidebarFileView.tsx src/components/files/SidebarFileView.test.tsx src/components/MainView.tsx src/components/MainView.test.tsx
git commit -m "feat(ui): add scoped page entrances"
```

### Task 7: Animate Settings Content And Onboarding Steps

**Files:**
- Modify: `src/components/SettingsPanel.tsx:80-131`
- Modify: `src/components/settings/SettingsPanel.test.tsx`
- Modify: `src/components/Onboarding.tsx:13-127,134,210,286`
- Modify: `src/components/Onboarding.test.tsx`

- [ ] **Step 1: Add failing node-identity tests**

Settings test captures `.settings-modal`, `.settings-panels`, and `.settings-tab-content`; after tab click, the first two must remain identical nodes while only content changes. A settings refresh event must preserve the content node. Onboarding tests assert each step's marker and that selection/status updates do not remount the current page.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/components/settings/SettingsPanel.test.tsx src/components/Onboarding.test.tsx`

Expected: FAIL because wrappers/markers do not exist.

- [ ] **Step 3: Add a keyed Settings content wrapper**

```tsx
<main className="settings-panels">
  <div
    key={tab}
    className="settings-tab-content"
    data-motion="settings-content-enter"
    data-tab={tab}
  >
    {renderActivePanel()}
  </div>
</main>
```

Keep refresh-driven state below the same keyed tab wrapper so refresh does not replay the animation.

- [ ] **Step 4: Mark Onboarding page roots**

Each `.ob-page` receives `data-motion="onboarding-step-enter"` and its exact `data-step`. Model selection, field input, testing, saving, success, and failure keep the same step root.

- [ ] **Step 5: Run tests and verify GREEN**

Run the command from Step 2 plus `npm test -- src/styles/motion-contract.test.ts`.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/SettingsPanel.tsx src/components/settings/SettingsPanel.test.tsx src/components/Onboarding.tsx src/components/Onboarding.test.tsx
git commit -m "feat(ui): animate settings and onboarding content"
```

### Task 8: Navigation Motion Quality Gate

**Files:**
- Review all Batch 3 changes.

- [ ] **Step 1: Run all focused suites**

```bash
npm test -- src/styles/motion-contract.test.ts src/components/chat/Header.test.tsx src/components/Sidebar.test.tsx src/components/chat/TabBar.test.tsx src/components/FileTreeNode.test.tsx src/components/files/NewEntryMenu.test.tsx src/components/chat/InputArea.test.tsx src/components/HomeDashboard.test.tsx src/components/memory/MemoryCenter.test.tsx src/components/files/SidebarFileView.test.tsx src/components/MainView.test.tsx src/components/settings/SettingsPanel.test.tsx src/components/Onboarding.test.tsx
```

Expected: all suites pass without timer or portal leakage.

- [ ] **Step 2: Run repository quality gates**

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

- [ ] **Step 3: Perform manual direction and history checks**

Run `npm run dev`. Check both Sidebar session-menu directions, Header/model menus, tab/file context menus, NewEntry and slash menus, rapid reopen, reduced motion, page switching, and return to a long task history with no replay.

- [ ] **Step 4: Review the diff against constraints**

Confirm that menu actions are immediate, logical ARIA closes before visual removal, task entries remain static, Settings shell dimensions do not animate, and no collision logic was added to menus that do not currently flip.

- [ ] **Step 5: Commit the completed batch only if explicitly requested**

```bash
git add src
git commit -m "feat(ui): add navigation motion system"
```
