import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './url-guard';

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
