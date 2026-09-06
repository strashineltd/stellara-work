# AI Browser Round 2 Implementation Plan (真多 Tab + 观察窗接入 + 快照刷新/链接安全)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the built-in AI browser's multi-tab real (per-tab hidden windows), mount the observation panel beside chat with auto-expand, refresh snapshots on same-tab events, and harden markdown links.

**Architecture:** `BrowserService` switches from one-window-per-session to one-window-per-tab (`Map<tabId, window>` + `activeTabs: Map<sessionId, tabId>`), TabPool reports evicted tabs so their windows get destroyed. MainView collects only `browser_*` stream events into `browserEvents` and mounts `BrowserTab` beside ChatStream with auto-expand. BrowserTab refreshes snapshots on `browser_snapshot` event ticks and follows the service's active tab. MarkdownView gains protocol-checked links + optional `onAnchorClick`.

**Tech Stack:** Electron 43, TypeScript, React 19, Vitest + jsdom, existing `BrowserService`/`TabPool`/`BrowserTab`/`MarkdownView`.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-browser-round2-design.md`

## Global Constraints

- No new dependencies; no new IPC channels (reuse `chat-stream`, `browser:list`, `browser:getSnapshot`).
- Window count = tab count ≤ 5; every tab gets its own hidden BrowserWindow; partitions stay per-session (`persist:stellara-browser-{sessionId}`).
- All `browser_*` tool behavior, SSRF chain, untrusted markers, and approval semantics from round 1 must remain unchanged.
- TDD: failing test first (RED), minimal implementation, GREEN; run `npm test -- <file>` + `npm run typecheck` per task.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Modify `electron/browser/tabs.ts`: `TabPool.create` returns `{ tab, evicted? }`.
- Modify `electron/browser/tabs.test.ts`: adapt to new return shape + evicted assertions.
- Modify `electron/browser/service.ts`: per-tab windows, `activeTabs`, per-tab `lastDomain`, tabId→window resolution, eviction destroys windows, `stop()` targets active tab.
- Modify `electron/browser/service.test.ts`: adapt helpers (window needs `destroy`), add per-tab mapping/evict/close/select tests.
- Modify `shared/ipc.ts`: `ElectronAPI.browser.list` return items gain `active?: boolean`.
- Modify `electron/main.ts`: `browser:list` handler maps active flag from `activeTabs`.
- Modify `src/components/BrowserTab.tsx`: export `isBrowserStreamEvent`; snapshotTick refresh; active-tab follow + manual override; pass `onAnchorClick` to MarkdownView.
- Modify `src/components/BrowserTab.test.tsx`: snapshotTick + active follow + manual override tests.
- Modify `src/components/MarkdownView.tsx`: protocol-safe `a` rendering + optional `onAnchorClick`.
- Modify `src/components/MarkdownView.test.tsx`: protocol + callback tests.
- Modify `src/components/MainView.tsx`: `browserEvents` collection, `browserPanelOpen` auto-expand, mount `BrowserTab`.

---

### Task 1: TabPool Reports Evicted Tabs

**Files:**
- Modify: `electron/browser/tabs.ts:7-14`
- Test: `electron/browser/tabs.test.ts`

**Interfaces:**
- Consumes: existing `Tab` interface.
- Produces: `TabPool.create(sessionId, url): { tab: Tab; evicted?: Tab }` — consumed by Task 2's service to destroy evicted windows.

- [ ] **Step 1: Write the failing test**

```ts
// append to electron/browser/tabs.test.ts
it('create returns the evicted tab when over capacity', () => {
  const p = new TabPool(2);
  const a = p.create('s1', 'https://a.com/');
  const b = p.create('s1', 'https://b.com/');
  const c = p.create('s1', 'https://c.com/');
  expect(a.tab.url).toBe('https://a.com/');
  expect(b.tab.url).toBe('https://b.com/');
  expect(c.evicted?.url).toBe('https://a.com/');
  expect(p.list('s1')).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- electron/browser/tabs.test.ts`
Expected: FAIL — `c.evicted` is `undefined` (and existing tests fail: `create` no longer returns `Tab` directly).

- [ ] **Step 3: Minimal implementation**

Replace `TabPool.create` (and its loop) with:

```ts
create(sessionId: string, url: string): { tab: Tab; evicted?: Tab } {
  const arr = this.tabs.get(sessionId) ?? [];
  const tab: Tab = { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, title: url, sessionId, updatedAt: Date.now() };
  arr.push(tab);
  let evicted: Tab | undefined;
  while (arr.length > this.max) {
    evicted = arr.shift();
  }
  this.tabs.set(sessionId, arr);
  return { tab, evicted };
}
```

- [ ] **Step 4: Update existing tests to the new shape and verify GREEN**

In `electron/browser/tabs.test.ts`, change every `const x = p.create(...)` to `const x = p.create(...).tab` (all existing usages). Also update the LRU test:

```ts
it('LRU evicts oldest beyond 5', () => {
  const p = new TabPool(5);
  for (let i = 0; i < 6; i++) p.create('s1', `https://ex.com/${i}`);
  expect(p.list('s1')).toHaveLength(5);
  expect(p.list('s1')[0]!.url).toBe('https://ex.com/1');
});
```

Run: `npm test -- electron/browser/tabs.test.ts`
Expected: all PASS. Run `npm run typecheck`.

---

### Task 2: BrowserService Per-Tab Windows

**Files:**
- Modify: `electron/browser/service.ts` (state maps, `getOrCreateWindow`, `ensureTab`, all `do*`, `doTabs`, `doStop`)
- Test: `electron/browser/service.test.ts`

**Interfaces:**
- Consumes: Task 1's `{ tab, evicted? }` from `TabPool.create`.
- Produces: service internals `activeTabs: Map<sessionId, tabId>` (read by Task 3's `browser:list` handler via `browserService.activeTabFor(sessionId): string | undefined`), and `BrowserService.list(sessionId): Tab[]` returning tabs with `active` flag.

- [ ] **Step 1: Write failing per-tab tests**

Append to `electron/browser/service.test.ts`:

```ts
describe('per-tab windows', () => {
  function fakeWin(id: string) {
    const wc = makeWebContents().wc;
    return { id, isDestroyed: () => false, destroy: vi.fn(), webContents: wc };
  }

  it('create makes a tab active and gives it its own window; select switches active', async () => {
    const pool = new TabPool();
    const wins: any[] = [];
    const svc = new BrowserService(pool, { createWindow: () => { const w = fakeWin(`w${wins.length}`); wins.push(w); return w; } });
    const c1 = await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    expect(c1.ok).toBe(true);
    const c2 = await svc.get('s').tabs({ op: 'create', url: 'https://b.com/' });
    expect(c2.ok).toBe(true);
    expect(wins).toHaveLength(2);
    expect(svc.activeTabFor('s')).toBe(pool.list('s')[1]!.id);
    await svc.get('s').tabs({ op: 'select', tabId: pool.list('s')[0]!.id });
    expect(svc.activeTabFor('s')).toBe(pool.list('s')[0]!.id);
  });

  it('eviction destroys the evicted tab window', async () => {
    const pool = new TabPool(2);
    const destroyed: string[] = [];
    const svc = new BrowserService(pool, { createWindow: () => { const w = fakeWin(`w${destroyed.length}`); w.destroy = vi.fn(() => destroyed.push(w.id)); return w; } });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.get('s').tabs({ op: 'create', url: 'https://b.com/' });
    await svc.get('s').tabs({ op: 'create', url: 'https://c.com/' });
    expect(destroyed).toEqual(['w0']);
  });

  it('close destroys the window and moves active to the newest remaining tab', async () => {
    const pool = new TabPool();
    const destroyed: string[] = [];
    const svc = new BrowserService(pool, { createWindow: () => { const w = fakeWin(`w${destroyed.length}`); w.destroy = vi.fn(() => destroyed.push(w.id)); return w; } });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    const t2 = pool.list('s')[1]!;
    await svc.get('s').tabs({ op: 'create', url: 'https://b.com/' });
    await svc.get('s').tabs({ op: 'close', tabId: t2.id });
    expect(destroyed).toEqual(['w1']);
    expect(svc.activeTabFor('s')).toBe(pool.list('s')[0]!.id);
  });

  it('snapshot of a closed tab returns honest error', async () => {
    const pool = new TabPool();
    const svc = new BrowserService(pool, { createWindow: () => fakeWin('w') });
    const t = (await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' })) as any;
    const tabId = (JSON.parse(t.output) as { id: string }).id;
    await svc.get('s').tabs({ op: 'close', tabId });
    const r = await svc.get('s').snapshot({ tabId });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Tab 不存在');
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/browser/service.test.ts`
Expected: FAIL — `activeTabFor` missing, `tabs create` doesn't create windows, eviction doesn't destroy.

- [ ] **Step 3: Minimal implementation**

In `electron/browser/service.ts`:

1. Replace state maps:

```ts
export class BrowserService {
  private windows = new Map<string, any>();        // tabId -> BrowserWindow
  private activeTabs = new Map<string, string>();  // sessionId -> tabId
  private lastDomain = new Map<string, string>();  // tabId -> hostname
  private knownIds = new Map<string, Set<string>>();
```

2. Add to the class (before `get`):

```ts
activeTabFor(sessionId: string): string | undefined {
  return this.activeTabs.get(sessionId);
}

list(sessionId: string): Array<{ id: string; url: string; title: string; active?: boolean }> {
  const active = this.activeTabs.get(sessionId);
  return this.tabPool.list(sessionId).map((t) => ({ ...t, active: t.id === active }));
}
```

3. Change `getOrCreateWindow(sessionId, tabId)` — key by tabId, destroy-tracking for eviction:

```ts
private getOrCreateWindow(sessionId: string, tabId: string): any {
  const existing = this.windows.get(tabId);
  if (existing && typeof existing.isDestroyed === 'function' && !existing.isDestroyed()) {
    return existing;
  }
  let win: any;
  if (this.opts.createWindow) {
    win = this.opts.createWindow();
  } else {
    const electron = lazyElectron();
    win = new electron.BrowserWindow({
      show: false,
      webPreferences: {
        partition: `persist:stellara-browser-${sanitizeSessionId(sessionId)}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    win.webContents.session.on('will-download', (e: any) => e.preventDefault());
  } catch { /* ignore */ }
  win.webContents.on('will-navigate', (e: any, url: string) => {
    if (!isAllowedBrowserUrl(url).ok) { e.preventDefault(); return; }
    void validateUrl(url).then((v) => { if (!v.ok) { try { win.webContents.stop(); } catch { /* ignore */ } } });
  });
  win.webContents.on('will-redirect', (e: any, url: string) => {
    if (!isAllowedBrowserUrl(url).ok) { e.preventDefault(); return; }
    void validateUrl(url).then((v) => { if (!v.ok) { try { win.webContents.stop(); } catch { /* ignore */ } } });
  });
  win.webContents.on('did-redirect-navigation', (_e: any, url: string) => {
    void validateUrl(url).then((v) => { if (!v.ok) { try { win.webContents.stop(); } catch { /* ignore */ } } });
  });
  this.windows.set(tabId, win);
  return win;
}
```

4. Replace `ensureTab` — creates tab + window, handles eviction, marks active:

```ts
private ensureTab(sessionId: string, tabId: string | undefined, urlForCreate: string): string {
  if (tabId) {
    this.tabPool.select(sessionId, tabId);
    this.activeTabs.set(sessionId, tabId);
    return tabId;
  }
  const { tab, evicted } = this.tabPool.create(sessionId, urlForCreate);
  if (evicted) {
    const w = this.windows.get(evicted.id);
    if (w && typeof w.destroy === 'function') {
      try { w.destroy(); } catch { /* ignore */ }
    }
    this.windows.delete(evicted.id);
    this.knownIds.delete(evicted.id);
    this.lastDomain.delete(evicted.id);
    if (this.activeTabs.get(sessionId) === evicted.id) {
      const rest = this.tabPool.list(sessionId);
      this.activeTabs.set(sessionId, rest.length ? rest[rest.length - 1]!.id : undefined!);
      if (!rest.length) this.activeTabs.delete(sessionId);
    }
  }
  this.getOrCreateWindow(sessionId, tab.id);
  this.activeTabs.set(sessionId, tab.id);
  return tab.id;
}
```

5. `doNavigate`: replace `const win = this.getOrCreateWindow(sessionId)` with `const win = this.getOrCreateWindow(sessionId, tabId)`, and `this.lastDomain.set(tabId, host)` instead of session key.

6. `doSnapshot` / `doExtract` / `doScreenshot` / `doAct` / `doExecJs`: replace `const win = this.getOrCreateWindow(sessionId)` with `const win = this.getOrCreateWindow(sessionId, args.tabId)`.

7. `doTabs` — full replacement:

```ts
private async doTabs(
  sessionId: string,
  args: BrowserTabsArgs,
  _ctx?: ToolExecutionContext,
): Promise<ToolResult> {
  try {
    switch (args.op) {
      case 'list':
        return { ok: true, output: JSON.stringify(this.list(sessionId)) };
      case 'create': {
        const url = (args.url ?? 'about:blank').trim() || 'about:blank';
        if (url !== 'about:blank') {
          const gate = isAllowedBrowserUrl(url);
          if (!gate.ok) return { ok: false, output: '', error: gate.error ?? 'URL 不允许' };
        }
        const tabId = this.ensureTab(sessionId, undefined, url);
        const tab = this.tabPool.select(sessionId, tabId);
        return { ok: true, output: JSON.stringify(tab) };
      }
      case 'close': {
        if (!args.tabId) return { ok: false, output: '', error: '缺少 tabId' };
        this.tabPool.select(sessionId, args.tabId);
        const win = this.windows.get(args.tabId);
        if (win && typeof win.destroy === 'function') {
          try { win.destroy(); } catch { /* ignore */ }
        }
        this.windows.delete(args.tabId);
        this.knownIds.delete(args.tabId);
        this.lastDomain.delete(args.tabId);
        this.tabPool.close(sessionId, args.tabId);
        if (this.activeTabs.get(sessionId) === args.tabId) {
          const rest = this.tabPool.list(sessionId);
          if (rest.length) this.activeTabs.set(sessionId, rest[rest.length - 1]!.id);
          else this.activeTabs.delete(sessionId);
        }
        return { ok: true, output: `已关闭: ${args.tabId}` };
      }
      case 'select': {
        if (!args.tabId) return { ok: false, output: '', error: '缺少 tabId' };
        const t = this.tabPool.select(sessionId, args.tabId);
        this.activeTabs.set(sessionId, args.tabId);
        return { ok: true, output: JSON.stringify(t) };
      }
      default:
        return { ok: false, output: '', error: `未知 op: ${String((args as { op?: unknown }).op)}` };
    }
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
```

8. `doStop`:

```ts
private doStop(sessionId: string): void {
  const tabId = this.activeTabs.get(sessionId);
  if (!tabId) return;
  const win = this.windows.get(tabId);
  try {
    win?.webContents?.stop?.();
  } catch { /* ignore */ }
}
```

9. In `service.test.ts` helper `makeWindow`, add `destroy: vi.fn()` (return `{ isDestroyed: () => false, destroy: vi.fn(), webContents: wc }`).

10. Update existing service tests broken by the tab-window change: tests that call `svc.get('s').snapshot({ tabId: tab.id })` with a `pool.create` tab now need a window for that tab — replace bare `pool.create('s', url)` with `svc.get('s').tabs({ op: 'create', url })` and parse the tab id from output, or add a small helper `async function createTab(svc: BrowserService, pool: TabPool, url: string): Promise<string>` that calls `tabs create` and returns the id. Apply it across existing describes (approval wiring, SSRF, markers, act, screenshot, hardening, tables).

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- electron/browser/service.test.ts electron/browser/tabs.test.ts`
Expected: all PASS. Run `npm run typecheck`. Confirm `index.ts` compiles unchanged (service method signatures stable).

---

### Task 3: browser:list Carries Active Flag

**Files:**
- Modify: `shared/ipc.ts` (`ElectronAPI.browser.list` return type)
- Modify: `electron/main.ts` (`browser:list` handler)
- Test: `electron/main.ts` has no unit tests — covered by typecheck + Task 4 UI tests.

**Interfaces:**
- Consumes: `browserService.list(sessionId)` (Task 2) and `browserService.activeTabFor(sessionId)`.
- Produces: `window.electronAPI.browser.list(sessionId)` → `Array<{ id; url; title; active?: boolean }>` consumed by Task 4/5 BrowserTab.

- [ ] **Step 1: Change the shared type (compile-time RED via a quick check)**

In `shared/ipc.ts`, change:

```ts
browser: {
  list: (sessionId: string) => Promise<Array<{ id: string; url: string; title: string }>>;
```

to:

```ts
browser: {
  list: (sessionId: string) => Promise<Array<{ id: string; url: string; title: string; active?: boolean }>>;
```

- [ ] **Step 2: Update the main handler**

In `electron/main.ts`, the `browser:list` handler currently returns `browserService.get(sessionId).tabs({ op: 'list' })`-derived data. Replace its body to delegate to the new pure method:

```ts
handle('browser:list', async (_e, sessionId: string) => {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('会话无效');
  const { browserService } = await import('./browser/service');
  return browserService.list(sessionId);
});
```

Remove any JSON-parse of `tabs op:list` output in that handler; `browserService.list` returns the serializable array directly.

- [ ] **Step 3: Verify typecheck + renderer contract**

Run: `npm run typecheck` — must pass (preload and dev-preview mock must satisfy the widened return type; `src/dev-preview.ts` browser.list stub returns `[]`, which still typechecks).

Expected: clean.

---

### Task 4: MainView Collects browser Events + Mounts Panel with Auto-Expand

**Files:**
- Modify: `src/components/BrowserTab.tsx` (export `isBrowserStreamEvent`)
- Modify: `src/components/MainView.tsx`
- Test: `src/components/BrowserTab.test.tsx` (auto-expand covered here via a wrapper harness in Task 5; MainView's own tests are in `src/components/MainView.test.tsx` — add collection coverage)

**Interfaces:**
- Consumes: `ChatStreamEvent` (from `chat.start`), `BrowserTab` props `{ sessionId, streamId, events }`.
- Produces: MainView passes `browserEvents` + `streamId` + `activeSessionId` to `<BrowserTab>`; exported `isBrowserStreamEvent` reused.

- [ ] **Step 1: Export the event filter**

In `src/components/BrowserTab.tsx`, change `function isBrowserStreamEvent(...)` to `export function isBrowserStreamEvent(...)`.

- [ ] **Step 2: Write failing MainView test for event collection**

Append to `src/components/MainView.test.tsx` (follow the file's existing harness — check how it mocks `window.electronAPI.chat.start` and renders; reuse the same `render` helper):

```tsx
it('collects browser_* stream events into browserEvents and mounts the panel', async () => {
  const started = (window as any).electronAPI.chat.start;
  started.mockImplementation(async () => ({
    streamId: 'st1',
    events: (async function* () {
      yield { type: 'tool_call', toolCall: { id: 'c1', type: 'function', function: { name: 'browser_navigate', arguments: '{"url":"https://ex.com"}' } } };
      yield { type: 'tool_result', toolResult: { name: 'browser_navigate', result: { ok: true, output: 'ok' } } };
    })(),
  }));
  // render MainView with a session selected, drive send, then:
  // expect container.querySelector('.browser-tab') to exist (panel auto-expanded)
});
```

Adjust to the existing `MainView.test.tsx` harness (state/session setup, send flow). Expected RED: `.browser-tab` absent.

- [ ] **Step 3: Minimal implementation in MainView**

Add state near other stream state:

```tsx
const [browserEvents, setBrowserEvents] = useState<ChatStreamEvent[]>([]);
const [browserPanelOpen, setBrowserPanelOpen] = useState(false);
const browserPanelDismissedRef = useRef(false);
```

In `handleSend` (or the equivalent function that calls `chat.start`), before starting the stream: reset

```tsx
setBrowserEvents([]);
setBrowserPanelOpen(false);
browserPanelDismissedRef.current = false;
```

Inside the `for await (const ev of result.events)` loop, right after `applyStreamEventToEntries`:

```tsx
if (isBrowserStreamEvent(ev)) {
  setBrowserEvents((prev) => [...prev, ev]);
  if (!browserPanelDismissedRef.current) setBrowserPanelOpen(true);
}
```

In the tasks render fragment, immediately before `<ChatStream>`:

```tsx
{browserPanelOpen && activeSessionId && (
  <BrowserTab sessionId={activeSessionId} streamId={streamId} events={browserEvents} onDismiss={() => { browserPanelDismissedRef.current = true; setBrowserPanelOpen(false); }} />
)}
```

Import `BrowserTab` and `isBrowserStreamEvent` from `./BrowserTab`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/components/MainView.test.tsx src/components/BrowserTab.test.tsx`
Expected: PASS. Run `npm run typecheck`.

---

### Task 5: BrowserTab Snapshot Tick + Active Follow + Dismiss

**Files:**
- Modify: `src/components/BrowserTab.tsx`
- Modify: `src/components/BrowserTab.test.tsx`

**Interfaces:**
- Consumes: `browserEvents` (Task 4), `browser.list` with `active` flag (Task 3).
- Produces: props `{ sessionId, streamId, events, onDismiss? }`; snapshot refreshes on same-tab `browser_snapshot` ticks; active tab follows service unless user manually selected this round.

- [ ] **Step 1: Write failing tests**

Append to `src/components/BrowserTab.test.tsx`:

```tsx
it('refreshes snapshot when a browser_snapshot event arrives for the same tab', async () => {
  const getSnapshot = vi.fn().mockResolvedValue({ markdown: '# v1' });
  (window as any).electronAPI.browser.getSnapshot = getSnapshot;
  const { unmount, container } = render(
    <BrowserTab sessionId="s" streamId="st" events={[{ type: 'tool_result', toolResult: { name: 'browser_snapshot', result: { ok: true, output: 'ok' } } }]} />,
  );
  await act(async () => {});
  await act(async () => {});
  expect(getSnapshot).toHaveBeenCalledTimes(2);
  unmount();
});

it('follows the active tab from browser.list unless user selected one manually', async () => {
  const TABS2 = [
    { id: 't1', url: 'https://a.com', title: 'a' },
    { id: 't2', url: 'https://b.com', title: 'b', active: true },
  ];
  (window as any).electronAPI.browser.list = vi.fn().mockResolvedValue(TABS2);
  const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
  await act(async () => {});
  const activeBtn = container.querySelector('.browser-tab__tab.active');
  expect(activeBtn?.textContent).toContain('b.com');
  unmount();
});

it('calls onDismiss when the dismiss button is clicked', async () => {
  const onDismiss = vi.fn();
  const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" onDismiss={onDismiss} />);
  await act(async () => {});
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('收起'));
  fireClick(btn ?? null);
  expect(onDismiss).toHaveBeenCalled();
  unmount();
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/BrowserTab.test.tsx`
Expected: FAIL — `getSnapshot` called once (no tick), active not followed, no dismiss button.

- [ ] **Step 3: Minimal implementation**

In `src/components/BrowserTab.tsx`:

1. Props gain `onDismiss?: () => void`.
2. Add tick + user-selection tracking:

```tsx
const snapshotTick = useMemo(
  () => browserEvents.filter((ev) => ev.type === 'tool_result' && ev.toolResult?.name === 'browser_snapshot').length,
  [browserEvents],
);
const userSelectedRef = useRef(false);
```

3. Tab-list effect: after setting tabs, follow active unless the user selected this round:

```tsx
useEffect(() => {
  let cancelled = false;
  window.electronAPI?.browser?.list(sessionId)
    .then((list) => {
      if (cancelled) return;
      const next = list ?? [];
      setTabs(next);
      if (userSelectedRef.current) return;
      const active = next.find((t) => t.active);
      if (active) setSelectedId(active.id);
      else setSelectedId((prev) => prev ?? next[0]?.id ?? null);
    })
    .catch(() => { if (!cancelled) setTabs([]); });
  return () => { cancelled = true; };
}, [sessionId, browserEventCount]);
```

4. Tab click sets `userSelectedRef.current = true` before `setSelectedId`.
5. Snapshot effect deps become `[sessionId, activeId, snapshotTick]`.
6. In the actions row, add a dismiss button before 中断:

```tsx
{onDismiss && (
  <button type="button" className="btn btn-secondary" onClick={onDismiss}>收起</button>
)}
```

7. Pass `onAnchorClick` to `<MarkdownView>`:

```tsx
<MarkdownView content={snapshot} onAnchorClick={handleAnchorClick} />
```

with:

```tsx
function handleAnchorClick(href: string) {
  try {
    const u = new URL(href, window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      window.open(u.href, '_blank');
    }
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/components/BrowserTab.test.tsx`
Expected: PASS. Run `npm run typecheck`.

---

### Task 6: MarkdownView Protocol-Safe Links + onAnchorClick

**Files:**
- Modify: `src/components/MarkdownView.tsx:37-44`
- Test: `src/components/MarkdownView.test.tsx`

**Interfaces:**
- Consumes: `MarkdownViewProps`.
- Produces: prop `onAnchorClick?(href: string): void`; `a` renders as `<span>` for non-`http:/https:/mailto:` hrefs; consumed by Task 5 BrowserTab.

- [ ] **Step 1: Write failing tests**

Append to `src/components/MarkdownView.test.tsx`:

```tsx
it('renders dangerous-protocol links as plain text', () => {
  const { container, unmount } = render(<MarkdownView content="[x](javascript:alert(1))" />);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).toContain('x');
  unmount();
});

it('keeps http(s)/mailto links as anchors', () => {
  const { container, unmount } = render(<MarkdownView content="[site](https://ex.com) [mail](mailto:a@b.c)" />);
  expect(container.querySelectorAll('a').length).toBe(2);
  unmount();
});

it('calls onAnchorClick when a link is clicked', () => {
  const onClick = vi.fn();
  const { container, unmount } = render(
    <MarkdownView content="[site](https://ex.com)" onAnchorClick={onClick} />,
  );
  const a = container.querySelector('a')!;
  act(() => { a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(onClick).toHaveBeenCalledWith('https://ex.com');
  unmount();
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/MarkdownView.test.tsx`
Expected: FAIL — `javascript:` renders an `<a>`, no `onAnchorClick`.

- [ ] **Step 3: Minimal implementation**

In `src/components/MarkdownView.tsx`:

1. Extend props:

```tsx
interface MarkdownViewProps {
  content: string;
  workDir?: string;
  onAnchorClick?: (href: string) => void;
}
```

2. Extract a safe-link renderer and replace the `a` component:

```tsx
const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function resolveHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, window.location.href);
    return SAFE_LINK_PROTOCOLS.includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
```

```tsx
a({ children, href, ...props }: { children?: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const safe = resolveHref(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  return (
    <a
      {...props}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (onAnchorClick) {
          e.preventDefault();
          onAnchorClick(safe);
        }
      }}
    >
      {children}
    </a>
  );
},
```

3. Update function signature to accept `onAnchorClick`:

```tsx
export function MarkdownView({ content, workDir, onAnchorClick }: MarkdownViewProps) {
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/components/MarkdownView.test.tsx src/components/BrowserTab.test.tsx`
Expected: PASS. Run `npm run typecheck`. Verify existing `MainView.test.tsx` / `WorkspacePanel.test.tsx` still green (MarkdownView used broadly):

Run: `npm test` — full suite must pass.

---

### Task 7: Full Verification + Changelog

**Files:**
- Modify: `CHANGELOG.md` (Unreleased entry)

- [ ] **Step 1: Run full gates**

Run: `npm test`
Expected: all PASS (single-file serial per vitest config).

Run: `npm run typecheck`
Expected: clean for both tsconfigs.

- [ ] **Step 2: Manual verification notes (record in report)**

- With dev app running: send a prompt that triggers `browser_navigate` → panel auto-expands beside chat showing domain badge + snapshot; switching tabs via `browser_tabs select` moves the highlight; 收起 collapses until next stream.
- `browser_tabs create` on 6 URLs evicts the oldest tab and its hidden window (verify via `browser_tabs list` count ≤ 5).
- `browser_snapshot` twice on the same tab updates the panel snapshot without switching tabs.
- A markdown link with `javascript:` href renders as plain text in chat.

- [ ] **Step 3: CHANGELOG entry**

Add under Unreleased:

`内置 AI 浏览器二期：真多 Tab（每 Tab 独立窗口）、观察窗接入聊天区并自动展开、同 Tab 快照实时刷新、Markdown 链接协议硬化`