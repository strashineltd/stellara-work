// electron/security/pinned-lookup.ts
// 连接期 DNS 校验（IP Pinning）：把私网/保留 IP 判定下沉到 TCP 连接建立时刻，
// 消除「预检解析一次、fetch 再解析一次」之间的 DNS Rebinding TOCTOU 窗口。
import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isPrivateOrReservedIp } from './net-policy';

export interface LookupAddress {
  address: string;
  family: number;
}

/** 一次性取回全部解析结果（family 0 = A + AAAA） */
export type LookupAll = (hostname: string, family: number) => Promise<LookupAddress[]>;

const nodeLookupAll: LookupAll = (hostname, family) =>
  dns.promises.lookup(hostname, { all: true, family });

/** 连接期解析到私网/保留地址时的拒绝错误（code 便于调用方识别） */
export class PrivateAddressBlockedError extends Error {
  readonly code = 'ERR_PRIVATE_ADDRESS_BLOCKED';
  constructor(hostname: string, address: string) {
    super(`域名 ${hostname} 在连接时解析到私网/保留 IP（${address}），已拒绝连接`);
    this.name = 'PrivateAddressBlockedError';
  }
}

/**
 * 生成 net/undici 兼容的 lookup：
 * - 每次建连实时解析 DNS（不复用预检结果，关闭 TOCTOU 窗口）；
 * - 任一解析结果为私网/保留地址即 fail-closed 拒绝；
 * - 返回给 socket 的地址一定是通过校验的公网地址。
 */
export function createPrivateIpBlockingLookup(
  baseLookup: LookupAll = nodeLookupAll,
): LookupFunction {
  return (hostname, options, callback) => {
    // @types/node 把回调的 address 标注为必填，但 Node 运行时在错误路径只传 err
    const fail = callback as (err: NodeJS.ErrnoException) => void;
    const wantsAll = typeof options === 'object' && options.all === true;
    const rawFamily = typeof options === 'number' ? options : options.family;
    const family = typeof rawFamily === 'number' ? rawFamily : 0;
    baseLookup(hostname, family).then(
      (addresses) => {
        const allowed: LookupAddress[] = [];
        for (const entry of addresses) {
          if (isPrivateOrReservedIp(entry.address)) {
            fail(new PrivateAddressBlockedError(hostname, entry.address));
            return;
          }
          allowed.push(entry);
        }
        if (allowed.length === 0) {
          const err: NodeJS.ErrnoException = new Error(
            `域名 ${hostname} 无解析结果，已拒绝连接（安全默认）`,
          );
          err.code = 'ENOTFOUND';
          fail(err);
          return;
        }
        if (wantsAll) {
          callback(null, allowed);
        } else {
          callback(null, allowed[0]!.address, allowed[0]!.family);
        }
      },
      (err: unknown) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      },
    );
  };
}
