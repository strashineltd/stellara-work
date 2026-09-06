// electron/browser/url-policy.ts
export function isAllowedBrowserUrl(raw: string): { ok: boolean; error?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: `无效的 URL: ${raw}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: `浏览器只允许 http/https: ${u.protocol}` };
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.localhost')) {
    return { ok: false, error: `不允许访问受限地址: ${h}` };
  }
  return { ok: true };
}
