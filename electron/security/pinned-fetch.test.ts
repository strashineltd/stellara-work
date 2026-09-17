import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeFetch, describeFetchError, closePinnedAgent } from './pinned-fetch';

describe('safeFetch（连接期 IP Pinning）', () => {
  afterEach(async () => {
    await closePinnedAgent();
  });

  it('本机 HTTP 服务即使 URL 合法也会在连接期被拒绝（localhost → 127.0.0.1/::1）', async () => {
    const server = http.createServer((_req, res) => res.end('secret'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      let message = '';
      try {
        await safeFetch(`http://localhost:${port}/`);
      } catch (err) {
        message = describeFetchError(err);
      }
      expect(message).toContain('私网/保留 IP');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('describeFetchError 解开 fetch failed 的 cause 链', () => {
    const blocked = new Error(
      '域名 evil.example 在连接时解析到私网/保留 IP（169.254.169.254），已拒绝连接',
    );
    const outer = Object.assign(new TypeError('fetch failed'), { cause: blocked });
    expect(describeFetchError(outer)).toContain('169.254.169.254');
  });

  it('describeFetchError 处理 AggregateError', () => {
    const inner = new TypeError('fetch failed');
    const agg = new AggregateError([inner], 'all connections failed');
    expect(describeFetchError(agg)).toBe('fetch failed');
  });
});
