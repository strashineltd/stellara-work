# AI Browser L3 LiveView Implementation Plan (观察窗实时画面)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Agent-controlled page live inside the observation panel via `WebContentsView`, read-only by default with a user take-over toggle, alongside the existing snapshot view.

**Architecture:** The window pool switches from hidden `BrowserWindow` to unattached `WebContentsView` (same webContents API — snapshot/act/SSRF/partitions unchanged). The service attaches at most one view to the main window's `contentView` at the panel rect the renderer reports; a read-only guard script injected in the isolated world swallows user input until take-over. UI gains a 实时画面/快照 dual-view with ResizeObserver-driven bounds.

**Tech Stack:** Electron 43 (`WebContentsView`, `contentView.addChildView`), TypeScript, React 19, Vitest + jsdom, existing BrowserService/BrowserTab patterns.

**Spec:** `docs/superpowers/specs/2026-09-07-ai-browser-l3-liveview-design.md`

## Global Constraints

- No new dependencies; Agent tool semantics (snapshot/act/extract/screenshot/exec_js), approval matrix, SSRF chain, partition isolation, cookie retention — all unchanged.
- At most one view attached at any time; attach requires `opts.getContentView` (throws `'主窗口不可用'` when missing/falsy).
- Read-only = isolated-world guard script (capture-phase stopPropagation+preventDefault on pointer/keyboard events) gated by `window.__stellaraReadonly`; Agent `executeJavaScriptInIsolatedWorld` calls are unaffected; re-inject on every `did-finish-load`.
- Live view is never the default; default stays snapshot. Detach on: view-mode switch back to snapshot, tab switch away, panel unmount/session switch, tab close/eviction.
- TDD: failing test first, RED, minimal implementation, GREEN; `npm test -- <file>` + `npm run typecheck` per task.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Modify `electron/browser/service.ts`: `WebContentsView` production branch; `setMainContentView(fn)`, `attachView(sessionId, tabId)`, `detachView()`, `setViewport(rect)`, `setUserInteraction(sessionId, tabId, enabled)`; `READONLY_GUARD_SCRIPT`; guard injection at window creation + `did-finish-load`; detach on tab close/eviction/select-follow.
- Modify `electron/browser/service.test.ts`: contentView fake + attach/detach/viewport/follow/guard tests; `makeWindow` gains `setBounds`.
- Modify `shared/ipc.ts`: `ElectronAPI.browser` gains `attachView/detachView/setViewport/setUserInteraction` + `ViewportRect` type.
- Modify `electron/main.ts`: 4 handlers + `whenReady` injects `setMainContentView(() => mainWindow?.contentView)`.
- Modify `electron/preload.ts`, `src/dev-preview.ts`: forwards/stubs.
- Modify `src/components/BrowserTab.tsx` + test: dual view (实时画面/快照), live container + ResizeObserver, take-over toggle, auto-revoke on `browser_*` tool_call.

---

### Task 1: View Pool + Attach/Detach/Viewport

**Files:**
- Modify: `electron/browser/service.ts`
- Test: `electron/browser/service.test.ts`

**Interfaces:**
- Consumes: existing `getOrCreateWindow(sessionId, tabId)`, `windows` map, `activeTabs`, `doTabs`, `ensureTab` eviction.
- Produces: `setMainContentView(fn: () => unknown): void`; `attachView(sessionId: string, tabId: string): void` (throws `'Tab 不存在'` / `'主窗口不可用'`); `detachView(): void`; `setViewport(rect: ViewportRect): void` — consumed by Task 3 handlers; `makeWindow` fake gains `setBounds`.

- [ ] **Step 1: Write failing tests**

Append to `electron/browser/service.test.ts` (add `setBounds: vi.fn()` to `makeWindow`; add a `fakeContentView` helper):

