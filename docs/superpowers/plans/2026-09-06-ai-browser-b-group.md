# AI Browser B Group Implementation Plan (设置面板 + 数据清理 + 配额/容错)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the AI browser settings panel (execJsEnabled toggle + search provider/keys), clear browser partitions on full data wipe, and add act debounce + SPA settle + plan-mode web_search.

**Architecture:** Backend first — config field + BrowserService capabilities (partition registry, debounce, settle wait, execJs injection), then read-only browser IPC surface in main/preload, then the settings panel UI. Wipe handlers call `browserService.clearPartitions()` after existing file/DB clearing.

**Tech Stack:** Electron 43, TypeScript, React 19, Vitest + jsdom, existing config-v2/secrets/BrowserService/SettingsPanel patterns.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-browser-b-group-design.md`

## Global Constraints

- No new dependencies; Key plaintext never leaves the main process (renderer only sees `hasTavilyKey`/`hasBraveKey` booleans).
- No new protocol channels — all new IPC goes through main.ts's existing trusted `handle` wrapper and preload's `electronAPI.browser` block.
- `browserService.isExecJsEnabled()` precedence: injected value > `STELLARA_BROWSER_JS=1` env.
- act debounce: interval < 1000ms → honest error, never queue; only `browser_act` is throttled.
- SPA settle: snapshot/extract wait until `settleDelayMs` (default 2000) after the tab's last navigate; `opts.settleDelayMs` injectable (tests use 0 or fake timers).
- `planModeTools` gains `web_search`; no other planMode change.
- TDD: failing test first, RED, minimal implementation, GREEN; `npm test -- <file>` + `npm run typecheck` per task.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Modify `electron/config/config-v2.ts`: `app.browser.execJsEnabled?: boolean`.
- Modify `electron/config/config-v2.test.ts`: round-trip + legacy-undefined.
- Modify `electron/browser/service.ts`: `setExecJsEnabled`, `createdPartitions` registry + `clearPartitions()`, `lastActAt` debounce, `navDoneAt` + settle wait in snapshot/extract.
- Modify `electron/browser/service.test.ts`: partition registration/clear, debounce, settle wait (injected delay), execJs injection precedence.
- Modify `electron/agent/tools/index.ts`: `planModeTools` += `web_search`.
- Modify `shared/ipc.ts`: `ElectronAPI.browser` gains `getConfig/updateConfig/setSearchKey/clearSearchKey` + `BrowserConfigView` type.
- Modify `electron/main.ts`: 4 new `browser:*` handlers + startup execJs injection + wipe→`clearPartitions()` in `settings:clearAllData` and `settings:resetSelective('all')`.
- Modify `electron/preload.ts`: forward the 4 methods.
- Modify `src/dev-preview.ts`: stub the 4 methods.
- Create `src/components/settings/SettingsBrowserPanel.tsx` + `SettingsBrowserPanel.test.tsx`.
- Modify `src/components/SettingsPanel.tsx`: register tab `browser` (label `AI 浏览器`, icon `search`).
- Modify `CHANGELOG.md`: Unreleased entry (Task 5).

---

### Task 1: config-v2 execJsEnabled Field

**Files:**
- Modify: `electron/config/config-v2.ts` (`app.browser` block)
- Test: `electron/config/config-v2.test.ts`

**Interfaces:**
- Consumes: existing `AppConfig['app']` shape with `browser?: { searchProvider?: 'auto'|'duck'|'tavily'|'brave' }`.
- Produces: `app.browser.execJsEnabled?: boolean` consumed by Task 3's startup wiring.

- [ ] **Step 1: Write the failing round-trip test**

Append to `electron/config/config-v2.test.ts` (follow the file's existing save/load round-trip pattern used for `searchProvider`):

```ts
it('round-trips browser.execJsEnabled', async () => {
  const cfg = await loadConfig();
  cfg.app = { ...cfg.app, browser: { searchProvider: 'tavily', execJsEnabled: true } };
  await saveConfig(cfg);
  const loaded = await loadConfig();
  expect(loaded.app.browser?.execJsEnabled).toBe(true);
  expect(loaded.app.browser?.searchProvider).toBe('tavily');
});

