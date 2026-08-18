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
