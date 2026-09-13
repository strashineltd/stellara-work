/**
 * 外链 URL 安全校验
 *
 * shell.openExternal 只应打开 http/https/mailto。
 * 其余协议（file/smb/自定义协议等）可打开本地文件、局域网资源或触发外部应用，
 * 一律拒绝。
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return SAFE_PROTOCOLS.has(url.protocol);
}

export function isSafeBrowserUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/**
 * 严格同源校验（origin 全等）。
 * 不能使用 startsWith：`http://localhost:5173.evil.com` 与
 * `http://localhost:5173@evil.com` 都能通过前缀匹配但 origin 不同。
 */
export function isSameOrigin(raw: string, origin: string): boolean {
  try {
    return new URL(raw).origin === origin;
  } catch {
    return false;
  }
}

/**
 * 仅主窗口 webContents 的页面导航允许外部化到系统浏览器；
 * 浏览器视图（WebContentsView）由 BrowserService 自身的导航策略处理。
 */
export function isMainWindowWebContents(contents: unknown, mainContents: unknown): boolean {
  return contents != null && mainContents != null && contents === mainContents;
}
