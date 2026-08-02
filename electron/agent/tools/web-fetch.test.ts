import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetch } from './web-fetch';

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
});
