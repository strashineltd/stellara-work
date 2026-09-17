import { describe, it, expect } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  createPrivateIpBlockingLookup,
  PrivateAddressBlockedError,
  type LookupAll,
} from './pinned-lookup';

interface LookupOutcome {
  err: Error | null;
  address?: string | LookupAddress[];
  family?: number;
}

function callLookup(
  lookup: ReturnType<typeof createPrivateIpBlockingLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = {},
): Promise<LookupOutcome> {
  return new Promise((resolve) => {
    lookup(hostname, options, (err, address, family) => {
      resolve({ err: err ?? null, address, family });
    });
  });
}

describe('createPrivateIpBlockingLookup', () => {
  it('公网地址（无 all）返回首个解析结果', async () => {
    const base: LookupAll = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ];
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'example.com');
    expect(outcome.err).toBeNull();
    expect(outcome.address).toBe('93.184.216.34');
    expect(outcome.family).toBe(4);
  });

  it('all: true 时返回全部通过校验的地址', async () => {
    const base: LookupAll = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ];
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'example.com', {
      all: true,
    });
    expect(outcome.err).toBeNull();
    expect(outcome.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('任一解析结果为私网/保留地址即 fail-closed 拒绝（DNS Rebinding 防护）', async () => {
    const base: LookupAll = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'evil.example.com', {
      all: true,
    });
    expect(outcome.err).toBeInstanceOf(PrivateAddressBlockedError);
    expect(outcome.err?.message).toContain('私网/保留 IP');
    expect(outcome.err?.message).toContain('127.0.0.1');
  });

  it('IPv6 形式的云元数据地址同样被拦截', async () => {
    const base: LookupAll = async () => [{ address: '::ffff:a9fe:a9fe', family: 6 }];
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'metadata.evil.example');
    expect(outcome.err).toBeInstanceOf(PrivateAddressBlockedError);
  });

  it('解析失败原样向上传递', async () => {
    const base: LookupAll = async () => {
      throw Object.assign(new Error('dns boom'), { code: 'EAI_AGAIN' });
    };
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'example.com');
    expect(outcome.err?.message).toBe('dns boom');
  });

  it('无解析结果 fail-closed', async () => {
    const base: LookupAll = async () => [];
    const outcome = await callLookup(createPrivateIpBlockingLookup(base), 'example.com');
    expect(outcome.err?.message).toContain('无解析结果');
  });
});
