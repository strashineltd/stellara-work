// electron/security/net-policy.ts
// 统一 SSRF/私网判定：浏览器请求过滤（session-hardening）与 web_fetch 共用。
// IPv6 字面量先规范化（展开压缩、十六进制映射/兼容地址还原为 IPv4）再做范围判断，
// 修复 `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]` 之类的绕过。
import { isIPv4 } from 'node:net';
import dns from 'node:dns/promises';

/** 需要做 SSRF 判定的协议（其余协议不在此层处理） */
export const POLICED_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

export interface DnsAddress {
  address: string;
  family?: number;
}

export type DnsLookup = (hostname: string) => Promise<DnsAddress[]>;

export const defaultDnsLookup: DnsLookup = (hostname) =>
  dns.lookup(hostname, { all: true, family: 0 }) as Promise<DnsAddress[]>;

/** 小写、去方括号、去末尾点、去 zone id（fe80::1%en0） */
export function normalizeHostname(hostname: string): string {
  let h = (hostname ?? '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

function ipv4ToBytes(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const raw of parts) {
    // 拒绝前导零（与 node:net 的 isIPv4 一致；避免 Number('0177') 之类歧义）
    if (!/^(0|[1-9]\d{0,2})$/.test(raw)) return null;
    const n = Number(raw);
    if (n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const bytes = ipv4ToBytes(ip);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 IETF + 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isAllZero(bytes: Uint8Array): boolean {
  for (const b of bytes) if (b !== 0) return false;
  return true;
}

function dottedQuad(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

/** 将任意 IPv6 字面量解析为 16 字节；非法返回 null */
export function parseIpv6(input: string): Uint8Array | null {
  let s = normalizeHostname(input);
  if (!s.includes(':')) return null;
  const dbl = s.indexOf('::');
  if (dbl !== -1 && s.indexOf('::', dbl + 2) !== -1) return null; // 只允许一个 ::

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const raw = segment.split(':');
    const groups: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i]!;
      if (g.includes('.')) {
        if (i !== raw.length - 1) return null;
        const v4 = ipv4ToBytes(g);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        groups.push(parseInt(g, 16));
      }
    }
    return groups;
  };

  let head: number[];
  let tail: number[];
  if (dbl === -1) {
    const all = parseGroups(s);
    if (!all || all.length !== 8) return null;
    head = all;
    tail = [];
  } else {
    const h = parseGroups(s.slice(0, dbl));
    const t = parseGroups(s.slice(dbl + 2));
    if (!h || !t) return null;
    if (h.length + t.length >= 8) return null;
    head = h;
    tail = t;
  }
  const groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i]! >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i]! & 0xff;
  }
  return bytes;
}

/** IPv4 判定（含所有私网/保留范围） */
export function isPrivateOrReservedIp(ip: string): boolean {
  const raw = normalizeHostname(ip);
  if (isIPv4(raw)) return isPrivateOrReservedIpv4(raw);
  const bytes = parseIpv6(raw);
  if (!bytes) return false;

  // :: 与 ::1
  if (isAllZero(bytes)) return true;
  const first15Zero = isAllZero(bytes.subarray(0, 15));
  if (first15Zero && bytes[15] === 1) return true;

  // IPv4 映射 ::ffff:a.b.c.d 与 IPv4 兼容 ::a.b.c.d
  const first10Zero = isAllZero(bytes.subarray(0, 10));
  const first12Zero = isAllZero(bytes.subarray(0, 12));
  if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
    if (isPrivateOrReservedIpv4(dottedQuad(bytes, 12))) return true;
  } else if (first12Zero) {
    if (isPrivateOrReservedIpv4(dottedQuad(bytes, 12))) return true;
  }

  // NAT64 64:ff9b::/96 与 64:ff9b:1::/48
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    const localUse = bytes[4] === 0 && bytes[5] === 1;
    const middleZero = isAllZero(bytes.subarray(localUse ? 6 : 4, 12));
    if ((bytes[4] === 0 || localUse) && middleZero && isPrivateOrReservedIpv4(dottedQuad(bytes, 12))) {
      return true;
    }
  }

  // 6to4 2002::/16：内嵌 IPv4 在 bytes 2-5
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    if (isPrivateOrReservedIpv4(dottedQuad(bytes, 2))) return true;
  }

  // ULA fc00::/7
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  // link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  // multicast ff00::/8
  if (bytes[0] === 0xff) return true;
  // Teredo 2001::/32（隧道地址，可承载私网目标）
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) return true;
  // documentation 2001:db8::/32
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;

  return false;
}

/** 受限主机名（无需 DNS 即可判定） */
export function isRestrictedHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;
  if (h === '0.0.0.0' || h === '::') return true;
  if (h === '169.254.169.254') return true; // 云元数据（保留旧错误文案：受限地址）
  if (h === 'metadata.google.internal' || h === 'instance-data') return true;
  return false;
}

/** 同步判定：字面量私网 IP / 受限主机名（DNS 名需异步 checkUrlDestination） */
export function isBlockedDestinationUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!POLICED_PROTOCOLS.has(parsed.protocol)) return false;
  const host = normalizeHostname(parsed.hostname);
  if (isRestrictedHostname(host)) return true;
  if (isIPv4(host) || host.includes(':')) return isPrivateOrReservedIp(host);
  return false;
}

export interface CheckDestinationDeps {
  lookup?: DnsLookup;
}

/**
 * 完整校验（同步规则 + DNS 解析）。解析失败时 fail-closed 拒绝。
 */
export async function checkUrlDestination(
  raw: string | URL,
  deps: CheckDestinationDeps = {},
): Promise<{ ok: boolean; error?: string }> {
  let parsed: URL;
  if (typeof raw === 'string') {
    try {
      parsed = new URL(raw);
    } catch {
      return { ok: false, error: `无效的 URL: ${raw}` };
    }
  } else {
    parsed = raw;
  }

  if (!POLICED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: `不支持的协议: ${parsed.protocol}（只允许 http/https）` };
  }

  const host = normalizeHostname(parsed.hostname);
  if (isRestrictedHostname(host)) {
    return { ok: false, error: `不允许访问受限地址: ${host}` };
  }

  if (isIPv4(host) || host.includes(':')) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, error: `不允许访问私网/保留 IP: ${host}` };
    }
    return { ok: true };
  }

  const lookup = deps.lookup ?? defaultDnsLookup;
  let addresses: DnsAddress[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, error: `域名 ${host} 解析失败，已拒绝（安全默认）` };
  }
  if (addresses.some((a) => isPrivateOrReservedIp(a.address))) {
    return { ok: false, error: `域名 ${host} 解析到受限 IP，已拒绝` };
  }
  return { ok: true };
}