```ts
function fakeContentView() {
  return { addChildView: vi.fn(), removeChildView: vi.fn() };
}

describe('live view attach/detach (L3)', () => {
  function makeLiveService contentViewOverrides?: ...) // see below
  it('attachView adds the view to contentView and applies stored viewport', async () => {...});
});
```

Concrete tests:

```ts
describe('live view attach/detach (L3)', () => {
  function liveSetup() {
    const pool = new TabPool();
    const contentView = fakeContentView();
    const svc = new BrowserService(pool, {
      createWindow: () => makeWindow(makeWebContents().wc),
      getContentView: () => contentView,
    });
    return { pool, contentView, svc };
  }

  it('attachView adds view to contentView and applies the stored viewport', async () => {
    const { svc, contentView } = liveSetup();
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const win = svc.windowsForTest().get(tabId)!;
    svc.setViewport({ x: 10, y: 20, width: 300, height: 200 });
    svc.attachView('s', tabId);
    expect(contentView.addChildView).toHaveBeenCalledWith(win);
    expect(win.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('attachView without a contentView throws 主窗口不可用', async () => {
    const pool = new TabPool();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(makeWebContents().wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    expect(() => svc.attachView('s', tabId)).toThrow('主窗口不可用');
  });

  it('detachView removes the child view', async () => {
    const { svc, contentView } = liveSetup();
    const tabId = await createTab(svc, 's', 'https://a.com/');
    svc.attachView('s', tabId);
    svc.detachView();
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);
    // 二次 detach 幂等
    svc.detachView();
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);
  });

  it('switching tabs follows the live view to the new active tab', async () => {
    const { svc, contentView } = liveSetup();
    const t1 = await createTab(svc, 's', 'https://a.com/');
    const t2 = await createTab(svc, 's', 'https://b.com/');
    svc.attachView('s', t1);
    await svc.get('s').tabs({ op: 'select', tabId: t2 });
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);
    expect(contentView.addChildView).toHaveBeenCalledTimes(2);
  });

  it('closing the attached tab detaches before destroy', async () => {
    const { svc, contentView } = liveSetup();
    const tabId = await createTab(svc, 's', 'https://a.com/');
    svc.attachView('s', tabId);
    await svc.get('s').tabs({ op: 'close', tabId });
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);
  });

  it('setViewport on an attached view resizes it immediately', async () => {
    const { svc } = liveSetup();
    const tabId = await createTab(svc, 's', 'https://a.com/');
    svc.attachView('s', tabId);
    const win = svc.windowsForTest().get(tabId)!;
    svc.setViewport({ x: 0, y: 0, width: 500, height: 400 });
    expect(win.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 500, height: 400 });
  });
});
```

`windowsForTest(): Map<string, any>` — add a test accessor (same pattern as `createdPartitionsForTest`).

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/browser/service.test.ts`
Expected: FAIL — `fakeContentView`/`windowsForTest`/`attachView` missing; `makeWindow` has no `setBounds`.

- [ ] **Step 3: Minimal implementation**

In `electron/browser/service.ts`:

1. `BrowserServiceOptions` gains `getContentView?: () => any`. Class fields:

```ts
private attachedTabId?: string;
private lastViewport?: { x: number; y: number; width: number; height: number };
```

2. Public methods (after `setPartitionClearErrorHandler`):

```ts
setMainContentView(fn: () => unknown): void {
  this.opts.getContentView = fn;
}

windowsForTest(): Map<string, any> {
  return this.windows;
}

attachView(sessionId: string, tabId: string): void {
  this.tabPool.select(sessionId, tabId); // 不存在则抛 'Tab 不存在'
  const cv = this.opts.getContentView?.();
  if (!cv) throw new Error('主窗口不可用');
  this.detachInternal();
  const win = this.getOrCreateWindow(sessionId, tabId);
  if (typeof win.setBounds === 'function' && this.lastViewport) {
    win.setBounds(this.lastViewport);
  }
  cv.addChildView(win);
  this.attachedTabId = tabId;
}

