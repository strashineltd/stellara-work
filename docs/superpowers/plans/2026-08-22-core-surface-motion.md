# Core Surface Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the sidebar, workspace inspector, settings, command palette, project/file/memory dialogs, and clear-task confirmation real enter/exit lifecycles with immediate business semantics and safe focus behavior.

**Architecture:** Logical booleans close immediately, while Batch 1's `usePresence` retains the visual root through a 140ms transition. Existing panel and backdrop elements remain the Presence roots, preserving flex layout and avoiding new wrapper components.

**Tech Stack:** React 19, TypeScript, CSS transitions, Batch 1 Presence hooks, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-08-22-motion-system-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-22-motion-foundation.md` first.
- Consume `usePresence(present, exitMs?)` exactly as defined by Batch 1.
- Existing business booleans remain authoritative; never call business close callbacks from `transitionend`.
- A closing root must expose `data-motion-state="closing"`, `inert`, and `aria-hidden="true"` immediately.
- Restore focus before React commits `inert` to a closing subtree.
- Keep panel slots mounted through exit, then allow one immediate final content reflow; do not animate width or flex-basis.
- Keep macOS traffic-light and sidebar-toggle positioning unchanged.
- Do not add a generic modal framework or external dependency.
- Run commit commands only when explicitly requested by the user.

---

## File Map

- Create `src/lib/presence-ui.ts`: Presence-root props and durable focus helpers.
- Create `src/lib/presence-ui.test.ts`: root attributes, event forwarding, and focus eligibility.
- Create `src/App.test.tsx`: top-level Settings and panel shortcut lifecycle coverage.
- Create `src/components/CommandPalette.test.tsx`: semantics, focus, transfer, and exit lifecycle.
- Modify `src/App.tsx`: Settings Presence and panel-focus-safe toggles.
- Modify `src/components/MainView.tsx`: panel and overlay Presence ownership with retained payloads.
- Modify `src/components/Sidebar.tsx`, `WorkspacePanel.tsx`, `SettingsPanel.tsx`, `CommandPalette.tsx`, `FileTreeModal.tsx`, `ProjectDialog.tsx`: optional motion roots.
- Modify memory dialog/center files: retained payloads and focus-safe exit.
- Modify active component tests and `src/styles/workbench.css` / `src/styles/tokens.test.ts`.

### Task 1: Add Presence Root And Focus Utilities

**Files:**
- Create: `src/lib/presence-ui.test.ts`
- Create: `src/lib/presence-ui.ts`
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/styles/workbench.css`

**Interfaces:**

```ts
export type MotionPresence = Pick<PresenceResult, 'state' | 'completeExit'>;
export interface PresenceMotionProps { readonly presence?: MotionPresence; }
export function presenceRootProps(presence?: MotionPresence): {
  'data-motion-state': PresenceState;
  inert: true | undefined;
  'aria-hidden': true | undefined;
  onTransitionEnd: ((event: TransitionEvent<HTMLElement>) => void) | undefined;
};
export function captureFocusTarget(explicit?: HTMLElement | null): HTMLElement | null;
export function restoreFocusTarget(target: HTMLElement | null, fallback?: HTMLElement | null): void;
```

- [ ] **Step 1: Write failing utility tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { captureFocusTarget, presenceRootProps, restoreFocusTarget } from './presence-ui';

it('marks only closing roots inert and hidden', () => {
  const completeExit = vi.fn();
  const props = presenceRootProps({ state: 'closing', completeExit });
  expect(props['data-motion-state']).toBe('closing');
  expect(props.inert).toBe(true);
  expect(props['aria-hidden']).toBe(true);
  const root = document.createElement('div');
  props.onTransitionEnd?.({ target: root, currentTarget: root } as never);
  expect(completeExit).toHaveBeenCalledOnce();
});

it('restores focus only to a connected interactive target', () => {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  restoreFocusTarget(trigger);
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
  const fallback = document.createElement('button');
  document.body.appendChild(fallback);
  restoreFocusTarget(trigger, fallback);
  expect(document.activeElement).toBe(fallback);
});

