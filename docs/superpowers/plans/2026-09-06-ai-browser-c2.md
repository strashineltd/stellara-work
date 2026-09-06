# AI Browser C2 Implementation Plan (Cookie 登录态保留：允许列表 + 退出清理)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a login-retention policy: an allowlist of sites whose cookies survive app quit, with all other cookies cleared on quit, configurable from the browser settings panel.

**Architecture:** `config-v2` gains `app.browser.loginAllowlist` (normalized lowercase domains). `BrowserService.clearNonAllowlistedCookies(allowlist)` removes cookies per partition not matching the allowlist (exact or subdomain suffix). `main.ts` wires a `before-quit` hook that prevents default, awaits the cleanup, then quits (re-entry guarded). SettingsBrowserPanel gains an allowlist chip editor backed by the existing `browser:getConfig`/`browser:updateConfig` channels.

**Tech Stack:** Electron 43, TypeScript, React 19, Vitest + jsdom, existing config-v2/secrets/BrowserService/SettingsBrowserPanel patterns.

**Spec:** `docs/superpowers/specs/2026-09-06-ai-browser-c2-design.md`

## Global Constraints

- No new dependencies; no new IPC channels (reuse `browser:getConfig` / `browser:updateConfig`).
- Only cookies are cleared on quit — never localStorage/IndexedDB/cache, and never cookies of allowlisted domains.
- `normalizeAllowlistDomain(input)` rules: trim + lowercase; strip `https://`/`http://` prefix, path, port, trailing dot; drop empties; dedupe; any non-domain character → invalid (batch rejected with `'无效的登录保留域名'`).
- Allowlist matching: allowlist item `a.com` matches cookie domain `a.com` AND `x.a.com` (suffix match); cookie domains are normalized (leading dot stripped).
- `before-quit` must preventDefault + await cleanup + `app.quit()` with a re-entry flag; cleanup failure logs and still quits.
- TDD: failing test first, RED, minimal implementation, GREEN; `npm test -- <file>` + `npm run typecheck` per task.
- Run commit commands only when the user explicitly requests commits. Otherwise leave changes uncommitted.

---

## File Map

- Modify `electron/config/config-v2.ts`: `loginAllowlist?: string[]` + export `normalizeAllowlistDomain(input: string): string | null` + `normalizeAllowlist(input: string[]): string[] | null`.
- Modify `electron/config/config-v2.test.ts`: round-trip + normalization matrix.
- Modify `electron/browser/service.ts`: `clearNonAllowlistedCookies(allowlist: string[]): Promise<void>` + module-level pure `isAllowlistedCookie(domain: string, allowlist: string[]): boolean` (exported for tests).
- Modify `electron/browser/service.test.ts`: cookie filter matrix with fake session.cookies.
- Modify `shared/ipc.ts`: `BrowserConfigView.loginAllowlist: string[]` + `updateConfig` partial type gains `loginAllowlist?: string[]`.
- Modify `electron/main.ts`: before-quit hook + `browser:getConfig`/`browser:updateConfig` extensions (normalization + validation).
- Modify `src/components/settings/SettingsBrowserPanel.tsx`: allowlist section (input + add + chips + delete).
- Modify `src/components/settings/SettingsBrowserPanel.test.tsx`: 3 new tests.
- Modify `CHANGELOG.md` (Task 5).

---

### Task 1: config-v2 loginAllowlist + Normalization

**Files:**
- Modify: `electron/config/config-v2.ts` (`app.browser` block)
- Test: `electron/config/config-v2.test.ts`

**Interfaces:**
- Consumes: existing `AppConfig['app']['browser']` shape.
- Produces: `app.browser.loginAllowlist?: string[]`; exported `normalizeAllowlistDomain(input: string): string | null` and `normalizeAllowlist(list: string[]): string[] | null` consumed by Task 3's handlers.

- [ ] **Step 1: Write the failing tests**

Append to `electron/config/config-v2.test.ts` (import the two helpers at the top of the file):

```ts
import { normalizeAllowlistDomain, normalizeAllowlist } from './config-v2';
```

