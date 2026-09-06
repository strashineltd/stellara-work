import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DuckHtmlProvider } from './search-providers';

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from 'node:dns/promises';

const mockDns = vi.mocked(dns);

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DuckHtmlProvider default fetch', () => {
  it('fetches real html with SSRF-validated fetch (User-Agent, text/html)', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<a class="result__a" href="https://ex.com/a">T1</a>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const p = new DuckHtmlProvider();
    const res = await p.search('hello', 5);

    expect(res[0]!.title).toBe('T1');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('html.duckduckgo.com');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: expect.objectContaining({ 'User-Agent': 'Stellara-Work/0.9' }),
    });
  });

  it('rejects private target (SSRF chain) — search rejects, no fake results', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn());
    const p = new DuckHtmlProvider();
    await expect(p.search('hello', 5)).rejects.toThrow();
  });

  it('rejects non-html content type', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const p = new DuckHtmlProvider();
    await expect(p.search('hello', 5)).rejects.toThrow();
  });

  it('keeps injected-stub constructor for tests', async () => {
    const p = new DuckHtmlProvider(async () => '<a class="result__a" href="https://ex.com/b">T2</a>');
    const res = await p.search('hello', 5);
    expect(res[0]!.title).toBe('T2');
  });
});