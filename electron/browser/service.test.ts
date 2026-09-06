import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserService, shouldApprove, isTypeableElement, FORM_CONTROL_SELECTOR } from './service';
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
  return { isDestroyed: () => false, webContents: wc };
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
    const tab = pool.create('s', 'https://a.com/');
    const approve = vi.fn().mockResolvedValue(false);
    const svc = new BrowserService(pool, { requestApproval: approve });
    const r = await svc.get('s').navigate({ tabId: tab.id, url: 'https://b.com/' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('用户拒绝了此操作');
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'browser_navigate' }));
  });

  it('browser_act does not double-gate at the service (loop gates act)', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const approve = vi.fn();
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'scroll', direction: 'down' });
    expect(r.ok).toBe(true);
    expect(approve).not.toHaveBeenCalled();
  });

  it('approval request carries sessionId for stream routing', async () => {
    const pool = new TabPool();
    const tab = pool.create('sess-7', 'https://a.com/');
    const approve = vi.fn().mockResolvedValue(false);
    const svc = new BrowserService(pool, { requestApproval: approve });
    await svc.get('sess-7').navigate({ tabId: tab.id, url: 'https://b.com/' });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-7' }));
  });
});

describe('SSRF chain in browser path (validateUrl)', () => {
  it('doNavigate blocks private IP after quick policy check, before approval or load', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const approve = vi.fn().mockResolvedValue(true);
    const { wc } = makeWebContents();
    const svc = new BrowserService(pool, { requestApproval: approve, createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').navigate({ tabId: tab.id, url: 'http://10.0.0.1/' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('私网');
    expect(approve).not.toHaveBeenCalled();
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it('doNavigate blocks DNS name resolving to private IP', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').navigate({ tabId: tab.id, url: 'https://evil.example.com/' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('受限');
  });

  it('will-navigate synchronously blocks clear-cut bad schemes and asynchronously stops SSRF targets', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc, handlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
    await svc.get('s').snapshot({ tabId: tab.id });
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
    const tab = pool.create('s', 'https://a.com/');
    const { wc, handlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><p>x</p></html>');
    await svc.get('s').snapshot({ tabId: tab.id });
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
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html><a href="/x">Go</a></html>');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const snap = await svc.get('s').snapshot({ tabId: tab.id });
    expect(snap.ok).toBe(true);
    expect(snap.output.startsWith('⚠️')).toBe(true);
    const ext = await svc.get('s').extract({ tabId: tab.id, kind: 'links' });
    expect(ext.ok).toBe(true);
    expect(ext.output.startsWith('⚠️')).toBe(true);
  });

  it('act output carries the untrusted marker', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('__OK__');
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'scroll', direction: 'down' });
    expect(r.ok).toBe(true);
    expect(r.output.startsWith('⚠️')).toBe(true);
  });
});