```ts
describe('login allowlist normalization', () => {
  it('normalizes domains: protocol, path, port, case, trailing dot', () => {
    expect(normalizeAllowlistDomain('https://Github.com/login')).toBe('github.com');
    expect(normalizeAllowlistDomain('http://a.com:8080/x')).toBe('a.com');
    expect(normalizeAllowlistDomain('example.com.')).toBe('example.com');
    expect(normalizeAllowlistDomain('  github.com  ')).toBe('github.com');
  });

  it('rejects invalid domains', () => {
    expect(normalizeAllowlistDomain('')).toBeNull();
    expect(normalizeAllowlistDomain('a b.com')).toBeNull();
    expect(normalizeAllowlistDomain('https://a b.com/x')).toBeNull();
  });

  it('normalizes a batch, dropping empties and deduping; rejects if any item is invalid', () => {
    expect(normalizeAllowlist(['https://A.com', 'a.com', ''])).toEqual(['a.com']);
    expect(normalizeAllowlist(['github.com', 'x b.com'])).toBeNull();
  });

  it('round-trips loginAllowlist through save/load', async () => {
    const cfg = await loadConfig();
    cfg.app = { ...cfg.app, browser: { loginAllowlist: ['github.com', 'gitlab.com'] } };
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded.app.browser?.loginAllowlist).toEqual(['github.com', 'gitlab.com']);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/config/config-v2.test.ts`
Expected: FAIL — helpers missing (module not found / not a function), round-trip fails at runtime.

- [ ] **Step 3: Minimal implementation**

In `electron/config/config-v2.ts`:

1. Add to `app.browser`:

```ts
loginAllowlist?: string[];
```

2. Add module-level helpers (exported near the top of the file, after imports):

```ts
/** 域名规范化：小写、去协议/路径/端口/尾点；非法返回 null */
export function normalizeAllowlistDomain(input: string): string | null {
  let d = (input ?? '').trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '');
  d = d.split('/')[0]!.split(':')[0]!.replace(/\.$/, '');
  if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}

/** 整批规范化：空项剔除、去重；任一项非法返回 null */
export function normalizeAllowlist(list: string[]): string[] | null {
  const out: string[] = [];
  for (const raw of list) {
    const d = normalizeAllowlistDomain(raw);
    if (d === null) return null;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/config/config-v2.test.ts` + `npm run typecheck`
Expected: PASS / clean.

---

### Task 2: BrowserService.clearNonAllowlistedCookies

**Files:**
- Modify: `electron/browser/service.ts`
- Test: `electron/browser/service.test.ts`

**Interfaces:**
- Consumes: existing `partitionSessions` map + `createdPartitions` set + `onPartitionClearError` opts + `lazyElectron()` fallback.
- Produces: exported pure `isAllowlistedCookie(domain: string, allowlist: string[]): boolean` and `clearNonAllowlistedCookies(allowlist: string[]): Promise<void>` consumed by Task 3's before-quit hook.

- [ ] **Step 1: Write failing tests**

Append to `electron/browser/service.test.ts`:

```ts
describe('isAllowlistedCookie', () => {
  it('matches exact and subdomain suffixes; rejects others', () => {
    expect(isAllowlistedCookie('.github.com', ['github.com'])).toBe(true);
    expect(isAllowlistedCookie('x.github.com', ['github.com'])).toBe(true);
    expect(isAllowlistedCookie('evil-github.com', ['github.com'])).toBe(false);
    expect(isAllowlistedCookie('gitlab.com', ['github.com'])).toBe(false);
  });
});

describe('clearNonAllowlistedCookies', () => {
  function fakeCookies(cookies: Array<{ domain: string; name: string; path: string; secure?: boolean }>) {
    const removed: Array<{ url: string; name: string }> = [];
    const session = {
      cookies: {
        get: vi.fn().mockResolvedValue(cookies),
        remove: vi.fn().mockImplementation((url: string, name: string) => {
          removed.push({ url, name });
          return Promise.resolve();
        }),
      },
    };
    return { session, removed };
  }

  function makeServiceWithSession(session: Record<string, any>) {
    const pool = new TabPool();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(makeWebContents(session).wc) });
    return svc;
  }

  it('keeps allowlisted cookies (exact + subdomain) and removes the rest', async () => {
    const { session, removed } = fakeCookies([
      { domain: '.github.com', name: 'sid', path: '/' },
      { domain: 'x.github.com', name: 's', path: '/' },
      { domain: '.gitlab.com', name: 'gl', path: '/' },
    ]);
    const svc = makeServiceWithSession({ session });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.clearNonAllowlistedCookies(['github.com']);
    expect(session.cookies.remove).toHaveBeenCalledTimes(1);
    expect(removed[0]).toEqual({ url: 'http://.gitlab.com/', name: 'gl' });
  });

  it('empty allowlist removes everything', async () => {
    const { session, removed } = fakeCookies([
      { domain: '.github.com', name: 'sid', path: '/' },
      { domain: '.gitlab.com', name: 'gl', path: '/' },
    ]);
    const svc = makeServiceWithSession({ session });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.clearNonAllowlistedCookies([]);
    expect(session.cookies.remove).toHaveBeenCalledTimes(2);
    expect(removed.length).toBe(2);
  });

  it('uses https url for secure cookies', async () => {
    const { session, removed } = fakeCookies([
      { domain: '.github.com', name: 'sid', path: '/', secure: true },
    ]);
    const svc = makeServiceWithSession({ session });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.clearNonAllowlistedCookies([]);
    expect(removed[0]!.url).toBe('https://.github.com/');
  });

  it('reports per-partition failures via onPartitionClearError without blocking others', async () => {
    const bad = { cookies: { get: vi.fn().mockRejectedValue(new Error('boom')) } };
    const pool = new TabPool();
    const errors: Array<{ name: string; err: unknown }> = [];
    const svc = new BrowserService(pool, {
      createWindow: () => makeWindow(makeWebContents(bad).wc),
      onPartitionClearError: (name, err) => errors.push({ name, err }),
    });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.clearNonAllowlistedCookies([]);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});
```

