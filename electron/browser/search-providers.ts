import { validateUrl } from '../agent/tools/web-fetch';

export interface SearchResult { title: string; url: string; snippet: string; }
export interface ISearchProvider { name: string; search(q: string, n: number): Promise<SearchResult[]>; }

const SEARCH_FETCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_BYTES = 500_000;
const SEARCH_MAX_REDIRECTS = 5;

/** 默认抓取：走 web-fetch 的 SSRF 校验链（复用导出的 validateUrl），仅接受 text/html，限时限大小 */
async function defaultDuckFetchHtml(url: string): Promise<string> {
  const validation = await validateUrl(url);
  if (!validation.ok) throw new Error(validation.error ?? 'URL 不允许');

  let currentUrl = url;
  for (let i = 0; i < SEARCH_MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'Stellara-Work/0.9', Accept: 'text/html' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) throw new Error('重定向缺少 Location 头');
      const next = new URL(location, currentUrl).href;
      const redirectCheck = await validateUrl(next);
      if (!redirectCheck.ok) throw new Error(`重定向到受限地址: ${redirectCheck.error}`);
      currentUrl = next;
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('text/html')) {
      throw new Error(`仅支持 text/html: ${contentType || '未知'}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('无法读取响应体');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (total >= SEARCH_MAX_BYTES) break;
        const remaining = SEARCH_MAX_BYTES - total;
        chunks.push(value.slice(0, remaining));
        total += Math.min(value.length, remaining);
      }
    } finally {
      reader.releaseLock();
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const chunk of chunks) {
      buf.set(chunk, off);
      off += chunk.length;
    }
    return new TextDecoder().decode(buf);
  }
  throw new Error('重定向次数超过上限');
}

export class DuckHtmlProvider implements ISearchProvider {
  name = 'duck';
  constructor(private fetchHtml: (url: string) => Promise<string> = defaultDuckFetchHtml) {}
  async search(q: string, n: number): Promise<SearchResult[]> {
    const html = await this.fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    const out: SearchResult[] = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < n) {
      out.push({ title: m[2]!.replace(/<[^>]*>/g, '').trim().slice(0, 120), url: m[1]!, snippet: '' });
    }
    return out;
  }
}

export class TavilyProvider implements ISearchProvider {
  name = 'tavily';
  constructor(private apiKey: string, private post: typeof fetch = fetch) {}
  async search(q: string, n: number): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    const r = await this.post('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey, query: q, max_results: Math.min(n, 10) }),
    });
    const j = (await r.json()) as { results?: Array<{ title: string; url: string; content: string }> };
    return (j.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: (x.content ?? '').slice(0, 300) }));
  }
}

export class BraveProvider implements ISearchProvider {
  name = 'brave';
  constructor(private apiKey: string, private get: typeof fetch = fetch) {}
  async search(q: string, n: number): Promise<SearchResult[]> {
    if (!this.apiKey) return [];
    const r = await this.get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(n, 10)}`, {
      headers: { 'X-Subscription-Token': this.apiKey },
    });
    const j = (await r.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    return (j.web?.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: (x.description ?? '').slice(0, 300) }));
  }
}

export async function searchWeb(query: string, count: number, providers: ISearchProvider[]): Promise<SearchResult[]> {
  const seen = new Set<string>(); const out: SearchResult[] = [];
  for (const p of providers) {
    try {
      for (const r of await p.search(query, count)) {
        if (!seen.has(r.url) && out.length < count) { seen.add(r.url); out.push(r); }
      }
    } catch { /* next provider */ }
    if (out.length >= count) break;
  }
  return out;
}
