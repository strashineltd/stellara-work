// electron/browser/url-policy.ts
import { isPrivateOrReservedIp, isRestrictedHostname, normalizeHostname } from '../security/net-policy';

/**
 * 内置浏览器导航门（S13）：
 * - 仅 http/https
 * - 拒绝受限主机名与私网/保留 IP 字面量（127.0.0.1 / 10.x / 169.254.x / …）
 * 深度 DNS 校验由 session-hardening 的 onBeforeRequest 负责；此处堵同步字面量绕过。
 */
export function isAllowedBrowserUrl(raw: string): { ok: boolean; error?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: `无效的 URL: ${raw}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: `浏览器只允许 http/https: ${u.protocol}` };
  }
  const h = normalizeHostname(u.hostname);
  if (isRestrictedHostname(h) || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '0.0.0.0') {
    return { ok: false, error: `不允许访问受限地址: ${h}` };
  }
  // S13：IP 字面量必须不是私网/保留（含 IPv6 映射）
  if (isPrivateOrReservedIp(h)) {
    return { ok: false, error: `不允许访问私网/保留地址: ${h}` };
  }
  return { ok: true };
}
