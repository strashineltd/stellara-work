// electron/security/pinned-fetch.ts
// 用 undici 自定义 Agent 把连接期 IP 校验注入 fetch：
// TCP 建连时经 createPrivateIpBlockingLookup 解析并校验 Socket IP，
// 私网/保留地址（含云元数据 169.254.169.254）直接中断，杜绝 DNS Rebinding 二次解析窗口。
import { Agent, fetch as undiciFetch } from 'undici';
import type { LookupFunction } from 'node:net';
import { createPrivateIpBlockingLookup, PrivateAddressBlockedError, type LookupAll, type LookupAddress } from './pinned-lookup';

let pinnedAgent: Agent | null = null;
let llmAgent: Agent | null = null;

function getPinnedAgent(): Agent {
  if (pinnedAgent === null) {
    pinnedAgent = new Agent({ connect: { lookup: createPrivateIpBlockingLookup() } });
  }
  return pinnedAgent;
}

/**
 * LLM 端点专用 lookup：允许回环/私网（自建 Ollama、内网推理服务），
 * 但连接期拒绝云元数据 / 链路本地，关闭 rebinding 到 metadata 的窗口。
 */
function createLlmConnectLookup(baseLookup: LookupAll = defaultLookupAll): LookupFunction {
  return (hostname, options, callback) => {
    const fail = callback as (err: NodeJS.ErrnoException) => void;
    const wantsAll = typeof options === 'object' && options.all === true;
    const rawFamily = typeof options === 'number' ? options : options.family;
    const family = typeof rawFamily === 'number' ? rawFamily : 0;
    const isBlockedLlmAddr = (addr: string): boolean => {
      const a = addr.replace(/^\[|\]$/g, '').toLowerCase();
      if (a.startsWith('169.254.')) return true;
      if (a.startsWith('fe80:')) return true;
      const mapped = /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)/.exec(a)?.[1];
      if (mapped?.startsWith('169.254.')) return true;
      return false;
    };
    baseLookup(hostname, family).then(
      (addresses) => {
        const allowed: LookupAddress[] = [];
        for (const entry of addresses) {
          if (isBlockedLlmAddr(entry.address)) {
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

const defaultLookupAll: LookupAll = async (hostname, family) => {
  const dns = await import('node:dns/promises');
  return dns.lookup(hostname, { all: true, family });
};

function getLlmAgent(): Agent {
  if (llmAgent === null) {
    llmAgent = new Agent({ connect: { lookup: createLlmConnectLookup() } });
  }
  return llmAgent;
}

/** 与全局 fetch 同形（当前仅支持字符串 URL）。 */
export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await undiciFetch(
    input,
    { ...init, dispatcher: getPinnedAgent() } as unknown as Parameters<typeof undiciFetch>[1],
  );
  return response as unknown as Response;
}

/** LLM 客户端 fetch：允许私网自建端点，连接期拦截云元数据（S10）。 */
export async function safeFetchLlm(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await undiciFetch(
    input,
    { ...init, dispatcher: getLlmAgent() } as unknown as Parameters<typeof undiciFetch>[1],
  );
  return response as unknown as Response;
}

/** 提取 undici 失败链上最有信息量的错误文案（外层多为 TypeError: fetch failed）。 */
export function describeFetchError(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0];
      continue;
    }
    if (current instanceof Error && current.cause !== undefined && current.cause !== current) {
      current = current.cause;
      continue;
    }
    break;
  }
  return current instanceof Error ? current.message : String(current);
}

/** 测试 / 退出清理：关闭并重置连接池。 */
export async function closePinnedAgent(): Promise<void> {
  const agents = [pinnedAgent, llmAgent];
  pinnedAgent = null;
  llmAgent = null;
  for (const agent of agents) {
    if (agent !== null) await agent.close();
  }
}
