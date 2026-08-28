# Motion Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared motion tokens, reduced-motion observer, Presence lifecycle, closing-state contract, and canonical status loops required by every later motion batch.

**Architecture:** CSS remains the visual source of truth, while two focused React hooks expose system reduced-motion state and retain closing UI until its root transition completes. `usePresence` owns visual mount state only; existing business booleans remain authoritative.

**Tech Stack:** React 19, TypeScript, CSS custom properties, Vitest, jsdom, React DOM `createRoot`/`act`.

**Spec:** `docs/superpowers/specs/2026-08-22-motion-system-design.md`

## Global Constraints

- Do not add an animation package or any runtime dependency.
- Keep the existing `120ms / 180ms / 220ms` timing ladder and add only the approved `140ms` exit tier.
- Animate only opacity, transform, color, background-color, border-color, and box-shadow.
- Do not add width, height, margin, padding, top, left, or scroll-position animation.
- `prefers-reduced-motion: reduce` must bypass Presence waiting and disable nonessential loops.
- Modify only active styles: `src/styles/grounded-tokens.css` and `src/styles/workbench.css`; do not edit legacy `global.css` or `tokens.css`.
- Follow strict TDD: add each failing test, observe the expected failure, then add the minimum implementation.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Create `src/hooks/useReducedMotion.ts`: one `useSyncExternalStore` wrapper around the system media query.
- Create `src/hooks/useReducedMotion.test.tsx`: subscription, cleanup, and unavailable-API behavior.
- Create `src/hooks/usePresence.ts`: visual mount/enter/open/close lifecycle.
- Create `src/hooks/usePresence.test.tsx`: timing, event filtering, races, Strict Mode, and reduced-motion coverage.
- Modify `src/styles/grounded-tokens.css`: approved duration, easing, distance, and loop tokens.
- Modify `src/styles/workbench.css`: reduced-motion contract, generic closing interaction guard, and canonical loops.
- Modify `src/styles/tokens.test.ts`: source contracts tying TypeScript constants to active CSS.

### Task 1: Lock The Motion Token Vocabulary

**Files:**
- Modify: `src/styles/tokens.test.ts:5-29`
- Modify: `src/styles/grounded-tokens.css:99-104`

**Interfaces:**
- Produces CSS tokens consumed by all later plans: `--motion-exit`, `--ease-in`, three distance tokens, and two loop tokens.

- [ ] **Step 1: Write the failing exact-value contract**

Add this table near the existing `REQUIRED` contract:

```ts
const MOTION_TOKENS = [
  ['--motion-fast', '120ms'],
  ['--motion-base', '180ms'],
  ['--motion-slow', '220ms'],
  ['--motion-exit', '140ms'],
  ['--ease-standard', 'cubic-bezier(0.2, 0, 0, 1)'],
  ['--ease-out', 'cubic-bezier(0.16, 1, 0.3, 1)'],
  ['--ease-in', 'cubic-bezier(0.4, 0, 1, 1)'],
  ['--motion-distance-xs', '2px'],
  ['--motion-distance-sm', '4px'],
  ['--motion-distance-md', '8px'],
  ['--motion-loop-spin', '800ms'],
  ['--motion-loop-pulse', '1200ms'],
] as const;

it.each(MOTION_TOKENS)('defines %s as %s', (token, value) => {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(tokens).toMatch(new RegExp(`${token}\\s*:\\s*${escaped}\\s*;`));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/styles/tokens.test.ts`

Expected: FAIL for the seven approved tokens that do not yet exist; the five existing values remain green.

- [ ] **Step 3: Add the minimum token definitions**

Extend the active token block:

```css
--motion-fast: 120ms;
--motion-base: 180ms;
--motion-slow: 220ms;
--motion-exit: 140ms;
--motion-loop-spin: 800ms;
--motion-loop-pulse: 1200ms;
--motion-distance-xs: 2px;
--motion-distance-sm: 4px;
--motion-distance-md: 8px;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
```

- [ ] **Step 4: Run the token contract and verify GREEN**

Run: `npm test -- src/styles/tokens.test.ts`