it('captures the active element unless an explicit target is supplied', () => {
  const active = document.createElement('button');
  const explicit = document.createElement('button');
  document.body.append(active, explicit);
  active.focus();
  expect(captureFocusTarget()).toBe(active);
  expect(captureFocusTarget(explicit)).toBe(explicit);
});
```

- [ ] **Step 2: Run the utility test and verify RED**

Run: `npm test -- src/lib/presence-ui.test.ts`

Expected: FAIL because `presence-ui.ts` does not exist.

- [ ] **Step 3: Implement the shared adapter**

```ts
import type { TransitionEvent } from 'react';
import type { PresenceResult, PresenceState } from '../hooks/usePresence';

export type MotionPresence = Pick<PresenceResult, 'state' | 'completeExit'>;

export interface PresenceMotionProps {
  readonly presence?: MotionPresence;
}

export function presenceRootProps(presence?: MotionPresence) {
  const state: PresenceState = presence?.state ?? 'open';
  const closing = state === 'closing';
  return {
    'data-motion-state': state,
    inert: closing ? true : undefined,
    'aria-hidden': closing ? true : undefined,
    onTransitionEnd: presence
      ? (event: TransitionEvent<HTMLElement>) => presence.completeExit(event)
      : undefined,
  };
}

export function captureFocusTarget(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit) return explicit;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

function canFocus(target: HTMLElement | null): target is HTMLElement {
  return Boolean(
    target?.isConnected
    && !target.closest('[inert], [aria-hidden="true"]')
    && !target.matches(':disabled, [aria-disabled="true"]'),
  );
}

