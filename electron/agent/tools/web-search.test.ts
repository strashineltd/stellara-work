import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DuckHtmlProvider } from '../../browser/search-providers';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}));
vi.mock('../../config/secrets', () => ({
  getKey: vi.fn(),
}));
vi.mock('../../config/config-v2', () => ({
  loadConfig: vi.fn(),
}));

import dns from 'node:dns/promises';
import { getKey } from '../../config/secrets';
import { loadConfig } from '../../config/config-v2';
import { buildSearchProviders, webSearch } from './web-search';

const mockDns = vi.mocked(dns);
const mockGetKey = vi.mocked(getKey);
const mockLoadConfig = vi.mocked(loadConfig);

/** 按 URL 分发的全局 fetch stub：tavily=POST JSON，duck=GET HTML */
function stubFetchByUrl(tavily: () => Response | Promise<Response>, duckHtml: string) {
  const fn = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    if (String(url).includes('api.tavily.com')) return Promise.resolve(tavily());
    if (String(url).includes('html.duckduckgo.com')) {
      return Promise.resolve(
        new Response(duckHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
    }
    return Promise.reject(new Error(`unexpected url: ${url} (method=${init?.method})`));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDns.lookup.mockReset();
  mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mockGetKey.mockReset();
  mockLoadConfig.mockReset();
  mockLoadConfig.mockResolvedValue({ app: { browser: { searchProvider: 'auto' } } } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DuckHtmlProvider', () => {
  it('parses html results without network', async () => {
    const html = '<a class="result__a" href="https://ex.com/a">T1</a><a class="result-snippet">S1</a>';
    const p = new DuckHtmlProvider(async () => html);
    const res = await p.search('hello', 5);
    expect(res[0]!.url).toContain('ex.com');
    expect(res[0]!.title).toBe('T1');
  });
});

describe('buildSearchProviders', () => {
  it('auto: only Duck when no keys configured', () => {
    expect(buildSearchProviders('auto', '', '').map((p) => p.name)).toEqual(['duck']);
  });

  it('auto: keyed providers first, Duck fallback last', () => {
    expect(buildSearchProviders('auto', 'tvly-1', 'bsa-1').map((p) => p.name)).toEqual(['tavily', 'brave', 'duck']);
  });

  it('duck: always only Duck', () => {
    expect(buildSearchProviders('duck', 'tvly-1', 'bsa-1').map((p) => p.name)).toEqual(['duck']);
  });

  it('tavily: Tavily first, Duck fallback; no key means Duck only', () => {
    expect(buildSearchProviders('tavily', 'tvly-1', '').map((p) => p.name)).toEqual(['tavily', 'duck']);
    expect(buildSearchProviders('tavily', '', '').map((p) => p.name)).toEqual(['duck']);
  });

  it('brave: Brave first, Duck fallback; no key means Duck only', () => {
    expect(buildSearchProviders('brave', '', 'bsa-1').map((p) => p.name)).toEqual(['brave', 'duck']);
    expect(buildSearchProviders('brave', '', '').map((p) => p.name)).toEqual(['duck']);
  });
});

describe('webSearch with configured providers', () => {
  it('uses the configured provider and marks its source', async () => {
    mockGetKey.mockImplementation((id: string) => (id === 'browser-tavily' ? 'tvly-1' : null));
    mockLoadConfig.mockResolvedValue({ app: { browser: { searchProvider: 'tavily' } } } as never);
    const fetchFn = stubFetchByUrl(
      () =>
        new Response(
          JSON.stringify({ results: [{ title: 'T1', url: 'https://ex.com/a', content: 'snip' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      '',
    );

    const result = await webSearch({ query: 'hello' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('搜索源: tavily');
    expect(result.output).toContain('https://ex.com/a');
    const tavilyCall = fetchFn.mock.calls.find(([url]) => String(url).includes('api.tavily.com'));
    expect(tavilyCall).toBeTruthy();
    expect((tavilyCall![1] as { body: string }).body).toContain('tvly-1');
  });

  it('falls back to Duck when the keyed provider fails, noting the real source', async () => {
    mockGetKey.mockImplementation((id: string) => (id === 'browser-tavily' ? 'tvly-1' : null));
    mockLoadConfig.mockResolvedValue({ app: { browser: { searchProvider: 'tavily' } } } as never);
    stubFetchByUrl(() => Promise.reject(new Error('network down')), '<a class="result__a" href="https://duck.example/x">D1</a>');

    const result = await webSearch({ query: 'hello' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('搜索源: duck');
    expect(result.output).toContain('https://duck.example/x');
  });

  it('auto with no keys still searches via Duck', async () => {
    mockGetKey.mockReturnValue(null);
    mockLoadConfig.mockResolvedValue({ app: { browser: { searchProvider: 'auto' } } } as never);
    stubFetchByUrl(() => Promise.reject(new Error('unused')), '<a class="result__a" href="https://duck.example/y">D2</a>');

    const result = await webSearch({ query: 'hello' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('搜索源: duck');
    expect(result.output).toContain('https://duck.example/y');
  });

  it('no results anywhere: honest error', async () => {
    mockGetKey.mockReturnValue(null);
    stubFetchByUrl(() => Promise.reject(new Error('unused')), '');
    const result = await webSearch({ query: 'hello' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('无搜索结果');
  });
});