it('keeps legacy config without browser block working', async () => {
  const legacy = await loadConfig();
  legacy.app = { ...legacy.app } as typeof legacy.app;
  delete (legacy.app as Record<string, unknown>).browser;
  await saveConfig(legacy);
  const loaded = await loadConfig();
  expect(loaded.app.browser).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/config/config-v2.test.ts`
Expected: FAIL — `execJsEnabled` missing on the type (runtime may pass via spread; assert RED via `tsc` error `TS2339 Property 'execJsEnabled' does not exist` or adjust the test to a type-level check like existing tests do).

- [ ] **Step 3: Minimal implementation**

In `electron/config/config-v2.ts`, change the `browser` field:

```ts
browser?: {
  searchProvider?: 'auto' | 'duck' | 'tavily' | 'brave';
  execJsEnabled?: boolean;
};
```

No migration, no schemaVersion bump.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/config/config-v2.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 2: BrowserService Capabilities (execJs injection, partitions, debounce, settle)

**Files:**
- Modify: `electron/browser/service.ts`
- Modify: `electron/browser/service.test.ts`
- Modify: `electron/agent/tools/index.ts` (`planModeTools` one-liner)

**Interfaces:**
- Consumes: existing `BrowserServiceOptions`, `sanitizeSessionId`, `doAct`, `doSnapshot`, `doExtract`, `doNavigate`, `withTimeout`.
- Produces:
  - `setExecJsEnabled(v: boolean | undefined): void` (stored in opts)
  - `createdPartitions` registry + `clearPartitions(): Promise<void>` — consumed by Task 3 wipe handlers
  - debounce map `lastActAt` (sessionId → ts) with `ACT_DEBOUNCE_MS = 1000`
  - settle map `navDoneAt` (tabId → ts) with `opts.settleDelayMs ?? 2000`

- [ ] **Step 1: Write failing tests**

Append to `electron/browser/service.test.ts`:

```ts
describe('browser service capabilities (B group)', () => {
  it('registers the partition name when a window is created', async () => {
    const pool = new TabPool();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(makeWebContents().wc) });
    const tabId = await createTab(svc, 'sess-7', 'https://a.com/');
    expect(svc.createdPartitionsForTest()).toContain('persist:stellara-browser-sess-7');
    expect(tabId).toBeTruthy();
  });

  it('clearPartitions clears storage and cache for every registered partition and swallows errors', async () => {
    const pool = new TabPool();
    const cleared: string[] = [];
    const cacheCleared: string[] = [];
    const fakeSession = {
      clearStorageData: vi.fn().mockImplementation(() => { cleared.push('x'); return Promise.resolve(); }),
      clearCache: vi.fn().mockImplementation(() => { cacheCleared.push('x'); return Promise.resolve(); }),
    };
    const svc = new BrowserService(pool, {
      createWindow: () => {
        const { wc } = makeWebContents();
        wc.session = fakeSession;
        return makeWindow(wc);
      },
    });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.clearPartitions();
    expect(cleared.length).toBeGreaterThan(0);
    expect(cacheCleared.length).toBeGreaterThan(0);
    // 第二个分区创建后再次清理也幂等
    await svc.clearPartitions();
  });

  it('act debounces: second act within 1s returns an honest error', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const first = await svc.get('s').act({ tabId, action: 'scroll', direction: 'down' });
    expect(first.ok).toBe(true);
    const second = await svc.get('s').act({ tabId, action: 'scroll', direction: 'down' });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('过于频繁');
  });

  it('navigate then immediate snapshot waits for settleDelayMs (injected 0 for tests)', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc), settleDelayMs: 0 });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').navigate({ tabId, url: 'https://a.com/' });
    const r = await svc.get('s').snapshot({ tabId });
    expect(r.ok).toBe(true);
  });

  it('execJsEnabled injection beats env', async () => {
    const svc = new BrowserService(new TabPool(), { execJsEnabled: true });
    expect(svc.isExecJsEnabled()).toBe(true);
    const svc2 = new BrowserService(new TabPool(), { execJsEnabled: false });
    expect(svc2.isExecJsEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/browser/service.test.ts`
Expected: FAIL — `createdPartitionsForTest` missing, `clearPartitions` missing, second act passes (no debounce), settle not waited (test with 0 passes trivially — the RED comes from the debounce + partition tests).

- [ ] **Step 3: Minimal implementation**

In `electron/browser/service.ts`:

1. Constants + options:

```ts
const ACT_DEBOUNCE_MS = 1000;
```

Add to `BrowserServiceOptions`:

```ts
settleDelayMs?: number;
```

2. Class fields:

```ts
private createdPartitions = new Set<string>();
private lastActAt = new Map<string, number>();
private navDoneAt = new Map<string, number>();
```

3. Public methods (after `setRequestApproval`):

```ts
setExecJsEnabled(v: boolean | undefined): void {
  this.opts.execJsEnabled = v;
}

createdPartitionsForTest(): string[] {
  return [...this.createdPartitions];
}

async clearPartitions(): Promise<void> {
  const electron = lazyElectron();
  for (const name of this.createdPartitions) {
    try {
      const sess = electron.session.fromPartition(name);
      await sess.clearStorageData();
      await sess.clearCache();
    } catch {
      // 单个分区清理失败不阻断其余分区
    }
  }
  this.createdPartitions.clear();
}
```

4. In `getOrCreateWindow`, right after computing the partition string (before `new electron.BrowserWindow`):

```ts
const partition = `persist:stellara-browser-${sanitizeSessionId(sessionId)}`;
this.createdPartitions.add(partition);
```

and use `partition` in the webPreferences.

5. `isExecJsEnabled` stays as-is (already reads opts then env).

6. In `doAct`, at the top (before validateActArgs):

```ts
const now = Date.now();
const last = this.lastActAt.get(sessionId) ?? 0;
if (now - last < ACT_DEBOUNCE_MS) {
  return { ok: false, output: '', error: '操作过于频繁（1 秒 1 次），请稍后重试' };
}
```

and right before the final `return { ok: true, ... }` of the success path, record `this.lastActAt.set(sessionId, Date.now())`. (Record only on success so a failed act doesn't extend the cooldown.)

7. In `doNavigate`, after `this.lastDomain.set(tabId, host)`:

```ts
this.navDoneAt.set(tabId, Date.now());
```

8. Settle helper + use in `doSnapshot` and `doExtract` (right after the `tabPool.select` line):

```ts
private async waitForSettle(sessionId: string, tabId: string): Promise<void> {
  const doneAt = this.navDoneAt.get(tabId);
  if (!doneAt) return;
  const delay = this.opts.settleDelayMs ?? 2000;
  const elapsed = Date.now() - doneAt;
  if (elapsed < delay) {
    await new Promise((r) => setTimeout(r, delay - elapsed));
  }
}
```

Call `await this.waitForSettle(sessionId, args.tabId);` in `doSnapshot` and `doExtract` after their `tabPool.select` try/catch.

9. `electron/agent/tools/index.ts` — in `planModeTools`, after the `web_fetch` exclusion comment, add:

```ts
webSearchTools[0], // web_search（只读联网搜索）
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/browser/service.test.ts electron/agent/tools/index.test.ts` + `npm run typecheck`
Expected: PASS / clean. Confirm no other tool registration changed (allTools untouched except planModeTools).

---

### Task 3: browser IPC Surface + Startup Wiring + Wipe Cleanup

**Files:**
- Modify: `shared/ipc.ts` (`BrowserConfigView` + `ElectronAPI.browser`)
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/dev-preview.ts`

**Interfaces:**
- Consumes: Task 1 config field, Task 2 `clearPartitions()` + `setExecJsEnabled`, existing `getKey/setKey/deleteKey` (ids `browser-tavily`/`browser-brave`), existing `loadConfig/saveConfig` + `broadcastSettingsChanged`.
- Produces: `window.electronAPI.browser.getConfig/updateConfig/setSearchKey/clearSearchKey` consumed by Task 4 UI.

- [ ] **Step 1: Shared types + preload + dev-preview**

In `shared/ipc.ts`, add near `BrowserConfigView` area (new export):

```ts
export interface BrowserConfigView {
  searchProvider: string;
  execJsEnabled: boolean;
  hasTavilyKey: boolean;
  hasBraveKey: boolean;
}
```

Extend `ElectronAPI.browser`:

```ts
browser: {
  list: ...;
  getSnapshot: ...;
  getConfig: () => Promise<BrowserConfigView>;
  updateConfig: (partial: { searchProvider?: string; execJsEnabled?: boolean }) => Promise<void>;
  setSearchKey: (provider: 'tavily' | 'brave', key: string) => Promise<void>;
  clearSearchKey: (provider: 'tavily' | 'brave') => Promise<void>;
};
```

In `electron/preload.ts`, add to the `browser` block:

```ts
getConfig: () => ipcRenderer.invoke('browser:getConfig'),
updateConfig: (partial: { searchProvider?: string; execJsEnabled?: boolean }) => ipcRenderer.invoke('browser:updateConfig', partial),
setSearchKey: (provider: 'tavily' | 'brave', key: string) => ipcRenderer.invoke('browser:setSearchKey', provider, key),
clearSearchKey: (provider: 'tavily' | 'brave') => ipcRenderer.invoke('browser:clearSearchKey', provider),
```

In `src/dev-preview.ts`, extend the `browser` stub:

```ts
browser: {
  list: async () => [],
  getSnapshot: async () => ({ markdown: '' }),
  getConfig: async () => ({ searchProvider: 'auto', execJsEnabled: false, hasTavilyKey: false, hasBraveKey: false }),
  updateConfig: async () => {},
  setSearchKey: async () => {},
  clearSearchKey: async () => {},
},
```

- [ ] **Step 2: Run typecheck to see RED**

Run: `npm run typecheck`
Expected: FAIL — `ElectronAPI.browser` mismatch in main.ts handlers or preload (missing channels).

- [ ] **Step 3: Main process handlers**

In `electron/main.ts`, add after the existing `browser:getSnapshot` handler:

```ts
handle('browser:getConfig', async (): Promise<BrowserConfigView> => {
  const [{ loadConfig }, { getKey }] = await Promise.all([import('./config/config-v2'), import('./config/secrets')]);
  const cfg = await loadConfig();
  const app = cfg.app ?? {};
  const keys = await Promise.all([getKey('browser-tavily'), getKey('browser-brave')]);
  return {
    searchProvider: app.browser?.searchProvider ?? 'auto',
    execJsEnabled: app.browser?.execJsEnabled ?? false,
    hasTavilyKey: !!keys[0],
    hasBraveKey: !!keys[1],
  };
});

handle('browser:updateConfig', async (_e, partial: { searchProvider?: string; execJsEnabled?: boolean }) => {
  const { loadConfig, saveConfig } = await import('./config/config-v2');
  const cfg = await loadConfig();
  const provider = partial.searchProvider;
  const execJs = partial.execJsEnabled;
  if (provider !== undefined && !['auto', 'duck', 'tavily', 'brave'].includes(provider)) {
    throw new Error('无效的搜索服务');
  }
  cfg.app = {
    ...cfg.app,
    browser: {
      ...(cfg.app.browser ?? {}),
      ...(provider !== undefined ? { searchProvider: provider as 'auto' | 'duck' | 'tavily' | 'brave' } : {}),
      ...(execJs !== undefined ? { execJsEnabled: execJs } : {}),
    },
  };
  await saveConfig(cfg);
  const { browserService } = await import('./browser/service');
  browserService.setExecJsEnabled(cfg.app.browser?.execJsEnabled);
  broadcastSettingsChanged();
});

handle('browser:setSearchKey', async (_e, provider: string, key: string) => {
  if (provider !== 'tavily' && provider !== 'brave') throw new Error('无效的搜索服务');
  if (typeof key !== 'string' || !key.trim()) throw new Error('Key 不能为空');
  const { setKey } = await import('./config/secrets');
  await setKey(`browser-${provider}`, key.trim());
  broadcastSettingsChanged();
});

handle('browser:clearSearchKey', async (_e, provider: string) => {
  if (provider !== 'tavily' && provider !== 'brave') throw new Error('无效的搜索服务');
  const { deleteKey } = await import('./config/secrets');
  await deleteKey(`browser-${provider}`);
  broadcastSettingsChanged();
});
```

Verify `BrowserConfigView` import type at top of main.ts (add to the type imports from `../shared/ipc`).

Startup wiring — in the `app.whenReady` block (where `browserService.setRequestApproval` is wired), add:

```ts
const { loadConfig } = await import('./config/config-v2');
const { browserService } = await import('./browser/service');
const cfg0 = await loadConfig();
browserService.setExecJsEnabled(cfg0.app?.browser?.execJsEnabled);
```

Wipe cleanup — in the `settings:clearAllData` handler and the `settings:resetSelective` `level === 'all'` branch, after the wipe call:

```ts
try {
  const { browserService } = await import('./browser/service');
  await browserService.clearPartitions();
} catch (e) {
  log.warn('清理浏览器分区失败（忽略）', e);
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm run typecheck` + `npm test -- shared/ipc.browser.test.ts electron/security/url-guard.test.ts`
Expected: clean / PASS.

---

### Task 4: SettingsBrowserPanel UI + Registration

**Files:**
- Create: `src/components/settings/SettingsBrowserPanel.tsx`
- Create: `src/components/settings/SettingsBrowserPanel.test.tsx`
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `window.electronAPI.browser.getConfig/updateConfig/setSearchKey/clearSearchKey`, `app.onSettingsChanged`, `BrowserConfigView`.
- Produces: panel registered as tab `browser` / label `AI 浏览器` / icon `search`.

- [ ] **Step 1: Write failing UI tests**

Create `src/components/settings/SettingsBrowserPanel.test.tsx`, following `SettingsAppPanel.test.tsx`'s harness (stub `window.electronAPI`, `createRoot` + `act` render helper, `fireClick` style dispatch):

```tsx
const BASE = { searchProvider: 'auto', execJsEnabled: false, hasTavilyKey: false, hasBraveKey: false };

function installApi(overrides: Partial<typeof BASE> = {}) {
  const config = { ...BASE, ...overrides };
  const mocks = {
    getConfig: vi.fn().mockResolvedValue(config),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    setSearchKey: vi.fn().mockResolvedValue(undefined),
    clearSearchKey: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      browser: mocks,
      app: { onSettingsChanged: vi.fn(() => () => {}) },
    },
    writable: true,
    configurable: true,
  });
  return { mocks, config };
}

it('toggles execJsEnabled via updateConfig', async () => {
  installApi();
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  await act(async () => { box?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.updateConfig).toHaveBeenCalledWith({ execJsEnabled: true });
  unmount();
});

it('saves a Tavily key via setSearchKey', async () => {
  installApi();
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  const input = container.querySelector('input[type="password"]') as HTMLInputElement | null;
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setVal?.call(input, 'tvly-123'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
  const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('保存'));
  await act(async () => { save?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.setSearchKey).toHaveBeenCalledWith('tavily', 'tvly-123');
  unmount();
});

it('shows 已配置 and clears a configured Brave key', async () => {
  installApi({ hasBraveKey: true });
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  expect(container.textContent).toContain('已配置');
  const clear = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('清除'));
  await act(async () => { clear?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.clearSearchKey).toHaveBeenCalledWith('brave');
  unmount();
});

it('warns when provider is tavily but no key is configured', async () => {
  installApi({ searchProvider: 'tavily' });
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  expect(container.textContent).toContain('尚未配置');
  unmount();
});
```

Note: `mocks` must be captured from `installApi` return (hoist via `let mocks: ...` at describe scope). Render helper identical to SettingsAppPanel.test.tsx.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/settings/SettingsBrowserPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation**

Create `src/components/settings/SettingsBrowserPanel.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { BrowserConfigView } from '../../../shared/ipc';

const PROVIDERS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'duck', label: 'DuckDuckGo（免 Key）' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave' },
];

const DEFAULT_CONFIG: BrowserConfigView = {
  searchProvider: 'auto',
  execJsEnabled: false,
  hasTavilyKey: false,
  hasBraveKey: false,
};

export function SettingsBrowserPanel({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [config, setConfig] = useState<BrowserConfigView>(DEFAULT_CONFIG);
  const [keys, setKeys] = useState<{ tavily: string; brave: string }>({ tavily: '', brave: '' });
  const [saved, setSaved] = useState<{ tavily: boolean; brave: boolean }>({ tavily: false, brave: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await window.electronAPI.browser.getConfig());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshKey]);

  function apply(patch: { searchProvider?: string; execJsEnabled?: boolean }) {
    setConfig((c) => ({ ...c, ...patch }));
    void window.electronAPI.browser.updateConfig(patch).then(() => onChanged?.()).catch((e: Error) => setError(e.message));
  }

  async function saveKey(provider: 'tavily' | 'brave') {
    const key = keys[provider].trim();
    if (!key) return;
    try {
      await window.electronAPI.browser.setSearchKey(provider, key);
      setConfig((c) => ({ ...c, [provider === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey']: true }));
      setKeys((k) => ({ ...k, [provider]: '' }));
      setSaved((s) => ({ ...s, [provider]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [provider]: false })), 2000);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function clearKey(provider: 'tavily' | 'brave') {
    try {
      await window.electronAPI.browser.clearSearchKey(provider);
      setConfig((c) => ({ ...c, [provider === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey']: false }));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const provider = config.searchProvider;
  const providerMissingKey = (provider === 'tavily' && !config.hasTavilyKey) || (provider === 'brave' && !config.hasBraveKey);

  return (
    <section className="settings-section" aria-label="AI 浏览器">
      <h3>AI 浏览器</h3>
      {error && <p className="settings-error">{error}</p>}

      <label className="settings-row">
        <span>
          <strong>允许 Agent 执行页面 JS</strong>
          <small>高风险：仅建议对可信站点开启（browser_exec_js 仍每次审批）</small>
        </span>
        <input
          type="checkbox"
          checked={config.execJsEnabled}
          onChange={(e) => apply({ execJsEnabled: e.target.checked })}
        />
      </label>

      <label className="settings-row">
        <span>
          <strong>默认搜索服务</strong>
          <small>Tavily / Brave 需在下方配置 API Key；DuckDuckGo 免 Key</small>
        </span>
        <select
          value={provider}
          onChange={(e) => apply({ searchProvider: e.target.value })}
          aria-label="搜索服务"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      {providerMissingKey && (
        <p className="settings-warning">当前搜索服务尚未配置 API Key，web_search 会回退到 DuckDuckGo。</p>
      )}

      {(['tavily', 'brave'] as const).map((p) => (
        <div className="settings-row" key={p}>
          <span>
            <strong>{p === 'tavily' ? 'Tavily' : 'Brave'} API Key</strong>
            <small>
              {config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] ? '✔ 已配置' : '未配置'}
            </small>
          </span>
          <div className="settings-inline">
            <input
              type="password"
              placeholder={config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] ? '已配置，输入可覆盖' : '粘贴 Key'}
              value={keys[p]}
              onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))}
              aria-label={`${p} API Key`}
            />
            <button type="button" className="btn btn-secondary" onClick={() => void saveKey(p)}>
              {saved[p] ? '已保存' : '保存'}
            </button>
            {config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] && (
              <button type="button" className="btn btn-ghost" onClick={() => void clearKey(p)}>
                清除
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
```

Registration in `src/components/SettingsPanel.tsx`:

1. Import: `import { SettingsBrowserPanel } from './settings/SettingsBrowserPanel';`
2. `SETTINGS_TABS`: add `{ id: 'browser', label: 'AI 浏览器' }` (after `app`).
3. `TAB_ICONS`: add `browser: 'search'`.
4. Panel render (after the `app` block):

```tsx
{tab === 'browser' && (
  <SettingsBrowserPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
)}
```

Check `SettingsPanel.test.tsx` and `SettingsAppPanel.test.tsx`/`SettingsPanel` related tests for `SETTINGS_TABS`-length assertions and update if they enumerate tabs.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/components/settings/SettingsBrowserPanel.test.tsx src/components/SettingsPanel.test.tsx` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 5: Full Verification + Changelog

**Files:**
- Modify: `CHANGELOG.md` (Unreleased entry)

- [ ] **Step 1: Run full gates**

Run: `npm test`
Expected: all PASS (single-file serial per vitest config).

Run: `npm run typecheck`
Expected: clean for both tsconfigs.

- [ ] **Step 2: Manual verification notes (record in report)**

- Settings → AI 浏览器: toggle JS 执行 → `main.log` shows config write; relaunch keeps the toggle (config persisted).
- Set provider Tavily + save key → getConfig shows `hasTavilyKey: true`; web_search uses Tavily provider path (TavilyProvider constructed with key — verify via `web-search.ts` wiring if present; otherwise note as P1 provider hookup not yet consuming keys — flag in report).
- `settings:clearAllData` → browser partition cookies gone (manual: navigate a site with cookies, wipe, re-open, cookies cleared).

- [ ] **Step 3: CHANGELOG entry**

Add under Unreleased:

`内置 AI 浏览器 B 组：设置面板（JS 执行开关 + 搜索服务/Key 配置）、清空数据时清理浏览器分区、act 限频（1 秒 1 次）、导航后 SPA 稳定等待、plan 模式支持 web_search`