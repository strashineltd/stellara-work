import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserService, shouldApprove, isTypeableElement, FORM_CONTROL_SELECTOR, isAllowlistedCookie, READONLY_GUARD_SCRIPT } from './service';
import { TabPool } from './tabs';

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from 'node:dns/promises';

const mockDns = vi.mocked(dns);

function makeWebContents(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, (e: unknown, ...args: unknown[]) => void>();
  const sessionHandlers = new Map<string, (e: unknown, ...args: unknown[]) => void>();
  const wc: Record<string, any> = {
    loadURL: vi.fn().mockResolvedValue(undefined),
    executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(''),
    executeJavaScript: vi.fn().mockResolvedValue(''),
    capturePage: vi.fn().mockResolvedValue({}),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((name: string, cb: (e: unknown, ...args: unknown[]) => void) => {
      handlers.set(name, cb);
    }),
    goBack: vi.fn(),
    reload: vi.fn(),
    canGoBack: vi.fn().mockReturnValue(true),
    stop: vi.fn(),
    session: {
      on: vi.fn((name: string, cb: (e: unknown, ...args: unknown[]) => void) => {
        sessionHandlers.set(name, cb);
      }),
    },
    ...overrides,
  };
  return { wc, handlers, sessionHandlers };
}

function makeWindow(wc: Record<string, any>) {
  return { isDestroyed: () => false, destroy: vi.fn(), setBounds: vi.fn(), webContents: wc };
}

function fakeContentView() {
  return { addChildView: vi.fn(), removeChildView: vi.fn() };
}

async function createTab(svc: BrowserService, sessionId: string, url: string): Promise<string> {
  const r = await svc.get(sessionId).tabs({ op: 'create', url });
  if (!r.ok) throw new Error(r.error);
  return (JSON.parse(r.output) as { id: string }).id;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDns.lookup.mockReset();
  mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldApprove', () => {
  it('act/exec_js are gated by the loop, not the service (no double approval)', () => {
    expect(shouldApprove('browser_act', false)).toBe(false);
    expect(shouldApprove('browser_exec_js', false)).toBe(false);
  });
  it('new-domain navigate needs approval, same-domain is free', () => {
    expect(shouldApprove('browser_navigate', true)).toBe(true);
    expect(shouldApprove('browser_navigate', false)).toBe(false);
  });
  it('snapshot/extract/search never need approval', () => {
    expect(shouldApprove('browser_snapshot', true)).toBe(false);
    expect(shouldApprove('browser_extract', true)).toBe(false);
  });
});

describe('BrowserService approval wiring', () => {
  it('new-domain navigate calls injected requestApproval; rejection blocks navigation', async () => {
    const pool = new TabPool();
    const approve = vi.fn().mockResolvedValue(false);
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(makeWebContents().wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').navigate({ tabId, url: 'https://b.com/' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('用户拒绝了此操作');
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'browser_navigate' }));
  });

  it('browser_act does not double-gate at the service (loop gates act)', async () => {
    const pool = new TabPool();
    const approve = vi.fn();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').act({ tabId, action: 'scroll', direction: 'down' });
    expect(r.ok).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });

  it('approval request carries sessionId for stream routing', async () => {
    const pool = new TabPool();
    const approve = vi.fn().mockResolvedValue(false);
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(makeWebContents().wc) });
    const tabId = await createTab(svc, 'sess-7', 'https://a.com/');
    await svc.get('sess-7').navigate({ tabId, url: 'https://b.com/' });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-7' }));
  });

  it('implicit new-tab navigate rolls back tab+window when approval is rejected', async () => {
    const pool = new TabPool();
    const destroyed: string[] = [];
    const svc = new BrowserService(pool, {
      requestApproval: vi.fn().mockResolvedValue(false),
      createWindow: () => {
        const w = makeWindow(makeWebContents().wc);
        w.destroy = vi.fn(() => destroyed.push('w'));
        return w;
      },
    });
    const r = await svc.get('s').navigate({ url: 'https://b.com/' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('用户拒绝了此操作');
    expect(pool.list('s')).toHaveLength(0);
    expect(destroyed).toEqual(['w']);
  });

  it('explicit-tabId navigate keeps the tab when approval is rejected', async () => {
    const pool = new TabPool();
    const svc = new BrowserService(pool, {
      requestApproval: vi.fn().mockResolvedValue(false),
      createWindow: () => makeWindow(makeWebContents().wc),
    });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').navigate({ tabId, url: 'https://b.com/' });
    expect(r.ok).toBe(false);
    expect(pool.list('s')).toHaveLength(1);
  });
});