detachView(): void {
  this.detachInternal();
}

private detachInternal(): void {
  if (!this.attachedTabId) return;
  const win = this.windows.get(this.attachedTabId);
  const cv = this.opts.getContentView?.();
  try {
    if (win && cv && typeof cv.removeChildView === 'function') cv.removeChildView(win);
  } catch { /* ignore */ }
  this.attachedTabId = undefined;
}

setViewport(rect: { x: number; y: number; width: number; height: number }): void {
  this.lastViewport = rect;
  if (this.attachedTabId) {
    const win = this.windows.get(this.attachedTabId);
    try { win?.setBounds?.(rect); } catch { /* ignore */ }
  }
}
```

3. `getOrCreateWindow` production branch: replace `new electron.BrowserWindow({ show: false, ... })` with:

```ts
win = new electron.WebContentsView({
  webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
});
```

(`show: false` has no meaning for a view; everything else — handlers, session capture, partition registration — stays.)

4. Follow-on select: in `doTabs` `case 'select'`, after `this.activeTabs.set(sessionId, args.tabId)` add:

```ts
if (this.attachedTabId) {
  try { this.attachView(sessionId, args.tabId); } catch { /* 主窗口不可用时保持原状 */ }
}
```

5. Detach before destroy: in `doTabs` `case 'close'` and in `ensureTab`'s eviction branch, before `win.destroy()` add:

```ts
if (this.attachedTabId === args.tabId /* 或 evicted.id */) this.detachInternal();
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/browser/service.test.ts` + `npm run typecheck`
Expected: PASS / clean (existing tests unaffected — fake windows just gain an unused `setBounds`).

---

### Task 2: Read-only Guard + Take-over

**Files:**
- Modify: `electron/browser/service.ts`
- Test: `electron/browser/service.test.ts`

**Interfaces:**
- Consumes: Task 1's view pool + `execJsInIsolatedWorld`.
- Produces: exported `READONLY_GUARD_SCRIPT: string`; `setUserInteraction(sessionId: string, tabId: string, enabled: boolean): Promise<void>` consumed by Task 3 handlers.

- [ ] **Step 1: Write failing tests**

```ts
describe('read-only guard (L3)', () => {
  it('guard script installs capture blockers gated by the flag', () => {
    expect(READONLY_GUARD_SCRIPT).toContain('__stellaraReadonly');
    for (const ev of ['mousedown', 'wheel', 'keydown', 'input']) {
      expect(READONLY_GUARD_SCRIPT).toContain(`'${ev}'`);
    }
    expect(READONLY_GUARD_SCRIPT).toContain('stopPropagation');
    expect(READONLY_GUARD_SCRIPT).toContain('preventDefault');
  });

  it('injects the guard at window creation and re-injects on did-finish-load', async () => {
    const pool = new TabPool();
    const { wc, handlers } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    await createTab(svc, 's', 'https://a.com/');
    const codes = wc.executeJavaScriptInIsolatedWorld.mock.calls.map((c: any[]) => c[1][0].code as string);
    expect(codes.some((c) => c.includes('__stellaraReadonly'))).toBe(true);
    const finish = handlers.get('did-finish-load');
    expect(finish).toBeTruthy();
    const before = wc.executeJavaScriptInIsolatedWorld.mock.calls.length;
    finish();
    await flush();
    expect(wc.executeJavaScriptInIsolatedWorld.mock.calls.length).toBeGreaterThan(before);
  });

  it('setUserInteraction flips the flag and focuses on take-over', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    wc.focus = vi.fn();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.setUserInteraction('s', tabId, true);
    const last = wc.executeJavaScriptInIsolatedWorld.mock.calls.at(-1)![1][0].code as string;
    expect(last).toContain('__stellaraReadonly = false');
    expect(wc.focus).toHaveBeenCalled();
    await svc.setUserInteraction('s', tabId, false);
    const last2 = wc.executeJavaScriptInIsolatedWorld.mock.calls.at(-1)![1][0].code as string;
    expect(last2).toContain('__stellaraReadonly = true');
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/browser/service.test.ts`
Expected: FAIL — `READONLY_GUARD_SCRIPT`/`setUserInteraction` missing; no `did-finish-load` handler.

- [ ] **Step 3: Minimal implementation**

1. Exported constant (module level, near `FORM_CONTROL_SELECTOR`):

```ts
export const READONLY_GUARD_SCRIPT = `(() => {
  if (window.__stellaraReadonlyInstalled) { window.__stellaraReadonly = true; return; }
  window.__stellaraReadonlyInstalled = true;
  window.__stellaraReadonly = true;
  const block = (e) => {
    if (!window.__stellaraReadonly) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  };
  for (const ev of ['mousedown','mouseup','mousemove','click','dblclick','contextmenu','wheel','keydown','keyup','keypress','input']) {
    document.addEventListener(ev, block, { capture: true, passive: false });
  }
})();`;
```

2. In `getOrCreateWindow`, after the SSRF hooks (before `this.windows.set`):

```ts
win.webContents.on('did-finish-load', () => {
  void this.execJsInIsolatedWorld(win, READONLY_GUARD_SCRIPT).catch(() => { /* ignore */ });
});
void this.execJsInIsolatedWorld(win, READONLY_GUARD_SCRIPT).catch(() => { /* ignore */ });
```

3. Public method:

```ts
async setUserInteraction(sessionId: string, tabId: string, enabled: boolean): Promise<void> {
  this.tabPool.select(sessionId, tabId);
  const win = this.getOrCreateWindow(sessionId, tabId);
  await this.execJsInIsolatedWorld(win, `window.__stellaraReadonly = ${enabled ? 'false' : 'true'};`);
  if (enabled && typeof win.webContents.focus === 'function') {
    try { win.webContents.focus(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/browser/service.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 3: IPC + Main Wiring

**Files:**
- Modify: `shared/ipc.ts`, `electron/main.ts`, `electron/preload.ts`, `src/dev-preview.ts`

**Interfaces:**
- Consumes: Task 1/2 service methods.
- Produces: `window.electronAPI.browser.attachView/detachView/setViewport/setUserInteraction` consumed by Task 4 UI.

- [ ] **Step 1: Shared types + preload + dev-preview**

In `shared/ipc.ts`:

```ts
export interface ViewportRect { x: number; y: number; width: number; height: number; }
```

`ElectronAPI.browser` gains:

```ts
attachView: (sessionId: string, tabId: string) => Promise<void>;
detachView: () => Promise<void>;
setViewport: (rect: ViewportRect) => Promise<void>;
setUserInteraction: (sessionId: string, tabId: string, enabled: boolean) => Promise<void>;
```

`electron/preload.ts` browser block:

```ts
attachView: (sessionId: string, tabId: string) => ipcRenderer.invoke('browser:attachView', sessionId, tabId),
detachView: () => ipcRenderer.invoke('browser:detachView'),
setViewport: (rect: ViewportRect) => ipcRenderer.invoke('browser:setViewport', rect),
setUserInteraction: (sessionId: string, tabId: string, enabled: boolean) => ipcRenderer.invoke('browser:setUserInteraction', sessionId, tabId, enabled),
```

`src/dev-preview.ts` browser stub:

```ts
attachView: async () => {},
detachView: async () => {},
setViewport: async () => {},
setUserInteraction: async () => {},
```

- [ ] **Step 2: Main handlers + whenReady injection**

In `electron/main.ts`, after the existing `browser:*` handlers:

```ts
handle('browser:attachView', async (_e, sessionId: string, tabId: string) => {
  if (typeof sessionId !== 'string' || typeof tabId !== 'string') throw new Error('参数无效');
  const { browserService } = await import('./browser/service');
  browserService.attachView(sessionId, tabId);
});

handle('browser:detachView', async () => {
  const { browserService } = await import('./browser/service');
  browserService.detachView();
});

handle('browser:setViewport', async (_e, rect: ViewportRect) => {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('参数无效');
  }
  const { browserService } = await import('./browser/service');
  browserService.setViewport(rect);
});

handle('browser:setUserInteraction', async (_e, sessionId: string, tabId: string, enabled: boolean) => {
  if (typeof sessionId !== 'string' || typeof tabId !== 'string' || typeof enabled !== 'boolean') throw new Error('参数无效');
  const { browserService } = await import('./browser/service');
  await browserService.setUserInteraction(sessionId, tabId, enabled);
});
```

Import `ViewportRect` type at main.ts top (with the other shared imports).

In `app.whenReady` (after the existing `browserService` wiring), add:

```ts
browserService.setMainContentView(() => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.contentView : undefined;
});
```

- [ ] **Step 3: Verify GREEN**

Run: `npm run typecheck` + `npm test -- shared/ipc.browser.test.ts`
Expected: clean / PASS.

---

### Task 4: BrowserTab Dual View + Take-over UI

**Files:**
- Modify: `src/components/BrowserTab.tsx`
- Modify: `src/components/BrowserTab.test.tsx`

**Interfaces:**
- Consumes: `browser.attachView/detachView/setViewport/setUserInteraction`; existing `isBrowserStreamEvent`.
- Produces: dual-view panel (default snapshot), live container + ResizeObserver bounds, take-over toggle, auto-revoke.

- [ ] **Step 1: Write failing tests**

```tsx
// ResizeObserver stub (jsdom lacks it)
class ROStub {
  static last: ROStub | null = null;
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) { this.cb = cb; ROStub.last = this; }
  observe() {}
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', ROStub);
```

```tsx
it('defaults to snapshot view and does not attach', async () => {
  const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
  await act(async () => {});
  expect(container.querySelector('.browser-tab__live')).toBeNull();
  expect((window as any).electronAPI.browser.attachView).not.toHaveBeenCalled();
  unmount();
});

it('switching to live view attaches and reports the container rect', async () => {
  const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
  await act(async () => {});
  const liveTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '实时画面')!;
  await act(async () => { liveTab.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect((window as any).electronAPI.browser.attachView).toHaveBeenCalledWith('s', 't1');
  expect((window as any).electronAPI.browser.setViewport).toHaveBeenCalled();
  // container 消失时 detach
  unmount();
  expect((window as any).electronAPI.browser.detachView).toHaveBeenCalled();
});

it('take-over toggles setUserInteraction and revokes on browser_* tool_call', async () => {
  const events = [
    { type: 'tool_call', toolCall: { id: 'c1', type: 'function', function: { name: 'browser_navigate', arguments: '{}' } } },
  ];
  const { container, rerender, unmount } = render(<BrowserTab sessionId="s" streamId="st" events={events} />);
  await act(async () => {});
  const liveTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '实时画面')!;
  await act(async () => { liveTab.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  const take = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('接管交互'))!;
  await act(async () => { take.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect((window as any).electronAPI.browser.setUserInteraction).toHaveBeenCalledWith('s', 't1', true);
  // 新的 browser_* tool_call 事件 → 自动收回
  rerender(<BrowserTab sessionId="s" streamId="st" events={[...events, { type: 'tool_call', toolCall: { id: 'c2', type: 'function', function: { name: 'browser_act', arguments: '{}' } } }]} />);
  await act(async () => {});
  expect((window as any).electronAPI.browser.setUserInteraction).toHaveBeenLastCalledWith('s', 't1', false);
  unmount();
});
```

(Adapt selectors/tab id to the harness's mocked `browser.list` — `t1` from existing `TABS`.)

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/BrowserTab.test.tsx`
Expected: FAIL — no 实时画面 button, no attach/setViewport/setUserInteraction calls.

- [ ] **Step 3: Minimal implementation**

In `src/components/BrowserTab.tsx`:

1. State: `const [viewMode, setViewMode] = useState<'snapshot' | 'live'>('snapshot');` + `const [userControl, setUserControl] = useState(false);` + `const liveRef = useRef<HTMLDivElement | null>(null);`

2. View switch in the header (next to the tabs row or above it):

```tsx
<div className="browser-tab__views">
  <button type="button" className={viewMode === 'live' ? 'active' : ''} onClick={() => setViewMode('live')}>实时画面</button>
  <button type="button" className={viewMode === 'snapshot' ? 'active' : ''} onClick={() => setViewMode('snapshot')}>快照</button>
</div>
```

3. Live effect:

```tsx
useEffect(() => {
  if (viewMode !== 'live' || !activeId) return;
  let detached = false;
  const api = window.electronAPI?.browser;
  void api?.attachView?.(sessionId, activeId)?.catch?.(() => {});
  const sendRect = () => {
    const el = liveRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      void api?.setViewport?.({ x: r.x, y: r.y, width: r.width, height: r.height })?.catch?.(() => {});
    }
  };
  sendRect();
  const ro = new ResizeObserver(sendRect);
  if (liveRef.current) ro.observe(liveRef.current);
  return () => {
    if (!detached) {
      detached = true;
      void api?.detachView?.()?.catch?.(() => {});
    }
    ro.disconnect();
  };
}, [viewMode, activeId, sessionId]);
```

4. Live container replacing snapshot block when `viewMode === 'live'`:

```tsx
{viewMode === 'live' && activeId ? (
  <div className="browser-tab__live" ref={liveRef} />
) : (
  /* 现有 snapshot + screenshot 块 */
)}
```

5. Take-over (actions row, only in live view):

```tsx
{viewMode === 'live' && activeId && (
  <button type="button" className="btn btn-secondary" onClick={() => {
    const next = !userControl;
    setUserControl(next);
    void window.electronAPI?.browser?.setUserInteraction?.(sessionId, activeId, next)?.catch?.(() => {});
  }}>
    {userControl ? '交还 Agent' : '接管交互'}
  </button>
)}
```

6. Auto-revoke (derive from events, like screenshotTick):

```tsx
const browserToolCallCount = useMemo(
  () => events.filter((ev) => ev.type === 'tool_call' && ev.toolCall?.function.name.startsWith('browser_')).length,
  [events],
);
useEffect(() => {
  if (!browserToolCallCount) return;
  setUserControl(false);
}, [browserToolCallCount]);
```

7. CSS (`workbench.css`, token-driven): `.browser-tab__views` (segmented buttons like `.browser-tab__tabs`), `.browser-tab__live` (`flex: 1 1 auto; min-height: 0; background: var(--color-bg-content);`) — the native view paints over this rect.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/components/BrowserTab.test.tsx src/components/MainView.test.tsx` + `npm run typecheck`
Expected: PASS / clean (existing snapshot tests untouched).

---

### Task 5: Full Verification + Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run full gates**

Run: `npm test` + `npm run typecheck`
Expected: all PASS / clean.

- [ ] **Step 2: Manual verification notes (record in report)**

- Dev app: agent browses a site → panel → 实时画面 → live page renders at the panel rect; resize window → view follows (ResizeObserver); switch tabs → view follows; 快照 view unchanged; take-over → click works in the page; agent's next act auto-revokes; close panel/session → view detaches (check via `main.log` absence of errors).
- Unit mapping: attach/detach/viewport/follow → service tests; guard/injection → service tests; UI wiring → BrowserTab tests; main.ts handlers → typecheck (no harness).

- [ ] **Step 3: CHANGELOG entry**

Add under Unreleased:

`AI 浏览器 L3：观察窗实时画面（WebContentsView 嵌入，默认只读 + 接管交互，实时/快照双视图）`