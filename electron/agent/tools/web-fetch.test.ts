import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetch, validateUrl, UNTRUSTED_MARKER, resolveMaxBytes } from './web-fetch';

// Mock dns/promises
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from 'node:dns/promises';

const mockDns = vi.mocked(dns);

function mockFetch(body: string, init?: ResponseInit & { headers?: Record<string, string> }) {
  const headers = new Headers(init?.headers);
  const resp = new Response(body, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp));
}

function mockFetchError(err: Error) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webFetch', () => {
  it('fetches HTTPS public URL successfully', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch('<html><body>Hello World</body></html>', {
      headers: { 'content-type': 'text/html' },
    });
    const result = await webFetch({ url: 'https://example.com' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Hello World');
    expect(result.output).toContain('未可信');
  });

  it('rejects localhost', async () => {
    const result = await webFetch({ url: 'http://localhost:8080' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('受限');
  });

  it('rejects 127.0.0.1', async () => {
    const result = await webFetch({ url: 'http://127.0.0.1' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects ::1 (IPv6 loopback)', async () => {
    const result = await webFetch({ url: 'http://[::1]' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects hex-encoded IPv4-mapped IPv6 (H3)', async () => {
    const result = await webFetch({ url: 'http://[::ffff:7f00:1]/' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects hex-encoded IPv4-mapped cloud metadata address (H3)', async () => {
    const result = await webFetch({ url: 'http://[::ffff:a9fe:a9fe]/' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects dotted IPv4-mapped cloud metadata address after URL canonicalization (H3)', async () => {
    const result = await webFetch({ url: 'http://[::ffff:169.254.169.254]/' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects ULA fd00::/8 (H3)', async () => {
    const result = await webFetch({ url: 'http://[fd00::1]/' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('allows a public IPv6 literal (H3)', async () => {
    mockFetch('ok', { headers: { 'content-type': 'text/plain' } });
    const result = await webFetch({ url: 'http://[2606:4700:4700::1111]/' }, '/tmp');
    expect(result.ok).toBe(true);
  });

  it('rejects hex-encoded IPv4-compatible IPv6 (H3)', async () => {
    const result = await webFetch({ url: 'http://[::7f00:1]/' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects private IP 10.x.x.x', async () => {
    const result = await webFetch({ url: 'http://10.0.0.1' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects private IP 192.168.x.x', async () => {
    const result = await webFetch({ url: 'http://192.168.1.1' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects private IP 172.16.x.x', async () => {
    const result = await webFetch({ url: 'http://172.16.0.1' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网');
  });

  it('rejects cloud metadata IP 169.254.169.254', async () => {
    const result = await webFetch({ url: 'http://169.254.169.254' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('受限');
  });

  it('rejects DNS resolving to private IP', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    const result = await webFetch({ url: 'https://evil.example.com' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('受限');
  });

  it('rejects unsafe redirect to localhost', async () => {
    // 第一次请求返回重定向到 localhost
    const redirectResp = new Response(null, {
      status: 302,
      headers: { location: 'http://localhost/secret' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(redirectResp));
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    const result = await webFetch({ url: 'https://example.com' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('受限');
  });

  it('truncates body exceeding maxBytes', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const bigBody = 'x'.repeat(1000);
    mockFetch(bigBody, { headers: { 'content-type': 'text/plain' } });
    const result = await webFetch({ url: 'https://example.com', maxBytes: 100 }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(100 + 200); // marker + content
  });

  it('rejects non-text Content-Type', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch('binary data', { headers: { 'content-type': 'application/octet-stream' } });
    const result = await webFetch({ url: 'https://example.com/file.bin' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('内容类型');
  });

  it('rejects ftp protocol', async () => {
    const result = await webFetch({ url: 'ftp://example.com' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('协议');
  });

  it('rejects 0.0.0.0', async () => {
    const result = await webFetch({ url: 'http://0.0.0.0' }, '/tmp');
    expect(result.ok).toBe(false);
  });

  it('rejects .local hostname', async () => {
    const result = await webFetch({ url: 'http://myhost.local' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('受限');
  });

  it('adds untrusted content marker', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch('<p>content</p>', { headers: { 'content-type': 'text/html' } });
    const result = await webFetch({ url: 'https://example.com' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/^⚠️.*未可信/);
  });

  it('extracts links table with ref ids', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch('<html><body><a href="https://a.com/x">Hello</a><p>World</p></body></html>', {
      headers: { 'content-type': 'text/html' },
    });
    const result = await webFetch({ url: 'https://example.com' }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('[links]');
    expect(result.output).toContain('Hello -> https://a.com/x');
  });

  it('exports validateUrl and UNTRUSTED_MARKER for reuse', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const v = await validateUrl('https://example.com');
    expect(v.ok).toBe(true);
    expect(UNTRUSTED_MARKER).toContain('未可信');
  });
});

describe('resolveMaxBytes (M11)', () => {
  it('缺省时使用默认 500000', () => {
    expect(resolveMaxBytes(undefined)).toBe(500_000);
  });

  it('非正数 / NaN / Infinity 回退默认', () => {
    expect(resolveMaxBytes(0)).toBe(500_000);
    expect(resolveMaxBytes(-1)).toBe(500_000);
    expect(resolveMaxBytes(Number.NaN)).toBe(500_000);
    expect(resolveMaxBytes(Number.POSITIVE_INFINITY)).toBe(500_000);
  });

  it('合法值原样返回', () => {
    expect(resolveMaxBytes(100)).toBe(100);
    expect(resolveMaxBytes(500_000)).toBe(500_000);
    expect(resolveMaxBytes(2_000_000)).toBe(2_000_000);
  });

  it('超过硬上限 2000000 时截断', () => {
    expect(resolveMaxBytes(2_000_001)).toBe(2_000_000);
    expect(resolveMaxBytes(Number.MAX_SAFE_INTEGER)).toBe(2_000_000);
  });

  it('maxBytes 为负时按默认值抓取，而非返回空内容', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockFetch('hello world', { headers: { 'content-type': 'text/plain' } });
    const result = await webFetch({ url: 'https://example.com', maxBytes: -1 }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('maxBytes 超过硬上限时响应体按 2000000 字节截断', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const body = 'x'.repeat(2_100_000);
    mockFetch(body, { headers: { 'content-type': 'text/plain' } });
    const result = await webFetch({ url: 'https://example.com', maxBytes: 5_000_000 }, '/tmp');
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(UNTRUSTED_MARKER.length + 2_000_000);
    expect(result.output.length).toBeGreaterThan(UNTRUSTED_MARKER.length + 1_500_000);
  });
});
