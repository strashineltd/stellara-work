import { describe, expect, it } from 'vitest';
import { isMainWindowWebContents, isSafeBrowserUrl, isSafeExternalUrl, isSameOrigin } from './url-guard';

describe('isSafeExternalUrl', () => {
  it('允许 https 链接', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=1#c')).toBe(true);
  });

  it('允许 http 链接', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('允许 mailto 链接', () => {
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  it('拒绝 file 协议', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('file:///Applications/Calculator.app')).toBe(false);
  });

  it('拒绝 smb 与局域网协议', () => {
    expect(isSafeExternalUrl('smb://192.168.1.10/share')).toBe(false);
  });

  it('拒绝自定义协议', () => {
    expect(isSafeExternalUrl('custom-proto://whatever')).toBe(false);
    expect(isSafeExternalUrl('vscode://file/path')).toBe(false);
  });

  it('拒绝 javascript 协议', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('拒绝大写/混合大小写危险协议', () => {
    expect(isSafeExternalUrl('FILE:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('JaVaScRiPt:alert(1)')).toBe(false);
  });

  it('拒绝无协议相对路径', () => {
    expect(isSafeExternalUrl('/etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('../../etc/passwd')).toBe(false);
  });

  it('拒绝畸形 URL', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('not a url at all')).toBe(false);
  });

  it('拒绝带空格的 URL', () => {
    expect(isSafeExternalUrl('https://exa mple.com')).toBe(false);
  });
});

describe('isSafeBrowserUrl', () => {
  it('isSafeBrowserUrl allows only http/https', () => {
    expect(isSafeBrowserUrl('https://ex.com')).toBe(true);
    expect(isSafeBrowserUrl('file:///x')).toBe(false);
    expect(isSafeBrowserUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('isSameOrigin', () => {
  const origin = 'http://localhost:5173';

  it('允许同源路径、查询与哈希', () => {
    expect(isSameOrigin('http://localhost:5173/', origin)).toBe(true);
    expect(isSameOrigin('http://localhost:5173/index.html?x=1#h', origin)).toBe(true);
  });

  it('拒绝前缀欺骗域名', () => {
    expect(isSameOrigin('http://localhost:5173.evil.com/', origin)).toBe(false);
  });

  it('拒绝 userinfo 欺骗', () => {
    expect(isSameOrigin('http://localhost:5173@evil.com/', origin)).toBe(false);
  });

  it('拒绝不同端口或协议', () => {
    expect(isSameOrigin('http://localhost:5174/', origin)).toBe(false);
    expect(isSameOrigin('https://localhost:5173/', origin)).toBe(false);
  });

  it('拒绝畸形 URL', () => {
    expect(isSameOrigin('not a url at all', origin)).toBe(false);
    expect(isSameOrigin('', origin)).toBe(false);
  });
});

describe('isMainWindowWebContents', () => {
  const mainContents = { id: 'main' };
  const browserViewContents = { id: 'browser-view' };

  it('接受与主窗口相同的 webContents', () => {
    expect(isMainWindowWebContents(mainContents, mainContents)).toBe(true);
  });

  it('拒绝浏览器视图等其他 webContents', () => {
    expect(isMainWindowWebContents(browserViewContents, mainContents)).toBe(false);
  });

  it('拒绝主窗口缺失或两者皆空', () => {
    expect(isMainWindowWebContents(mainContents, undefined)).toBe(false);
    expect(isMainWindowWebContents(null, null)).toBe(false);
    expect(isMainWindowWebContents(undefined, undefined)).toBe(false);
  });
});