Expected: all `tokens.test.ts` cases pass.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/styles/grounded-tokens.css src/styles/tokens.test.ts
git commit -m "feat(ui): define motion system tokens"
```

### Task 2: Add The Reduced-Motion Subscriber

**Files:**
- Create: `src/hooks/useReducedMotion.test.tsx`
- Create: `src/hooks/useReducedMotion.ts`

**Interfaces:**
- Produces: `REDUCED_MOTION_QUERY: string` and `useReducedMotion(): boolean`.
- Consumed by: `usePresence` in Task 3 and page visibility/status work in the fourth plan.

- [ ] **Step 1: Write the failing hook tests**

Create a small harness using the repository's `createRoot` and `act` pattern:

```tsx
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, useReducedMotion } from './useReducedMotion';

function Probe() {
  return <output data-reduced={String(useReducedMotion())} />;
}

function renderProbe() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const view = renderProbe();
    expect(view.container.querySelector('output')?.dataset.reduced).toBe('false');
    view.unmount();
  });

  it('subscribes to the reduced-motion query and cleans up', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const addEventListener = vi.fn((_type: string, listener: () => void) => listeners.add(listener));
    const removeEventListener = vi.fn((_type: string, listener: () => void) => listeners.delete(listener));
    const media = {
      get matches() { return matches; },
      media: REDUCED_MOTION_QUERY,
      onchange: null,
      addEventListener,
      removeEventListener,
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('matchMedia', matchMedia);

    const view = renderProbe();
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(view.container.querySelector('output')?.dataset.reduced).toBe('false');

    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(view.container.querySelector('output')?.dataset.reduced).toBe('true');

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/hooks/useReducedMotion.test.tsx`

Expected: FAIL because `./useReducedMotion` does not exist.

- [ ] **Step 3: Implement the external-store hook**

Create `src/hooks/useReducedMotion.ts`:

```ts
import { useSyncExternalStore } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function getSnapshot(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
```

- [ ] **Step 4: Run the hook test and verify GREEN**

Run: `npm test -- src/hooks/useReducedMotion.test.tsx`

Expected: both tests pass with one listener removed on unmount.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/hooks/useReducedMotion.ts src/hooks/useReducedMotion.test.tsx
git commit -m "feat(ui): observe reduced motion preference"
```

### Task 3: Implement The Presence Lifecycle

**Files:**
- Create: `src/hooks/usePresence.test.tsx`
- Create: `src/hooks/usePresence.ts`

**Interfaces:**
- Consumes: `useReducedMotion()` from Task 2.
- Produces:

```ts
export const DEFAULT_PRESENCE_EXIT_MS = 140;
export type PresenceState = 'entering' | 'open' | 'closing';
export interface PresenceEndEvent {
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
}
export interface PresenceResult {
  readonly mounted: boolean;
  readonly state: PresenceState;
  readonly completeExit: (event?: PresenceEndEvent) => void;
}
export function usePresence(present: boolean, exitMs?: number): PresenceResult;
```

- [ ] **Step 1: Write a failing state-machine harness**

Use fake timers and a controllable RAF queue. The harness root must attach `completeExit` to `onTransitionEnd` and expose `data-motion-state`.

```tsx
function PresenceProbe({ present, exitMs }: { present: boolean; exitMs?: number }) {
  const presence = usePresence(present, exitMs);
  return presence.mounted ? (
    <div
      data-presence-root
      data-motion-state={presence.state}
      onTransitionEnd={presence.completeExit}
    >
      <span data-presence-child />
    </div>
  ) : null;
}
```

Add these tests before implementation, using the harness above plus fake timers, a captured RAF callback map, and the same mutable `MediaQueryList` mock from Task 2:

```text
false -> true: root exists immediately as entering; flushing one RAF changes it to open.
true -> false: root remains as closing; a root transitionend removes it.
child transitionend: dispatch from data-presence-child with bubbling; root remains closing.
default timeout: 189ms keeps the root; the 190th millisecond removes it.
custom 20ms timeout: 69ms keeps the root; the 70th millisecond removes it.
rapid reopen: close, reopen before completion, flush the stale event and timer; root remains mounted and opens.
initial reduced motion: closing removes the root synchronously and leaves no timer or RAF.
runtime reduced motion: start closing, flip media.matches to true, notify subscribers; root removes immediately.
StrictMode cleanup: unmount after scheduling enter and close work; RAF map and timer count are both zero.
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/hooks/usePresence.test.tsx`

Expected: FAIL because `./usePresence` does not exist.

- [ ] **Step 3: Implement the minimum race-safe hook**

Create `src/hooks/usePresence.ts`:

```ts
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

export const DEFAULT_PRESENCE_EXIT_MS = 140;

export type PresenceState = 'entering' | 'open' | 'closing';

export interface PresenceEndEvent {
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
}

export interface PresenceResult {
  readonly mounted: boolean;
  readonly state: PresenceState;
  readonly completeExit: (event?: PresenceEndEvent) => void;
}

export function usePresence(
  present: boolean,
  exitMs = DEFAULT_PRESENCE_EXIT_MS,
): PresenceResult {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(present);
  const [state, setState] = useState<PresenceState>(present ? 'entering' : 'open');
  const mountedRef = useRef(present);
  const presentRef = useRef(present);
  const stateRef = useRef<PresenceState>(present ? 'entering' : 'open');
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  presentRef.current = present;

  const updateState = useCallback((next: PresenceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearPending = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;
  }, []);

  const unmount = useCallback(() => {
    clearPending();
    mountedRef.current = false;
    setMounted(false);
    updateState('open');
  }, [clearPending, updateState]);

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    clearPending();

    if (present) {
      if (!mountedRef.current) {
        mountedRef.current = true;
        setMounted(true);
      }
      if (reducedMotion) {
        updateState('open');
      } else {
        updateState('entering');
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (generationRef.current === generation && presentRef.current) updateState('open');
        });
      }
    } else if (mountedRef.current) {
      if (reducedMotion) {
        unmount();
      } else {
        updateState('closing');
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (generationRef.current === generation && !presentRef.current) unmount();
        }, exitMs + 50);
      }
    }

    return clearPending;
  }, [clearPending, exitMs, present, reducedMotion, unmount, updateState]);

  const completeExit = useCallback((event?: PresenceEndEvent) => {
    if (event && event.target !== event.currentTarget) return;
    if (presentRef.current || stateRef.current !== 'closing') return;
    unmount();
  }, [unmount]);

  return { mounted, state, completeExit };
}
```

- [ ] **Step 4: Run tests and fix only lifecycle defects**

Run: `npm test -- src/hooks/useReducedMotion.test.tsx src/hooks/usePresence.test.tsx`

Expected: all tests pass, including Strict Mode and rapid reopen. If the effect cleanup cancels a newly scheduled timeout, inspect dependency identity rather than weakening the assertions.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/hooks/usePresence.ts src/hooks/usePresence.test.tsx
git commit -m "feat(ui): add motion presence lifecycle"
```

### Task 4: Coordinate CSS And JavaScript Reduced Motion

**Files:**
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/styles/workbench.css:4716-4725`

**Interfaces:**
- Consumes `REDUCED_MOTION_QUERY` and `DEFAULT_PRESENCE_EXIT_MS`.
- Produces the global closing interaction guard consumed by every Presence root.

- [ ] **Step 1: Add failing source contracts**

Import the two constants and add assertions that:

```ts
expect(DEFAULT_PRESENCE_EXIT_MS).toBe(140);
expect(tokens).toMatch(/--motion-exit:\s*140ms\s*;/);
expect(workbench).toContain(`@media ${REDUCED_MOTION_QUERY}`);
expect(workbench).toMatch(/animation-duration:\s*0s\s*!important/);
expect(workbench).toMatch(/animation-delay:\s*0s\s*!important/);
expect(workbench).toMatch(/transition-duration:\s*0s\s*!important/);
expect(workbench).toMatch(/transition-delay:\s*0s\s*!important/);
expect(workbench).not.toContain('0.01ms');
expect(workbench).toMatch(/\[data-motion-state=['"]closing['"]\][^{]*\{[^}]*pointer-events:\s*none/);
expect(workbench).not.toMatch(/transition\s*:\s*all\b/);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/styles/tokens.test.ts`

Expected: FAIL for both delay resets, `0s` durations, and the absent closing selector.

- [ ] **Step 3: Replace the active reduced-motion block**

```css
[data-motion-state='closing'] {
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  html:focus-within {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
}
```

- [ ] **Step 4: Run the contract and hook suites**

Run: `npm test -- src/styles/tokens.test.ts src/hooks/useReducedMotion.test.tsx src/hooks/usePresence.test.tsx`

Expected: all tests pass.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "feat(ui): coordinate reduced motion behavior"
```

### Task 5: Unify Active Status Loops

**Files:**
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/styles/workbench.css:466-473,2191-2205,4555-4562,4691-4701,5998-6008`

**Interfaces:**
- Consumes `--motion-loop-spin` and `--motion-loop-pulse` from Task 1.
- Preserves all existing component class names and render conditions.

- [ ] **Step 1: Add failing loop contracts**

Assert that the four active selector blocks use only canonical names and tokens:

```ts
expect(workbench).toMatch(/\.loading-spinner\s*\{[^}]*animation:\s*spin var\(--motion-loop-spin\) linear infinite/);
expect(workbench).toMatch(/\.thinking::before\s*\{[^}]*animation:\s*pulse var\(--motion-loop-pulse\) ease-in-out infinite/);
expect(workbench).toMatch(/\.plan-step-spinner\s*\{[^}]*animation:\s*spin var\(--motion-loop-spin\) linear infinite/);
expect(workbench).toMatch(/\.kbd\.rec\s*\{[^}]*animation:\s*pulse var\(--motion-loop-pulse\) ease-in-out infinite/);
expect(workbench).not.toMatch(/@keyframes\s+plan-spin/);
expect(workbench).not.toMatch(/@keyframes\s+settings-kbd-pulse/);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/styles/tokens.test.ts`

Expected: FAIL on the four hardcoded durations and two duplicate keyframes.

- [ ] **Step 3: Repoint the existing selectors**

Use these declarations in their existing blocks:

```css
animation: spin var(--motion-loop-spin) linear infinite;
```

for `.loading-spinner` and `.plan-step-spinner`, and:

```css
animation: pulse var(--motion-loop-pulse) ease-in-out infinite;
```

for `.thinking::before` and `.kbd.rec`. Delete only `@keyframes plan-spin` and `@keyframes settings-kbd-pulse`; retain canonical `spin` and `pulse`.

- [ ] **Step 4: Run the style and affected component tests**

Run: `npm test -- src/styles/tokens.test.ts src/components/PlanCard.test.tsx src/components/settings/SettingsShortcutsPanel.test.tsx`

Expected: all tests pass; component activity conditions remain unchanged.

- [ ] **Step 5: Commit only if explicitly requested**

```bash
git add src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "refactor(ui): unify active motion loops"
```

### Task 6: Foundation Quality Gate

**Files:**
- Review only: all files changed by Tasks 1-5.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/hooks/useReducedMotion.test.tsx src/hooks/usePresence.test.tsx src/styles/tokens.test.ts src/components/PlanCard.test.tsx src/components/settings/SettingsShortcutsPanel.test.tsx
```

Expected: all focused tests pass with no timer, `act`, or listener-leak warnings.

- [ ] **Step 2: Run repository quality gates**

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: every command exits `0`. These match `.github/workflows/release.yml:21-28`.

- [ ] **Step 3: Review the diff against the spec**

Confirm:

```text
No package dependency changed.
No legacy stylesheet changed.
No component business state changed.
Reduced motion directly completes Presence.
Only the four active loops changed behavior.
```

- [ ] **Step 4: Commit the completed batch only if explicitly requested**

```bash
git add src/hooks/useReducedMotion.ts src/hooks/useReducedMotion.test.tsx src/hooks/usePresence.ts src/hooks/usePresence.test.tsx src/styles/grounded-tokens.css src/styles/workbench.css src/styles/tokens.test.ts
git commit -m "feat(ui): establish motion foundation"
```
