// electron/browser/service.ts
// Task 8: BrowserService (hidden windows) + approval hooks.
// vitest has no Electron binary: never import 'electron' at top level.
// All Electron access is lazy-require('electron') inside methods only.
import { TabPool } from './tabs';
import { htmlToSnapshot, htmlToTables } from './snapshot';
import { isAllowedBrowserUrl } from './url-policy';
import { UNTRUSTED_MARKER, validateUrl } from '../agent/tools/web-fetch';
import { validateActArgs } from '../agent/tools/browser-tools';
import type {
  BrowserActArgs,
  BrowserExecJsArgs,
  BrowserExtractArgs,
  BrowserNavigateArgs,
  BrowserScreenshotArgs,
  BrowserSnapshotArgs,
  BrowserTabsArgs,
  ToolExecutionContext,
  ToolResult,
} from '../../shared/ipc';

const MAX_SCREENSHOT_B64 = 5 * 1024 * 1024;

/**
 * 审批矩阵。browser_act / browser_exec_js 由 Agent 循环的 DANGEROUS_TOOLS
 * 统一把关（每次强批，现有审批 UI），此处只负责按域名区分的 browser_navigate，
 * 避免同一动作出现双重审批卡。
 */
export function shouldApprove(toolName: string, isNewDomain: boolean): boolean {
  if (toolName === 'browser_navigate') return isNewDomain;
  return false;
}
export function buildApprovalSummary(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}: ${JSON.stringify(args).slice(0, 200)}`;
}

export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  /** 发起审批的会话 id（供主进程路由到对应 stream 的审批通道） */
  sessionId?: string;
}

export type RequestApprovalFn = (req: ApprovalRequest) => Promise<boolean>;

export interface BrowserServiceOptions {
  execJsEnabled?: boolean;
  requestApproval?: RequestApprovalFn;
  /** 测试注入窗口工厂（生产环境走 lazy-require('electron')） */
  createWindow?: () => any;
}

export interface SessionBrowser {
  navigate(args: BrowserNavigateArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  snapshot(args: BrowserSnapshotArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  act(args: BrowserActArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  extract(args: BrowserExtractArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  screenshot(args: BrowserScreenshotArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  tabs(args: BrowserTabsArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  execJs(args: BrowserExecJsArgs, ctx?: ToolExecutionContext): Promise<ToolResult>;
  stop(): void;
}

const NAVIGATE_TIMEOUT_MS = 15_000;
const ACT_TIMEOUT_MS = 10_000;
const JS_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(timeoutMsg)), ms);
  });
  return Promise.race([
    p.then(
      (v) => {
        if (t) clearTimeout(t);
        return v;
      },
      (e) => {
        if (t) clearTimeout(t);
        throw e;
      },
    ),
    timeout,
  ]);
}

function safeHostname(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sanitizeSessionId(id: string): string {
  const s = (id || 'default').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 64);
  return s || 'default';
}

function markUntrusted(output: string): string {
  return UNTRUSTED_MARKER + output;
}

/** ref id rX / fX → 文档序下标（第 X 个元素，0-based） */
function refIndex(ref: string): number {
  const n = parseInt(ref.slice(1), 10);
  return Number.isFinite(n) ? Math.max(n - 1, 0) : 0;
}

/**
 * 与 snapshot.ts 表单 f-id 分配一致的组合选择器（含 button）。
 * type/select 必须用同一选择器、同一文档序取第 X 个元素，才能和 snapshot 的 fX 一一对应。
 */
export const FORM_CONTROL_SELECTOR = 'input,button,select,textarea';

/** 不可输入的 input type（按钮类/复选框/单选框/文件/图片等） */
const NON_TYPEABLE_INPUT_TYPES = ['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image'];

/**
 * 该控件是否支持 type 输入（Node 侧纯逻辑，与页面脚本内守卫保持同一列表，供单测）。
 */
export function isTypeableElement(tag: string, type?: string): boolean {
  const t = (type ?? '').toLowerCase();
  if (tag === 'BUTTON') return false;
  if (tag === 'INPUT' && NON_TYPEABLE_INPUT_TYPES.includes(t)) return false;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function lazyElectron(): any {
  // Lazy require only; keeps vitest green without Electron binary.
  // eslint-disable-next-line no-eval
  const req = eval('require') as (id: string) => any;
  return req('electron');
}

export class BrowserService {
  private windows = new Map<string, any>();        // tabId -> BrowserWindow
  private activeTabs = new Map<string, string>();  // sessionId -> tabId
  private lastDomain = new Map<string, string>();  // tabId -> hostname
  private knownIds = new Map<string, Set<string>>();

  constructor(
    private tabPool: TabPool = new TabPool(),
    private opts: BrowserServiceOptions = {},
  ) {}

  setRequestApproval(fn: RequestApprovalFn | undefined): void {
    this.opts.requestApproval = fn;
  }

  isExecJsEnabled(): boolean {
    if (typeof this.opts.execJsEnabled === 'boolean') return this.opts.execJsEnabled;
    return process.env.STELLARA_BROWSER_JS === '1';
  }

  activeTabFor(sessionId: string): string | undefined {
    return this.activeTabs.get(sessionId);
  }

  list(sessionId: string): Array<{ id: string; url: string; title: string; active?: boolean }> {
    const active = this.activeTabs.get(sessionId);
    return this.tabPool.list(sessionId).map((t) => ({ ...t, active: t.id === active }));
  }

  get(sessionId: string): SessionBrowser {
    const sid = sessionId || 'default';
    return {
      navigate: (args, ctx) => this.doNavigate(sid, args, ctx),
      snapshot: (args, ctx) => this.doSnapshot(sid, args, ctx),
      act: (args, ctx) => this.doAct(sid, args, ctx),
      extract: (args, ctx) => this.doExtract(sid, args, ctx),
      screenshot: (args, ctx) => this.doScreenshot(sid, args, ctx),
      tabs: (args, ctx) => this.doTabs(sid, args, ctx),
      execJs: (args, ctx) => this.doExecJs(sid, args, ctx),
      stop: () => this.doStop(sid),
    };
  }

  private async ensureApproved(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    isNewDomain: boolean,
  ): Promise<boolean> {
    if (!shouldApprove(toolName, isNewDomain)) return true;
    const fn = this.opts.requestApproval;
    if (!fn) return true;
    const summary = buildApprovalSummary(toolName, args);
    return fn({ toolName, args, summary, sessionId });
  }

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
    // 禁用下载
    try {
      win.webContents.session.on('will-download', (e: any) => e.preventDefault());
    } catch {
      // session 不存在时忽略（仅测试注入场景）
    }
    // SSRF 链：快速协议/主机名检查后，再做 DNS→私网校验；命中后停止导航
    win.webContents.on('will-navigate', (e: any, url: string) => {
      if (!isAllowedBrowserUrl(url).ok) {
        e.preventDefault();
        return;
      }
      void validateUrl(url).then((v) => {
        if (!v.ok) {
          try {
            win.webContents.stop();
          } catch {
            // ignore
          }
        }
      });
    });
    win.webContents.on('will-redirect', (e: any, url: string) => {
      if (!isAllowedBrowserUrl(url).ok) {
        e.preventDefault();
        return;
      }
      void validateUrl(url).then((v) => {
        if (!v.ok) {
          try {
            win.webContents.stop();
          } catch {
            // ignore
          }
        }
      });
    });
    win.webContents.on('did-redirect-navigation', (_e: any, url: string) => {
      void validateUrl(url).then((v) => {
        if (!v.ok) {
          try {
            win.webContents.stop();
          } catch {
            // ignore
          }
        }
      });
    });
    this.windows.set(tabId, win);
    return win;
  }

  private execJsInIsolatedWorld(win: any, code: string): Promise<unknown> {
    const wc = win.webContents;
    if (wc && typeof wc.executeJavaScriptInIsolatedWorld === 'function') {
      return wc.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    }
    return wc.executeJavaScript(code);
  }

  private ensureTab(sessionId: string, tabId: string | undefined, urlForCreate: string): { tabId: string; created: boolean } {
    if (tabId) {
      this.tabPool.select(sessionId, tabId);
      this.activeTabs.set(sessionId, tabId);
      return { tabId, created: false };
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
    }
    this.getOrCreateWindow(sessionId, tab.id);
    this.activeTabs.set(sessionId, tab.id);
    return { tabId: tab.id, created: true };
  }

  /** 撤销一次新建 Tab 的副作用（审批被拒时回滚隐式创建的 Tab+窗口） */
  private rollbackTab(sessionId: string, tabId: string): void {
    const win = this.windows.get(tabId);
    if (win && typeof win.destroy === 'function') {
      try { win.destroy(); } catch { /* ignore */ }
    }
    this.windows.delete(tabId);
    this.knownIds.delete(tabId);
    this.lastDomain.delete(tabId);
    this.tabPool.close(sessionId, tabId);
    if (this.activeTabs.get(sessionId) === tabId) {
      const rest = this.tabPool.list(sessionId);
      if (rest.length) this.activeTabs.set(sessionId, rest[rest.length - 1]!.id);
      else this.activeTabs.delete(sessionId);
    }
  }

  private async doNavigate(
    sessionId: string,
    args: BrowserNavigateArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const url = (args.url ?? '').trim();
    if (!url) return { ok: false, output: '', error: '缺少 url' };
    const gate = isAllowedBrowserUrl(url);
    if (!gate.ok) return { ok: false, output: '', error: gate.error ?? 'URL 不允许' };
    const validation = await validateUrl(url);
    if (!validation.ok) return { ok: false, output: '', error: validation.error ?? 'URL 不允许' };
    let tabId: string;
    let createdTab = false;
    try {
      const res = this.ensureTab(sessionId, args.tabId, url);
      tabId = res.tabId;
      createdTab = res.created;
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const host = safeHostname(url) ?? '';
    const last = this.lastDomain.get(tabId);
    const isNew = !last || last !== host;
    const approved = await this.ensureApproved(sessionId, 'browser_navigate', { ...(args as unknown as Record<string, unknown>) }, isNew);
    if (!approved) {
      if (createdTab) this.rollbackTab(sessionId, tabId);
      return { ok: false, output: '', error: '用户拒绝了此操作' };
    }
    const win = this.getOrCreateWindow(sessionId, tabId);
    await withTimeout(win.webContents.loadURL(url), NAVIGATE_TIMEOUT_MS, '导航超时，可重试');
    this.lastDomain.set(tabId, host);
    const tab = this.tabPool.select(sessionId, tabId);
    tab.url = url;
    tab.title = url;
    return { ok: true, output: `已导航: ${url}` };
  }

  private async doSnapshot(
    sessionId: string,
    args: BrowserSnapshotArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    let tabUrl = '';
    try {
      tabUrl = this.tabPool.select(sessionId, args.tabId).url;
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const win = this.getOrCreateWindow(sessionId, args.tabId);
    const html = await withTimeout(
      this.execJsInIsolatedWorld(win, 'document.documentElement.outerHTML.slice(0,500000)'),
      JS_TIMEOUT_MS,
      '快照超时，可重试',
    );
    const snap = htmlToSnapshot(String(html ?? ''), tabUrl || 'about:blank');
    this.knownIds.set(args.tabId, new Set([...snap.links.map((l) => l.id), ...snap.forms.map((f) => f.id)]));
    return { ok: true, output: markUntrusted(snap.markdown.slice(0, 30000)) };
  }

  private async doAct(
    sessionId: string,
    args: BrowserActArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const known = this.knownIds.get(args.tabId) ?? new Set<string>();
    const v = validateActArgs(args, known);
    if (!v.ok) return { ok: false, output: '', error: v.error ?? '参数无效' };
    try {
      this.tabPool.select(sessionId, args.tabId);
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const approved = await this.ensureApproved(sessionId, 'browser_act', { ...(args as unknown as Record<string, unknown>) }, false);
    if (!approved) return { ok: false, output: '', error: '用户拒绝了此操作' };
    const win = this.getOrCreateWindow(sessionId, args.tabId);
    const wc = win.webContents;
    const notFound = (ref: string): ToolResult => ({ ok: false, output: '', error: `未找到目标元素 ${ref}（请重新 snapshot）` });
    const run = async (): Promise<ToolResult> => {
      switch (args.action) {
        case 'back': {
          if (typeof wc.canGoBack === 'function' && !wc.canGoBack()) {
            return { ok: false, output: '', error: '无法后退（没有历史记录）' };
          }
          if (typeof wc.goBack === 'function') wc.goBack();
          return { ok: true, output: '已后退' };
        }
        case 'reload':
          wc.reload();
          return { ok: true, output: '已刷新' };
        case 'scroll': {
          const dir = args.direction === 'up' ? -800 : 800;
          await this.execJsInIsolatedWorld(win, `window.scrollBy(0, ${dir})`);
          return { ok: true, output: '已滚动' };
        }
        case 'click': {
          const ref = args.targetId ?? '';
          const script = `(() => {
            const el = document.querySelectorAll('a[href]')[${refIndex(ref)}];
            if (!el) return '__NOT_FOUND__';
            el.scrollIntoView({ block: 'center' });
            el.click();
            return '__OK__';
          })()`;
          const out = await this.execJsInIsolatedWorld(win, script);
          if (out === '__NOT_FOUND__') return notFound(ref);
          return { ok: true, output: `已点击: ${ref}` };
        }
        case 'type': {
          const ref = args.targetId ?? '';
          const text = (args.text ?? '').slice(0, 2000);
          const script = `(() => {
            const el = document.querySelectorAll(${JSON.stringify(FORM_CONTROL_SELECTOR)})[${refIndex(ref)}];
            if (!el) return '__NOT_FOUND__';
            const tag = el.tagName;
            const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
            if (tag === 'BUTTON' || (tag === 'INPUT' && ${JSON.stringify(NON_TYPEABLE_INPUT_TYPES)}.indexOf(type) !== -1)) return '__NOT_TYPEABLE__:' + tag + (type ? ':' + type : '');
            el.focus();
            const val = ${JSON.stringify(text)};
            if (tag === 'SELECT') {
              el.value = val;
            } else {
              const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(el, val); else el.value = val;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return '__OK__';
          })()`;
          const out = await this.execJsInIsolatedWorld(win, script);
          if (out === '__NOT_FOUND__') return notFound(ref);
          if (typeof out === 'string' && out.startsWith('__NOT_TYPEABLE__:')) {
            const parts = out.split(':');
            const tag = (parts[1] ?? '').toLowerCase();
            const inputType = parts[2];
            const label = tag === 'input' && inputType ? `input[type=${inputType}]` : tag;
            return { ok: false, output: '', error: `目标控件不可输入（${ref} 是 ${label}）` };
          }
          return { ok: true, output: `已输入: ${text.slice(0, 200)}` };
        }
        case 'select': {
          const ref = args.targetId ?? '';
          const text = (args.text ?? '').slice(0, 2000);
          const script = `(() => {
            const el = document.querySelectorAll(${JSON.stringify(FORM_CONTROL_SELECTOR)})[${refIndex(ref)}];
            if (!el) return '__NOT_FOUND__';
            if (el.tagName !== 'SELECT') return '__NOT_SELECT__';
            el.value = ${JSON.stringify(text)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return '__OK__';
          })()`;
          const out = await this.execJsInIsolatedWorld(win, script);
          if (out === '__NOT_FOUND__') return notFound(ref);
          if (out === '__NOT_SELECT__') return { ok: false, output: '', error: `${ref} 不是下拉选择框` };
          return { ok: true, output: `已选择: ${ref}` };
        }
        case 'hover':
          return { ok: false, output: '', error: 'hover 未实现（无法模拟真实悬停，建议用 browser_exec_js）' };
        case 'press':
          return { ok: false, output: '', error: 'press 未实现（无法模拟真实按键，建议用 browser_exec_js）' };
        default:
          return { ok: false, output: '', error: `操作未实现: ${String(args.action)}` };
      }
    };
    const out = await withTimeout(run(), ACT_TIMEOUT_MS, '操作超时，可重试');
    if (!out.ok) return out;
    return { ok: true, output: markUntrusted(out.output) };
  }

  private async doExtract(
    sessionId: string,
    args: BrowserExtractArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    let tabUrl = '';
    try {
      tabUrl = this.tabPool.select(sessionId, args.tabId).url;
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const win = this.getOrCreateWindow(sessionId, args.tabId);
    const html = await withTimeout(
      this.execJsInIsolatedWorld(win, 'document.documentElement.outerHTML.slice(0,500000)'),
      JS_TIMEOUT_MS,
      '抽取超时，可重试',
    );
    if (args.kind === 'tables') {
      const body = htmlToTables(String(html ?? ''), 20000);
      return { ok: true, output: markUntrusted(body || '(无表格)') };
    }
    const snap = htmlToSnapshot(String(html ?? ''), tabUrl || 'about:blank');
    this.knownIds.set(args.tabId, new Set([...snap.links.map((l) => l.id), ...snap.forms.map((f) => f.id)]));
    if (args.kind === 'links') {
      const body = snap.links.map((l) => `[${l.id}] ${l.text} -> ${l.href}`).join('\n').slice(0, 20000);
      return { ok: true, output: markUntrusted(body || '(无链接)') };
    }
    return { ok: true, output: markUntrusted(snap.markdown.slice(0, 30000)) };
  }

  private async doScreenshot(
    sessionId: string,
    args: BrowserScreenshotArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      this.tabPool.select(sessionId, args.tabId);
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const win = this.getOrCreateWindow(sessionId, args.tabId);
    const img = (await withTimeout(win.webContents.capturePage(), ACT_TIMEOUT_MS, '截图超时，可重试')) as any;
    let buf: Buffer;
    let mime = 'image/png';
    try {
      buf = img.toPNG();
    } catch {
      buf = img.toJPEG(80);
      mime = 'image/jpeg';
    }
    let b64 = buf.toString('base64');
    if (b64.length > MAX_SCREENSHOT_B64) {
      try {
        buf = img.resize({ width: 1280 }).toJPEG(80);
        mime = 'image/jpeg';
        b64 = buf.toString('base64');
      } catch {
        return { ok: false, output: '', error: '截图压缩失败，建议改用 browser_extract 抽取文本' };
      }
      if (b64.length > MAX_SCREENSHOT_B64) {
        return { ok: false, output: '', error: '截图超过 5MB（压缩后仍超限），建议改用 browser_extract 抽取文本' };
      }
    }
    return { ok: true, output: `screenshot captured (${buf.length} bytes): data:${mime};base64,${b64}` };
  }

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
          const { tabId } = this.ensureTab(sessionId, undefined, url);
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

  private async doExecJs(
    sessionId: string,
    args: BrowserExecJsArgs,
    _ctx?: ToolExecutionContext,
  ): Promise<ToolResult> {
    if (!this.isExecJsEnabled()) {
      throw new Error('设置未开启浏览器 JS 执行（需在设置中开启后重试）');
    }
    if (!args.tabId) return { ok: false, output: '', error: '缺少 tabId' };
    if (!(args.js ?? '').trim()) return { ok: false, output: '', error: '缺少 js' };
    try {
      this.tabPool.select(sessionId, args.tabId);
    } catch (e) {
      return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
    }
    const approved = await this.ensureApproved(sessionId, 'browser_exec_js', { ...(args as unknown as Record<string, unknown>), js: args.js.slice(0, 200) }, false);
    if (!approved) return { ok: false, output: '', error: '用户拒绝了此操作' };
    const win = this.getOrCreateWindow(sessionId, args.tabId);
    const out = await withTimeout(this.execJsInIsolatedWorld(win, args.js), JS_TIMEOUT_MS, 'JS 执行超时，可重试');
    return { ok: true, output: String(out ?? '').slice(0, 20000) };
  }

  private doStop(sessionId: string): void {
    const tabId = this.activeTabs.get(sessionId);
    if (!tabId) return;
    const win = this.windows.get(tabId);
    try {
      win?.webContents?.stop?.();
    } catch { /* ignore */ }
  }
}

export const browserService = new BrowserService();