describe('SSRF chain in browser path (validateUrl)', () => {
  it('doNavigate blocks private IP after quick policy check, before approval or load', async () => {
    const pool = new TabPool();
    const approve = vi.fn().mockResolvedValue(true);
    const { wc } = makeWebContents();
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').navigate({ tabId, url: 'http://10.0.0.1/' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('私网');
    expect(approve).not.toHaveBeenCalled();
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it('doNavigate blocks DNS name resolving to private IP', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    const pool = new TabPool();
    const { wc } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').navigate({ tabId, url: 'https://evil.example.com/' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('受限');
  });

  it('will-navigate synchronously blocks clear-cut bad schemes and asynchronously stops SSRF targets', async () => {
    const pool = new TabPool();
    const { wc, handlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const handler = handlers.get('will-navigate')!;

    const ev1 = { preventDefault: vi.fn() };
    handler(ev1, 'javascript:alert(1)');
    expect(ev1.preventDefault).toHaveBeenCalled();

    const ev2 = { preventDefault: vi.fn() };
    handler(ev2, 'http://10.0.0.1/');
    await flush();
    expect(ev2.preventDefault).not.toHaveBeenCalled();
    expect(wc.stop).toHaveBeenCalled();
  });

  it('will-redirect / did-redirect-navigation stop SSRF targets', async () => {
    const pool = new TabPool();
    const { wc, handlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const willRedirect = handlers.get('will-redirect')!;
    willRedirect({ preventDefault: vi.fn() }, 'http://169.254.169.254/latest/meta-data');
    await flush();
    expect(wc.stop).toHaveBeenCalled();
    const didRedirect = handlers.get('did-redirect-navigation')!;
    didRedirect({ preventDefault: vi.fn() }, 'http://127.0.0.1/');
    await flush();
    expect(wc.stop).toHaveBeenCalled();
  });
});

describe('untrusted markers on page-derived output', () => {
  it('snapshot and extract outputs carry the untrusted marker', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><a href="/x">Go</a></html>');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const snap = await svc.get('s').snapshot({ tabId });
    expect(snap.ok).toBe(true);
    expect(snap.output.startsWith('⚠️')).toBe(true);
    const ext = await svc.get('s').extract({ tabId, kind: 'links' });
    expect(ext.ok).toBe(true);
    expect(ext.output.startsWith('⚠️')).toBe(true);
  });

  it('act output carries the untrusted marker', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').act({ tabId, action: 'scroll', direction: 'down' });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('⚠️')).toBe(true);
  });
});

describe('browser_act real implementation', () => {
  async function snapshotThenAct(): Promise<{ svc: BrowserService; tabId: string; codes: string[]; wc: Record<string, any> }> {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    const codes: string[] = [];
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      const code = scripts[0]!.code;
      codes.push(code);
      if (code.includes('outerHTML')) return '<html><a href="/x">Go</a><input name="q"></html>';
      return '__OK__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    return { svc, tabId, codes, wc };
  }

  it('click executes JS targeting the nth link ref', async () => {
    const { svc, tabId, codes } = await snapshotThenAct();
    await svc.get('s').snapshot({ tabId });
    const r = await svc.get('s').act({ tabId, action: 'click', targetId: 'r1' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('已点击: r1');
    expect(codes.some((c) => c.includes("querySelectorAll('a[href]')") && c.includes('.click()'))).toBe(true);
  });

  it('type focuses and dispatches input/change on the nth form control', async () => {
    const { svc, tabId, codes } = await snapshotThenAct();
    await svc.get('s').snapshot({ tabId });
    const r = await svc.get('s').act({ tabId, action: 'type', targetId: 'f1', text: 'hello' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('已输入');
    expect(codes.some((c) => c.includes('querySelectorAll("input,button,select,textarea")') && c.includes('dispatchEvent'))).toBe(true);
  });

  it('type uses the same combined selector snapshot uses to assign f-ids', () => {
    expect(FORM_CONTROL_SELECTOR).toBe('input,button,select,textarea');
  });

  it('isTypeableElement rejects buttons and non-text inputs', () => {
    expect(isTypeableElement('INPUT')).toBe(true);
    expect(isTypeableElement('INPUT', 'text')).toBe(true);
    expect(isTypeableElement('TEXTAREA')).toBe(true);
    expect(isTypeableElement('SELECT')).toBe(true);
    expect(isTypeableElement('BUTTON')).toBe(false);
    expect(isTypeableElement('INPUT', 'checkbox')).toBe(false);
    expect(isTypeableElement('INPUT', 'submit')).toBe(false);
    expect(isTypeableElement('INPUT', 'reset')).toBe(false);
    expect(isTypeableElement('INPUT', 'file')).toBe(false);
    expect(isTypeableElement('INPUT', 'radio')).toBe(false);
    expect(isTypeableElement('INPUT', 'image')).toBe(false);
    expect(isTypeableElement('DIV')).toBe(false);
  });

  it('type returns honest error when the f-ref points at a button, without typing elsewhere', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      const code = scripts[0]!.code;
      if (code.includes('outerHTML')) return '<html><button>Go</button><input name="q"></html>';
      return '__NOT_TYPEABLE__:button';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const r = await svc.get('s').act({ tabId, action: 'type', targetId: 'f1', text: 'hello' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('目标控件不可输入');
    expect(r.error).toContain('f1');
  });

  it('scroll executes window.scrollBy in the right direction', async () => {
    const { svc, tabId, codes } = await snapshotThenAct();
    await svc.get('s').snapshot({ tabId });
    await svc.get('s').act({ tabId, action: 'scroll', direction: 'up' });
    expect(codes.some((c) => c.includes('scrollBy(0, -800)'))).toBe(true);
  });

  it('back uses webContents.goBack; reload uses reload', async () => {
    const { svc, tabId, wc } = await snapshotThenAct();
    await svc.get('s').snapshot({ tabId });
    const back = await svc.get('s').act({ tabId, action: 'back' });
    expect(back.ok).toBe(true);
    expect(wc.goBack).toHaveBeenCalled();
    const reload = await svc.get('s').act({ tabId, action: 'reload' });
    expect(reload.ok).toBe(true);
    expect(wc.reload).toHaveBeenCalled();
  });

  it('returns honest error when target element is missing', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      if (scripts[0]!.code.includes('outerHTML')) return '<html><a href="/x">Go</a></html>';
      return '__NOT_FOUND__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const r = await svc.get('s').act({ tabId, action: 'click', targetId: 'r1' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('未找到目标');
  });

  it('select on non-select target returns honest error', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      if (scripts[0]!.code.includes('outerHTML')) return '<html><a href="/x">Go</a><input name="q"></html>';
      return '__NOT_SELECT__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const r = await svc.get('s').act({ tabId, action: 'select', targetId: 'f1', text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('下拉');
  });

  it('hover / press return honest unimplemented errors, never fake success', async () => {
    const { svc, tabId } = await snapshotThenAct();
    await svc.get('s').snapshot({ tabId });
    const hover = await svc.get('s').act({ tabId, action: 'hover', targetId: 'r1' });
    expect(hover.ok).toBe(false);
    expect(hover.error).toContain('hover 未实现');
    const press = await svc.get('s').act({ tabId, action: 'press', text: 'Enter' });
    expect(press.ok).toBe(false);
    expect(press.error).toContain('press 未实现');
  });
});

describe('browser_screenshot', () => {
  it('returns the full dataURL without slicing', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    const png = Buffer.alloc(150_000, 7);
    const img = { toPNG: vi.fn().mockReturnValue(png), toJPEG: vi.fn(), resize: vi.fn() };
    wc.capturePage.mockResolvedValue(img);
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').screenshot({ tabId });
    expect(r.ok).toBe(true);
    expect(r.output).toContain(`data:image/png;base64,${png.toString('base64')}`);
    expect(img.resize).not.toHaveBeenCalled();
  });

  it('resizes to max width 1280 + JPEG(80) when PNG dataURL exceeds 5MB', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    const png = Buffer.alloc(7_000_000, 7);
    const jpeg = Buffer.from('jpeg-resized');
    const img = {
      toPNG: vi.fn().mockReturnValue(png),
      toJPEG: vi.fn(),
      resize: vi.fn().mockReturnValue({ toJPEG: vi.fn().mockReturnValue(jpeg) }),
    };
    wc.capturePage.mockResolvedValue(img);
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').screenshot({ tabId });
    expect(r.ok).toBe(true);
    expect(img.resize).toHaveBeenCalledWith({ width: 1280 });
    expect(r.output).toContain(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('returns honest error when resized JPEG still exceeds 5MB', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    const img = {
      toPNG: () => Buffer.alloc(7_000_000, 7),
      toJPEG: () => Buffer.alloc(6_000_000, 7),
      resize: () => ({ toJPEG: () => Buffer.alloc(6_000_000, 7) }),
    };
    wc.capturePage.mockResolvedValue(img);
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').screenshot({ tabId });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('browser_extract');
  });
});

describe('browser window hardening', () => {
  it('registers will-download handler that prevents downloads', async () => {
    const pool = new TabPool();
    const { wc, sessionHandlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html></html>');
    const tabId = await createTab(svc, 's', 'https://a.com/');
    await svc.get('s').snapshot({ tabId });
    const handler = sessionHandlers.get('will-download')!;
    const ev = { preventDefault: vi.fn() };
    handler(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe('browser_extract tables', () => {
  it('extracts markdown tables from table html', async () => {
    const pool = new TabPool();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const tabId = await createTab(svc, 's', 'https://a.com/');
    const r = await svc.get('s').extract({ tabId, kind: 'tables' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('| A | B |');
    expect(r.output).toContain('| 1 | 2 |');
    expect(r.output.startsWith('⚠️')).toBe(true);
  });
});
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
    const wins: any[] = [];
    const svc = new BrowserService(pool, { createWindow: () => { const w = fakeWin(`w${wins.length}`); wins.push(w); w.destroy = vi.fn(() => destroyed.push(w.id)); return w; } });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.get('s').tabs({ op: 'create', url: 'https://b.com/' });
    await svc.get('s').tabs({ op: 'create', url: 'https://c.com/' });
    expect(destroyed).toEqual(['w0']);
  });

  it('close destroys the window and moves active to the newest remaining tab', async () => {
    const pool = new TabPool();
    const destroyed: string[] = [];
    const wins: any[] = [];
    const svc = new BrowserService(pool, { createWindow: () => { const w = fakeWin(`w${wins.length}`); wins.push(w); w.destroy = vi.fn(() => destroyed.push(w.id)); return w; } });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    await svc.get('s').tabs({ op: 'create', url: 'https://b.com/' });
    const t2 = pool.list('s')[1]!;
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

  it('clearPartitions reports per-partition failures via the injected error handler without blocking others', async () => {
    const pool = new TabPool();
    const errors: Array<{ name: string; err: unknown }> = [];
    const fakeSession = {
      clearStorageData: vi.fn().mockRejectedValue(new Error('session destroyed')),
      clearCache: vi.fn().mockResolvedValue(undefined),
    };
    const svc = new BrowserService(pool, {
      onPartitionClearError: (name, err) => { errors.push({ name, err }); },
      createWindow: () => {
        const { wc } = makeWebContents();
        wc.session = fakeSession;
        return makeWindow(wc);
      },
    });
    await svc.get('s').tabs({ op: 'create', url: 'https://a.com/' });
    const r = await svc.clearPartitions();
    expect(r).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.name).toBe('persist:stellara-browser-s');
    expect((errors[0]!.err as Error).message).toBe('session destroyed');
    // 失败不阻断：注册表照常清空，后续清理幂等
    await svc.clearPartitions();
    expect(errors.length).toBeGreaterThanOrEqual(1);
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

  it('waits settleDelayMs by default after navigate before snapshot (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const pool = new TabPool();
      const { wc } = makeWebContents();
      wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
      const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
      const tabId = await createTab(svc, 's', 'https://a.com/');
      const nav = svc.get('s').navigate({ tabId, url: 'https://a.com/' });
      await vi.runAllTimersAsync();
      await nav;
      const snap = svc.get('s').snapshot({ tabId });
      await vi.advanceTimersByTimeAsync(1500);
      // snapshot 尚未返回（仍差 500ms）
      let settled = false;
      void snap.then(() => { settled = true; });
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      await snap;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('execJsEnabled injection beats env', async () => {
    const svc = new BrowserService(new TabPool(), { execJsEnabled: true });
    expect(svc.isExecJsEnabled()).toBe(true);
    const svc2 = new BrowserService(new TabPool(), { execJsEnabled: false });
    expect(svc2.isExecJsEnabled()).toBe(false);
  });
});

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

  it('select in another session does not hijack the attached view', async () => {
    const { svc, contentView } = liveSetup();
    const t1 = await createTab(svc, 's', 'https://a.com/');
    svc.attachView('s', t1);
    const tB = await createTab(svc, 'other', 'https://b.com/');
    await svc.get('other').tabs({ op: 'select', tabId: tB });
    expect(contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(contentView.removeChildView).not.toHaveBeenCalled();
    // 同会话内仍正常跟随
    const t2 = await createTab(svc, 's', 'https://c.com/');
    await svc.get('s').tabs({ op: 'select', tabId: t2 });
    expect(contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);
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