Note: `makeWebContents` currently builds `session: { on: vi.fn() }`. This task must extend `makeWebContents(overrides)` so tests can pass a full fake `session` object (the `wc.session` field). Adjust `makeWebContents` to accept `overrides` and spread them (check the current helper signature first — it already accepts `overrides: Record<string, unknown>`).

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- electron/browser/service.test.ts`
Expected: FAIL — `isAllowlistedCookie` / `clearNonAllowlistedCookies` missing.

- [ ] **Step 3: Minimal implementation**

In `electron/browser/service.ts`:

1. Module-level pure helper (near `sanitizeSessionId`):

```ts
/** cookie.domain（可能带前导点）→ 小写、去前导点 */
function normalizeCookieDomain(domain: string): string {
  return (domain ?? '').toLowerCase().replace(/^\./, '');
}

/** 允许列表匹配：allowlist 项精确匹配或作为 cookie 域的子域后缀 */
export function isAllowlistedCookie(domain: string, allowlist: string[]): boolean {
  const d = normalizeCookieDomain(domain);
  if (!d) return false;
  return allowlist.some((item) => d === item || d.endsWith('.' + item));
}
```

2. Public method (after `clearPartitions`):

```ts
async clearNonAllowlistedCookies(allowlist: string[]): Promise<void> {
  const electron = lazyElectron();
  for (const name of this.createdPartitions) {
    try {
      const sess = this.partitionSessions.get(name) ?? electron.session.fromPartition(name);
      const cookies = await sess.cookies.get({});
      for (const cookie of cookies as Array<{ domain?: string; name: string; path?: string; secure?: boolean }>) {
        const domain = cookie.domain ?? '';
        if (isAllowlistedCookie(domain, allowlist)) continue;
        const scheme = cookie.secure ? 'https://' : 'http://';
        const url = `${scheme}${domain}${cookie.path ?? '/'}`;
        await sess.cookies.remove(url, cookie.name);
      }
    } catch (e) {
      this.opts.onPartitionClearError?.(name, e);
    }
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- electron/browser/service.test.ts` + `npm run typecheck`
Expected: PASS / clean. Confirm existing `clearPartitions` tests still green.

---

### Task 3: IPC Extension + before-quit Hook

**Files:**
- Modify: `shared/ipc.ts` (`BrowserConfigView` + `updateConfig` partial)
- Modify: `electron/main.ts` (`browser:getConfig`, `browser:updateConfig`, before-quit)
- Modify: `src/dev-preview.ts` (stub gains `loginAllowlist: []`)

**Interfaces:**
- Consumes: Task 1 `normalizeAllowlist`; Task 2 `clearNonAllowlistedCookies`.
- Produces: `BrowserConfigView.loginAllowlist: string[]`; `updateConfig` accepts `loginAllowlist?: string[]` consumed by Task 4 UI.

- [ ] **Step 1: Shared types + dev-preview stub**

In `shared/ipc.ts`:

```ts
export interface BrowserConfigView {
  searchProvider: string;
  execJsEnabled: boolean;
  hasTavilyKey: boolean;
  hasBraveKey: boolean;
  loginAllowlist: string[];
}
```

`updateConfig` partial gains:

```ts
updateConfig: (partial: { searchProvider?: string; execJsEnabled?: boolean; loginAllowlist?: string[] }) => Promise<void>;
```

In `src/dev-preview.ts`, the `getConfig` stub gains `loginAllowlist: []`.

- [ ] **Step 2: Main handlers extension**

`browser:getConfig` — add to the returned object:

```ts
loginAllowlist: app.browser?.loginAllowlist ?? [],
```

`browser:updateConfig` — after the existing provider/execJs validation block, add:

```ts
if (partial.loginAllowlist !== undefined) {
  if (!Array.isArray(partial.loginAllowlist)) throw new Error('无效的登录保留域名');
  const normalized = normalizeAllowlist(partial.loginAllowlist);
  if (normalized === null) throw new Error('无效的登录保留域名');
  next.browser = { ...(next.browser ?? {}), loginAllowlist: normalized };
}
```

Refactor the handler so it builds a `next.browser` object once and applies `saveConfig` + `setExecJsEnabled` + `broadcastSettingsChanged` after validation (keep existing behavior).

Import `normalizeAllowlist` from `./config/config-v2` at the handler site (dynamic import already used for config).

- [ ] **Step 3: before-quit hook**

In `electron/main.ts`, at module scope near the other app hooks:

```ts
let browserQuitCleanupDone = false;
app.on('before-quit', (e) => {
  if (browserQuitCleanupDone) return;
  e.preventDefault();
  browserQuitCleanupDone = true;
  void (async () => {
    try {
      const { loadConfig } = await import('./config/config-v2');
      const { browserService } = await import('./browser/service');
      const cfg = await loadConfig();
      await browserService.clearNonAllowlistedCookies(cfg.app?.browser?.loginAllowlist ?? []);
    } catch (err) {
      log.warn('退出时清理 Cookie 失败（忽略）', err);
    } finally {
      app.quit();
    }
  })();
});
```

Verify the import path/name of `log` used at main.ts top (`log` from `electron-log/main`) and place the hook after `log.initialize()`.

- [ ] **Step 4: Verify GREEN**

Run: `npm run typecheck` + `npm test -- shared/ipc.browser.test.ts`
Expected: clean / PASS.

---

### Task 4: SettingsBrowserPanel Allowlist UI

**Files:**
- Modify: `src/components/settings/SettingsBrowserPanel.tsx`
- Modify: `src/components/settings/SettingsBrowserPanel.test.tsx`

**Interfaces:**
- Consumes: `BrowserConfigView.loginAllowlist` + `browser.updateConfig({ loginAllowlist })`.
- Produces: allowlist section with input + add + chips + delete, reusing existing panel error display.

- [ ] **Step 1: Write failing tests**

Append to `src/components/settings/SettingsBrowserPanel.test.tsx` (extend the existing `installApi` config to include `loginAllowlist: []` default; the existing 4 tests must keep passing):

```tsx
it('adds a valid domain to the allowlist via updateConfig', async () => {
  installApi({ loginAllowlist: [] });
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  const input = container.querySelector('input[placeholder="例如 github.com"]') as HTMLInputElement | null;
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setVal?.call(input, 'https://Github.com/login'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
  const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('添加'));
  await act(async () => { add?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.updateConfig).toHaveBeenCalledWith({ loginAllowlist: ['github.com'] });
  unmount();
});

it('rejects invalid input without calling updateConfig', async () => {
  installApi({ loginAllowlist: [] });
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  const input = container.querySelector('input[placeholder="例如 github.com"]') as HTMLInputElement | null;
  const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => { setVal?.call(input, 'a b.com'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
  const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('添加'));
  await act(async () => { add?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.updateConfig).not.toHaveBeenCalled();
  expect(container.textContent).toContain('无效的登录保留域名');
  unmount();
});

it('removes an allowlist chip via updateConfig', async () => {
  installApi({ loginAllowlist: ['github.com'] });
  const { container, unmount } = await render(<SettingsBrowserPanel />);
  const del = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('删除'));
  await act(async () => { del?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => {});
  expect(mocks.updateConfig).toHaveBeenCalledWith({ loginAllowlist: [] });
  unmount();
});
```

Note: the `installApi` helper's `getConfig` mock must now include `loginAllowlist` — update its default object.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/components/settings/SettingsBrowserPanel.test.tsx`
Expected: FAIL — no allowlist UI (module renders but tests can't find input/add/chips).

- [ ] **Step 3: Minimal implementation**

In `src/components/settings/SettingsBrowserPanel.tsx`:

1. `DEFAULT_CONFIG` gains `loginAllowlist: []`.
2. New state: `const [allowlistInput, setAllowlistInput] = useState('');`
3. New handlers:

```tsx
function addAllowlistDomain() {
  const d = normalizeAllowlistDomain(allowlistInput);
  if (!d) {
    setError('无效的登录保留域名');
    return;
  }
  const next = config.loginAllowlist.includes(d) ? config.loginAllowlist : [...config.loginAllowlist, d];
  setConfig((c) => ({ ...c, loginAllowlist: next }));
  void window.electronAPI.browser.updateConfig({ loginAllowlist: next }).then(() => {
    setAllowlistInput('');
    onChanged?.();
  }).catch((e: Error) => setError(e.message));
}

function removeAllowlistDomain(d: string) {
  const next = config.loginAllowlist.filter((x) => x !== d);
  setConfig((c) => ({ ...c, loginAllowlist: next }));
  void window.electronAPI.browser.updateConfig({ loginAllowlist: next }).then(() => onChanged?.()).catch((e: Error) => setError(e.message));
}
```

Import `normalizeAllowlistDomain` from `../../../electron/config/config-v2`? No — the renderer must not import electron code. Instead, re-implement a tiny renderer-safe validator (protocol/path/port strip + lowercase + regex), named `normalizeDomainForAllowlist`, exported from the panel file or a local helper:

```tsx
export function normalizeDomainForAllowlist(input: string): string | null {
  let d = (input ?? '').trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '').split('/')[0]!.split(':')[0]!.replace(/\.$/, '');
  if (!d || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  return d;
}
```

(Mirrors the main-process rule; the main handler re-validates via `normalizeAllowlist` — renderer validation is UX only.)

4. New section after the API Key section:

```tsx
<section className="settings-section" aria-label="登录保留站点">
  <div className="settings-section__title">登录保留站点</div>
  <div className="settings-group">
    <div className="settings-item">
      <div className="settings-item__grow">
        <div className="settings-item__label">保留登录状态</div>
        <div className="settings-item__hint">这些站点的登录状态会在退出应用时保留，其他站点的 Cookie 会在退出时自动清除</div>
      </div>
    </div>
    <div className="settings-item__ops">
      <input
        type="text"
        placeholder="例如 github.com"
        value={allowlistInput}
        onChange={(e) => setAllowlistInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addAllowlistDomain(); }}
        aria-label="登录保留域名"
      />
      <button type="button" className="btn btn-secondary" onClick={addAllowlistDomain}>添加</button>
    </div>
    {config.loginAllowlist.length > 0 && (
      <div className="settings-item__ops settings-allowlist-chips">
        {config.loginAllowlist.map((d) => (
          <span className="settings-chip" key={d}>
            {d}
            <button type="button" className="settings-chip__remove" onClick={() => removeAllowlistDomain(d)} aria-label={`删除 ${d}`}>删除</button>
          </span>
        ))}
      </div>
    )}
  </div>
</section>
```

Use existing styling classes if `settings-chip` doesn't exist — check workbench.css for a chip class (e.g. `.tag`, `.chip`) and adapt; otherwise add a minimal `.settings-chip` style block following token conventions (or reuse `.empty-hint`-style inline layout). Record the choice.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- src/components/settings/SettingsBrowserPanel.test.tsx src/components/SettingsPanel.test.tsx` + `npm run typecheck`
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

- Settings → AI 浏览器 → 登录保留站点: add `github.com`, verify config file contains `loginAllowlist: ["github.com"]`.
- With a dev app: navigate to a site, set a cookie, quit the app → verify non-allowlisted cookie gone, allowlisted cookie present on relaunch (spot-check).
- Empty allowlist → quit clears all browser cookies.

- [ ] **Step 3: CHANGELOG entry**

Add under Unreleased:

`AI 浏览器 C2：登录保留站点（允许列表 + 退出清理非列表站点 Cookie，设置面板维护）`