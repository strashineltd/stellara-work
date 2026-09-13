import { describe, it, expect, vi } from 'vitest';
import {
  checkUrlDestination,
  isBlockedDestinationUrl,
  isPrivateOrReservedIp,
  isRestrictedHostname,
  normalizeHostname,
} from './net-policy';

describe('isPrivateOrReservedIp (IPv4)', () => {
  it('blocks loopback / private / link-local / unspecified', () => {
    for (const ip of [
      '127.0.0.1',
      '127.255.255.254',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '0.1.2.3',
      '100.64.0.1',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4 and boundary-adjacent public ranges', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '192.169.0.1', '11.0.0.1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });

  it('blocks TEST-NET, benchmarking and IETF protocol assignment ranges (P1 review)', () => {
    for (const ip of [
      '192.0.2.1',
      '192.0.2.254',
      '198.51.100.10',
      '203.0.113.10',
      '198.18.0.1',
      '198.19.255.255',
      '192.0.0.1',
      '192.0.0.255',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('still allows adjacent public IPv4 outside those ranges (P1 review)', () => {
    for (const ip of ['192.0.1.1', '192.0.3.1', '198.20.0.1', '203.0.114.1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe('isPrivateOrReservedIp (IPv6 canonicalization)', () => {
  it('blocks loopback and unspecified in short and full form', () => {
    for (const ip of ['::1', '0:0:0:0:0:0:0:1', '::', '0:0:0:0:0:0:0:0']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('blocks ULA fc00::/7 and link-local fe80::/10', () => {
    for (const ip of ['fd00::1', 'FD00::1', 'fc00::', 'fe80::1', 'fe80::dead:beef']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('blocks hex-encoded IPv4-mapped addresses (H3)', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '::ffff:0a00:1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('blocks hex-encoded IPv4-compatible addresses (H3)', () => {
    for (const ip of ['::7f00:1', '::127.0.0.1', '::a00:1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('blocks NAT64 / 6to4 addresses that embed a private IPv4', () => {
    for (const ip of ['64:ff9b::7f00:1', '64:ff9b:1::a00:1', '2002:7f00:1::']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
    expect(isPrivateOrReservedIp('64:ff9b::808:808')).toBe(false);
    expect(isPrivateOrReservedIp('2002:0808:0808::')).toBe(false);
  });

  it('blocks Teredo 2001::/32 (P1 review)', () => {
    for (const ip of [
      '2001::1',
      '2001:0:1:2:3:4:5:6',
      '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6, including mapped/compat with public IPv4', () => {
    for (const ip of [
      '2001:4860:4860::8888',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
      '::ffff:0808:0808',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe('additional reserved ranges (final re-review D)', () => {
  it('blocks 192.88.99.0/24, 2001:2::/48, 100::/64 and 3fff::/20', () => {
    for (const ip of [
      '192.88.99.0',
      '192.88.99.1',
      '192.88.99.255',
      '2001:2::',
      '2001:2::1',
      '2001:2:0:ffff::1',
      '100::',
      '100::1',
      '100::dead:beef',
      '3fff::',
      '3fff::1',
      '3fff:fff:ffff::1',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('keeps addresses adjacent to the new ranges allowed', () => {
    for (const ip of [
      '192.88.98.255',
      '192.88.100.0',
      '2001:1::1',
      '2001:3::1',
      '100:0:0:1::1',
      '4000::1',
      '3f00::1',
      '3fff:1000::1',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe('isRestrictedHostname', () => {
  it('blocks localhost variants, 0.0.0.0/[::], .local and metadata names', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'localhost.',
      'foo.localhost',
      'foo.local',
      '0.0.0.0',
      '::',
      '[::]',
      '169.254.169.254',
      'metadata.google.internal',
      'instance-data',
    ]) {
      expect(isRestrictedHostname(host), host).toBe(true);
    }
  });

  it('allows ordinary hostnames', () => {
    for (const host of ['example.com', 'a.local.com', 'notlocalhost', 'sub.example.localhost.evil.com']) {
      expect(isRestrictedHostname(host), host).toBe(false);
    }
  });
});

describe('normalizeHostname', () => {
  it('lowercases, strips brackets and a trailing dot', () => {
    expect(normalizeHostname('[::1]')).toBe('::1');
    expect(normalizeHostname('Example.COM.')).toBe('example.com');
  });
});

describe('isBlockedDestinationUrl (sync)', () => {
  it('blocks literal private IPs and restricted hostnames in http(s)/ws(s) URLs', () => {
    for (const url of [
      'http://127.0.0.1/x',
      'https://10.0.0.1/',
      'http://[::ffff:7f00:1]/',
      'http://[::7f00:1]/',
      'http://localhost:3000/',
      'http://sub.local/',
      'ws://127.0.0.1:8080/',
      'http://0.0.0.0/',
      'http://[::]/',
    ]) {
      expect(isBlockedDestinationUrl(url), url).toBe(true);
    }
  });

  it('does not sync-block public hosts (DNS decided later) or non-policed schemes', () => {
    expect(isBlockedDestinationUrl('https://example.com/a')).toBe(false);
    expect(isBlockedDestinationUrl('https://evil.example.com/')).toBe(false);
    expect(isBlockedDestinationUrl('file:///etc/passwd')).toBe(false);
    expect(isBlockedDestinationUrl('not a url')).toBe(false);
  });
});

describe('checkUrlDestination (async DNS)', () => {
  it('allows a public hostname resolving to public IPs', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const r = await checkUrlDestination('https://example.com/a', { lookup });
    expect(r.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith('example.com');
  });

  it('blocks a hostname resolving to a private IP', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '192.168.1.100', family: 4 }]);
    const r = await checkUrlDestination('https://evil.example.com/', { lookup });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('受限');
  });

  it('fails closed when DNS resolution errors', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const r = await checkUrlDestination('https://maybe-evil.example.com/', { lookup });
    expect(r.ok).toBe(false);
  });

  it('blocks restricted hosts and literal private IPs without any DNS lookup', async () => {
    const lookup = vi.fn();
    for (const url of ['http://localhost/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.1/']) {
      const r = await checkUrlDestination(url, { lookup });
      expect(r.ok, url).toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports invalid URLs', async () => {
    const r = await checkUrlDestination('http://[');
    expect(r.ok).toBe(false);
  });
});