describe('browser_act real implementation', () => {
  function snapshotThenAct(): { svc: BrowserService; pool: TabPool; tab: { id: string }; codes: string[]; wc: Record<string, any> } {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    const codes: string[] = [];
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      const code = scripts[0]!.code;
      codes.push(code);
      if (code.includes('outerHTML')) return '<html><a href="/x">Go</a><input name="q"></html>';
      return '__OK__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    return { svc, pool, tab, codes, wc };
  }

  it('click executes JS targeting the nth link ref', async () => {
    const { svc, tab, codes } = snapshotThenAct();
    await svc.get('s').snapshot({ tabId: tab.id });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'click', targetId: 'r1' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('已点击: r1');
    expect(codes.some((c) => c.includes("querySelectorAll('a[href]')") && c.includes('.click()'))).toBe(true);
  });

  it('type focuses and dispatches input/change on the nth form control', async () => {
    const { svc, tab, codes } = snapshotThenAct();
    await svc.get('s').snapshot({ tabId: tab.id });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'type', targetId: 'f1', text: 'hello' });
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
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      const code = scripts[0]!.code;
      if (code.includes('outerHTML')) return '<html><button>Go</button><input name="q"></html>';
      return '__NOT_TYPEABLE__:button';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    await svc.get('s').snapshot({ tabId: tab.id });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'type', targetId: 'f1', text: 'hello' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('目标控件不可输入');
    expect(r.error).toContain('f1');
  });

  it('scroll executes window.scrollBy in the right direction', async () => {
    const { svc, tab, codes } = snapshotThenAct();
    await svc.get('s').snapshot({ tabId: tab.id });
    await svc.get('s').act({ tabId: tab.id, action: 'scroll', direction: 'up' });
    expect(codes.some((c) => c.includes('scrollBy(0, -800)'))).toBe(true);
  });

  it('back uses webContents.goBack; reload uses reload', async () => {
    const { svc, tab, wc } = snapshotThenAct();
    await svc.get('s').snapshot({ tabId: tab.id });
    const back = await svc.get('s').act({ tabId: tab.id, action: 'back' });
    expect(back.ok).toBe(true);
    expect(wc.goBack).toHaveBeenCalled();
    const reload = await svc.get('s').act({ tabId: tab.id, action: 'reload' });
    expect(reload.ok).toBe(true);
    expect(wc.reload).toHaveBeenCalled();
  });

  it('returns honest error when target element is missing', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      if (scripts[0]!.code.includes('outerHTML')) return '<html><a href="/x">Go</a></html>';
      return '__NOT_FOUND__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    await svc.get('s').snapshot({ tabId: tab.id });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'click', targetId: 'r1' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('未找到目标');
  });

  it('select on non-select target returns honest error', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockImplementation(async (_w: number, scripts: { code: string }[]) => {
      if (scripts[0]!.code.includes('outerHTML')) return '<html><a href="/x">Go</a><input name="q"></html>';
      return '__NOT_SELECT__';
    });
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    await svc.get('s').snapshot({ tabId: tab.id });
    const r = await svc.get('s').act({ tabId: tab.id, action: 'select', targetId: 'f1', text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('下拉');
  });

  it('hover / press return honest unimplemented errors, never fake success', async () => {
    const { svc, tab } = snapshotThenAct();
    await svc.get('s').snapshot({ tabId: tab.id });
    const hover = await svc.get('s').act({ tabId: tab.id, action: 'hover', targetId: 'r1' });
    expect(hover.ok).toBe(false);
    expect(hover.error).toContain('hover 未实现');
    const press = await svc.get('s').act({ tabId: tab.id, action: 'press', text: 'Enter' });
    expect(press.ok).toBe(false);
    expect(press.error).toContain('press 未实现');
  });
});

describe('browser_screenshot', () => {
  it('returns the full dataURL without slicing', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    const png = Buffer.alloc(150_000, 7);
    const img = { toPNG: vi.fn().mockReturnValue(png), toJPEG: vi.fn(), resize: vi.fn() };
    wc.capturePage.mockResolvedValue(img);
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').screenshot({ tabId: tab.id });
    expect(r.ok).toBe(true);
    expect(r.output).toContain(`data:image/png;base64,${png.toString('base64')}`);
    expect(img.resize).not.toHaveBeenCalled();
  });

  it('resizes to max width 1280 + JPEG(80) when PNG dataURL exceeds 5MB', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
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
    const r = await svc.get('s').screenshot({ tabId: tab.id });
    expect(r.ok).toBe(true);
    expect(img.resize).toHaveBeenCalledWith({ width: 1280 });
    expect(r.output).toContain(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
  });

  it('returns honest error when resized JPEG still exceeds 5MB', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    const img = {
      toPNG: () => Buffer.alloc(7_000_000, 7),
      toJPEG: () => Buffer.alloc(6_000_000, 7),
      resize: () => ({ toJPEG: () => Buffer.alloc(6_000_000, 7) }),
    };
    wc.capturePage.mockResolvedValue(img);
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').screenshot({ tabId: tab.id });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('browser_extract');
  });
});

describe('browser window hardening', () => {
  it('registers will-download handler that prevents downloads', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc, sessionHandlers } = makeWebContents();
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue('<html></html>');
    await svc.get('s').snapshot({ tabId: tab.id });
    const handler = sessionHandlers.get('will-download')!;
    const ev = { preventDefault: vi.fn() };
    handler(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe('browser_extract tables', () => {
  it('extracts markdown tables from table html', async () => {
    const pool = new TabPool();
    const tab = pool.create('s', 'https://a.com/');
    const { wc } = makeWebContents();
    wc.executeJavaScriptInIsolatedWorld.mockResolvedValue(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    const svc = new BrowserService(pool, { createWindow: () => makeWindow(wc) });
    const r = await svc.get('s').extract({ tabId: tab.id, kind: 'tables' });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('| A | B |');
    expect(r.output).toContain('| 1 | 2 |');
    expect(r.output.startsWith('⚠️')).toBe(true);
  });
});