export function restoreFocusTarget(
  target: HTMLElement | null,
  fallback: HTMLElement | null = null,
): void {
  const next = canFocus(target) ? target : canFocus(fallback) ? fallback : null;
  next?.focus({ preventScroll: true });
}
```

- [ ] **Step 4: Add failing panel/modal CSS contracts**

Assert state-driven transitions and removal of the old root `animation:` declarations:

```ts
expect(workbench).not.toMatch(/\.sidebar\s*\{[^}]*animation:/);
expect(workbench).not.toMatch(/\.workspace-panel\s*\{[^}]*animation:/);
expect(workbench).toMatch(/\.sidebar\[data-motion-state=['"]entering['"]\][^{]*\{[^}]*translateX/);
expect(workbench).toMatch(/\.workspace-panel\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*translateX/);
expect(workbench).toMatch(/\.modal-backdrop\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*--motion-exit/);
expect(workbench).not.toMatch(/(?:width|height|flex-basis|grid-template-columns)\s+var\(--motion/);
```

- [ ] **Step 5: Replace root keyframes with transitions**

Add the exact panel contract:

```css
.sidebar,
.workspace-panel {
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity var(--motion-slow) var(--ease-out),
    transform var(--motion-slow) var(--ease-out);
}

.sidebar[data-motion-state='entering'],
.sidebar[data-motion-state='closing'] {
  opacity: 0;
  transform: translateX(calc(-1 * var(--motion-distance-md)));
}

.workspace-panel[data-motion-state='entering'],
.workspace-panel[data-motion-state='closing'] {
  opacity: 0;
  transform: translateX(var(--motion-distance-md));
}

.sidebar[data-motion-state='closing'],
.workspace-panel[data-motion-state='closing'] {
  transition-duration: var(--motion-exit);
  transition-timing-function: var(--ease-in);
}
```

Replace backdrop/surface keyframes with:

```css
.modal-backdrop {
  opacity: 1;
  transition: opacity var(--motion-base) var(--ease-out);
}

.modal-backdrop > .modal {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity var(--motion-slow) var(--ease-out),
    transform var(--motion-slow) var(--ease-out);
}

.modal-backdrop[data-motion-state='entering'] {
  opacity: 0;
}

.modal-backdrop[data-motion-state='entering'] > .modal {
  opacity: 0;
  transform: translateY(6px);
}

.modal-backdrop[data-motion-state='closing'] {
  opacity: 0;
  transition-duration: var(--motion-exit);
  transition-timing-function: var(--ease-in);
}

.modal-backdrop[data-motion-state='closing'] > .modal {
  opacity: 0;
  transform: translateY(var(--motion-distance-sm));
  transition-duration: var(--motion-exit);
  transition-timing-function: var(--ease-in);
}
```

Keep `surface-enter` for unrelated inline feedback. Delete only root usages/keyframes made unused by this task.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `npm test -- src/lib/presence-ui.test.ts src/styles/tokens.test.ts`

Expected: all utility and style contracts pass.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/lib/presence-ui.ts src/lib/presence-ui.test.ts src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "feat(ui): define surface presence contract"
```

### Task 2: Retain Sidebar And Workspace Inspector Through Exit

**Files:**
- Modify: `src/components/MainView.tsx:78-108,705-739,862-879`
- Modify: `src/components/Sidebar.tsx:8-33,416-419`
- Modify: `src/components/WorkspacePanel.tsx:100-116,127-183`
- Modify: `src/App.tsx:137-144,252-258`
- Modify tests: `src/components/MainView.test.tsx`, `Sidebar.test.tsx`, `WorkspacePanel.test.tsx`
- Create/modify: `src/App.test.tsx`
- Modify: `src/styles/workbench.css` responsive blocks near 920px/780px

**Interfaces:**
- `SidebarProps` and `WorkspacePanelProps` extend `PresenceMotionProps`.
- MainView owns `sidebarPresence` and `workspacePresence` unconditionally.

- [ ] **Step 1: Add failing panel lifecycle tests**

Extend `renderMainView` with a `rerender(overrides)` method that retains the same root. Add tests that:

```ts
const sidebar = container.querySelector('.main-layout > .sidebar')!;
const inspector = container.querySelector('.main-layout > .workspace-panel')!;
await rerender({ sidebarOpen: false, workspaceOpen: false });
expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
expect(sidebar.hasAttribute('inert')).toBe(true);
expect(inspector.getAttribute('aria-hidden')).toBe('true');
expect(container.querySelector('.sidebar-toggle')?.getAttribute('aria-pressed')).toBe('false');
act(() => sidebar.dispatchEvent(new Event('transitionend', { bubbles: true })));
act(() => inspector.dispatchEvent(new Event('transitionend', { bubbles: true })));
expect(container.querySelector('.main-layout > .sidebar')).toBeNull();
expect(container.querySelector('.main-layout > .workspace-panel')).toBeNull();
```

Add a rapid reopen case and a child-transition case. In App coverage, focus inside each panel, trigger its shortcut callback, and assert focus moves to `.sidebar-toggle` or `.workspace-toggle` before the panel becomes inert.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- src/App.test.tsx src/components/MainView.test.tsx src/components/Sidebar.test.tsx src/components/WorkspacePanel.test.tsx
```

Expected: FAIL because panels still unmount immediately and expose no motion root attributes.

- [ ] **Step 3: Add unconditional Presence owners in MainView**

```ts
const sidebarPresence = usePresence(sidebarOpen);
const workspacePresent = props.workspaceOpen && Boolean(activeWorkDir);
const workspacePresence = usePresence(workspacePresent);
const retainedWorkDirRef = useRef<string | null>(activeWorkDir ?? null);
if (activeWorkDir) retainedWorkDirRef.current = activeWorkDir;
```

Render direct flex children from `mounted`:

```tsx
{sidebarPresence.mounted && (
  <Sidebar presence={sidebarPresence} {...sidebarProps} />
)}

{workspacePresence.mounted && retainedWorkDirRef.current && (
  <WorkspacePanel
    presence={workspacePresence}
    workDir={retainedWorkDirRef.current}
    {...workspaceProps}
  />
)}
```

- [ ] **Step 4: Forward root props and close document-level work**

In both components:

```tsx
<aside className="sidebar" {...presenceRootProps(presence)}>
```

```tsx
<aside
  id="workspace-panel"
  className="workspace-panel"
  {...presenceRootProps(presence)}
>
```

When WorkspacePanel reaches `closing`, end any resize session and restore `document.body.style.cursor` and `userSelect`. When Sidebar reaches `closing`, dismiss body-portaled menus so no interactive portal survives an inert panel.

- [ ] **Step 5: Move focus before shortcut closure**

Consolidate each App toggle into one named function. Before changing state, detect focus inside the closing panel and focus the matching persistent Header button:

```ts
function focusToggleBeforePanelClose(panelSelector: string, toggleSelector: string) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(panelSelector)) {
    document.querySelector<HTMLButtonElement>(toggleSelector)?.focus({ preventScroll: true });
  }
}
```

- [ ] **Step 6: Align both overlay breakpoints at 920px**

Move the Sidebar absolute-overlay declaration from the 780px block into the existing 920px block. Do not change the macOS top margin or titlebar toggle rules.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: panels retain direct layout slots while closing, rapid reopen cancels exit, and focus tests pass.

- [ ] **Step 8: Commit only if explicitly requested**

```bash
git add src/App.tsx src/App.test.tsx src/components/MainView.tsx src/components/MainView.test.tsx src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/components/WorkspacePanel.tsx src/components/WorkspacePanel.test.tsx src/styles/workbench.css
git commit -m "feat(ui): animate workspace panels safely"
```

### Task 3: Add Settings Presence And Durable Header Focus

**Files:**
- Modify: `src/App.tsx:69-75,191-242`
- Modify: `src/components/SettingsPanel.tsx:34-133`
- Modify: `src/components/chat/Header.tsx:17-27,97-145,182-225`
- Modify tests: `src/App.test.tsx`, `src/components/settings/SettingsPanel.test.tsx`, `src/components/chat/Header.test.tsx`

**Interfaces:**

```ts
type OpenSettings = (tab?: SettingsTab, returnFocus?: HTMLElement | null) => void;
interface SettingsPanelProps extends PresenceMotionProps {
  initialTab?: SettingsTab;
  onClose: () => void;
}
```

- [ ] **Step 1: Add failing Settings tests**

Cover all of these facts:

```text
Settings stays mounted with closing/inert/aria-hidden after onClose.
Root transition removes it.
Escape invokes onClose only while not closing.
The requested nav tab receives focus on open and rapid reopen.
Focus returns immediately to the captured opener.
Opening Settings from the model menu returns focus to the durable model trigger, not its transient menu item.
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/App.test.tsx src/components/settings/SettingsPanel.test.tsx src/components/chat/Header.test.tsx`

Expected: FAIL because Settings unmounts immediately and lacks Escape/focus Presence behavior.

- [ ] **Step 3: Own Settings Presence and focus in App**

```ts
const settingsPresence = usePresence(settingsOpen);
const settingsReturnFocusRef = useRef<HTMLElement | null>(null);

function openSettingsAt(tab: SettingsTab = 'models', returnFocus?: HTMLElement | null) {
  settingsReturnFocusRef.current = captureFocusTarget(returnFocus);
  setSettingsInitialTab(tab);
  setSettingsOpen(true);
}

function closeSettings() {
  restoreFocusTarget(settingsReturnFocusRef.current);
  setSettingsOpen(false);
}
```

Render from `settingsPresence.mounted`, including across App's ready-state branch.

- [ ] **Step 4: Make SettingsPanel a guarded Presence root**

Apply `presenceRootProps(presence)` to `.modal-backdrop`. Ignore backdrop and Escape while `presence?.state === 'closing'`. Sync local `tab` from `initialTab` whenever Presence enters, then focus the active nav button in a layout effect.

- [ ] **Step 5: Pass durable Header triggers**

Add refs to `.main-model` and the main-menu trigger. Settings and clear-task callbacks originating from menu items pass those stable buttons to App/MainView instead of relying on a menu item that is about to unmount.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all Settings and Header contracts pass without changing ordinary Settings callers.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/App.tsx src/App.test.tsx src/components/SettingsPanel.tsx src/components/settings/SettingsPanel.test.tsx src/components/chat/Header.tsx src/components/chat/Header.test.tsx
git commit -m "feat(ui): add settings exit continuity"
```

### Task 4: Animate Command Palette, File Tree, And Clear Confirmation

**Files:**
- Modify: `src/components/MainView.tsx:86-98,882-942`
- Modify: `src/components/CommandPalette.tsx:277-331`
- Modify: `src/components/FileTreeModal.tsx:30-85`
- Modify: `src/components/MainView.test.tsx`, `FileTreeModal.test.tsx`
- Create: `src/components/CommandPalette.test.tsx`

**Interfaces:**

```ts
interface CommandPaletteProps extends PresenceMotionProps {
  onClose: (options?: { restoreFocus?: boolean }) => void;
}

interface FileTreeModalProps extends PresenceMotionProps {
  workDir: string;
  onClose: () => void;
}
```

- [ ] **Step 1: Add failing retained-payload and focus tests**

Test CommandPalette dialog semantics, input focus, Escape focus return, closing retention, and command-to-modal focus transfer. Test FileTree trigger focus return and root retention. Test clear-task confirmation retaining its original entry count after entries clear immediately.

```ts
expect(palette.getAttribute('role')).toBe('dialog');
expect(palette.getAttribute('aria-modal')).toBe('true');
expect(backdrop.dataset.motionState).toBe('closing');
expect(backdrop.hasAttribute('inert')).toBe(true);
expect(getByText('1 条工作记录')).not.toBeNull();
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/components/MainView.test.tsx src/components/CommandPalette.test.tsx src/components/FileTreeModal.test.tsx`

Expected: FAIL on immediate unmount, missing modal semantics, missing focus return, and lost clear-task payload.

- [ ] **Step 3: Replace payload-erasing booleans where needed**

```ts
const [fileTree, setFileTree] = useState<{ present: boolean; workDir: string | null }>({
  present: false,
  workDir: null,
});
const [clearTask, setClearTask] = useState<{ present: boolean; entryCount: number }>({
  present: false,
  entryCount: 0,
});
const fileTreePresence = usePresence(fileTree.present);
const clearTaskPresence = usePresence(clearTask.present);
const commandPresence = usePresence(commandPaletteOpen);
```

Close by changing only `present`; retain payload until unmount or the next open.

- [ ] **Step 4: Add guarded roots and focus transfer**

Apply `presenceRootProps` to each backdrop. Give CommandPalette `role="dialog"`, `aria-modal="true"`, and `aria-label="命令面板"`. Ordinary close restores the captured opener; commands that open Settings/FileTree/clear-task transfer the original focus target and do not restore focus to the closing palette first.

- [ ] **Step 5: Preserve immediate clear semantics**

On confirm, clear entries and logical confirmation state in the same action. Render the leaving count from `clearTask.entryCount`, not live `entries.length`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all three surfaces remain only for visual exit and cannot intercept interaction.

- [ ] **Step 7: Commit only if explicitly requested**

```bash
git add src/components/MainView.tsx src/components/MainView.test.tsx src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/components/FileTreeModal.tsx src/components/FileTreeModal.test.tsx
git commit -m "feat(ui): animate command and file overlays"
```

### Task 5: Retain Project Dialog Payloads At Both Owners

**Files:**
- Modify: `src/components/MainView.tsx`
- Modify: `src/components/Sidebar.tsx:74-80,376-380,579-589`
- Modify: `src/components/ProjectDialog.tsx:26-55,135-272`
- Modify tests: `MainView.test.tsx`, `Sidebar.test.tsx`, `ProjectDialog.test.tsx`

**Interfaces:**
- `ProjectDialogProps` extends `PresenceMotionProps`.
- Create owner keeps its form mounted via a boolean Presence.
- Edit owner retains `projectId` while `present` becomes false.

- [ ] **Step 1: Add failing ProjectDialog tests**

Test that backdrop click/Escape calls close once, then becomes inert and ignores repeated closure. Test rapid reopen focusing/resetting the name field. Test Sidebar edit dialog returning focus to the durable `.project-actions-button` rather than its transient menu command.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/components/MainView.test.tsx src/components/Sidebar.test.tsx src/components/ProjectDialog.test.tsx`

Expected: FAIL because both owners erase their render gate immediately.

- [ ] **Step 3: Add optional Presence props to ProjectDialog**

Apply `presenceRootProps` to its backdrop and guard Escape, backdrop, and close-button work while closing. On `entering`, reset the form from the current project/create defaults and focus the name input.

- [ ] **Step 4: Retain create/edit owner payloads**

Use the existing create boolean with `usePresence`. Replace Sidebar's nullable edit ID with:

```ts
const [projectDialog, setProjectDialog] = useState<{
  present: boolean;
  projectId: string | null;
}>({ present: false, projectId: null });
const projectDialogPresence = usePresence(projectDialog.present);
```

Close with `{ ...current, present: false }` and keep `projectId` through exit.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: create/edit forms survive only their visual exit, rapid reopen uses fresh inputs, and focus returns safely.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/MainView.tsx src/components/MainView.test.tsx src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/components/ProjectDialog.tsx src/components/ProjectDialog.test.tsx
git commit -m "feat(ui): retain project dialogs through exit"
```

### Task 6: Retain Memory Editor And Delete Dialog Payloads

**Files:**
- Modify: `src/components/memory/MemoryCenter.tsx:35-37,134-147,192-203,325-342`
- Modify: `src/components/memory/MemoryEditDialog.tsx`
- Modify: `src/components/memory/MemoryDeleteDialog.tsx`
- Modify tests: `MemoryCenter.test.tsx`, `memory-components.test.tsx`

**Interfaces:**
- Both dialog props extend `PresenceMotionProps`.
- MemoryCenter owns separate retained editor and deletion payloads.

- [ ] **Step 1: Replace immediate-unmount expectations with failing Presence tests**

Cover cancel, Escape, confirmed delete, rapid edit-close-create, safe default focus, `aria-modal`, and `alertdialog` semantics. Confirm delete IPC executes exactly once before visual exit completes.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/components/memory/MemoryCenter.test.tsx src/components/memory/memory-components.test.tsx`

Expected: existing immediate-null assertions fail after the new desired tests are added.

- [ ] **Step 3: Add retained owner state**

```ts
const [editor, setEditor] = useState<{
  present: boolean;
  memory: Memory | null;
}>({ present: false, memory: null });
const [deletion, setDeletion] = useState<{
  present: boolean;
  memory: Memory | null;
}>({ present: false, memory: null });
const editorPresence = usePresence(editor.present);
const deletePresence = usePresence(deletion.present);
```

Do not clear `memory` on close. Reset editor fields when `memory?.id` changes or Presence re-enters.

- [ ] **Step 4: Add dialog semantics and safe focus**

Editor: `role="dialog"`, `aria-modal="true"`. Delete: `role="alertdialog"`, `aria-modal="true"`, Cancel receives initial focus. After confirmed deletion, restore to the memory search input because the deleted card trigger no longer exists.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: no stale form content, no duplicate delete, and closing dialogs are inert.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add src/components/memory/MemoryCenter.tsx src/components/memory/MemoryEditDialog.tsx src/components/memory/MemoryDeleteDialog.tsx src/components/memory/MemoryCenter.test.tsx src/components/memory/memory-components.test.tsx
git commit -m "feat(ui): animate memory dialogs safely"
```

### Task 7: Core Surface Quality Gate

**Files:**
- Review all Batch 2 changes.

- [ ] **Step 1: Run every affected suite**

```bash
npm test -- src/lib/presence-ui.test.ts src/App.test.tsx src/components/MainView.test.tsx src/components/Sidebar.test.tsx src/components/WorkspacePanel.test.tsx src/components/settings/SettingsPanel.test.tsx src/components/chat/Header.test.tsx src/components/CommandPalette.test.tsx src/components/FileTreeModal.test.tsx src/components/ProjectDialog.test.tsx src/components/memory/MemoryCenter.test.tsx src/components/memory/memory-components.test.tsx src/styles/tokens.test.ts
```

Expected: all tests pass with no leaked timers, document listeners, portals, or `act` warnings.

- [ ] **Step 2: Run repository quality gates**

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Perform the manual interaction matrix**

Run: `npm run dev`

Verify at widths above and below 920px: open/close, rapid reopen, Escape, backdrop click, trigger focus return, command-to-modal transfer, dark/light theme, macOS titlebar alignment, and reduced-motion immediate removal.

- [ ] **Step 4: Review the diff against constraints**

Confirm no business action waits for a transition, no closing node remains focusable, direct panel layout children remain intact, and no width/height animation was introduced.

- [ ] **Step 5: Commit the completed batch only if explicitly requested**

```bash
git add src
git commit -m "feat(ui): add core surface motion"
```
