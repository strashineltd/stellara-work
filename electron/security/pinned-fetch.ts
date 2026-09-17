// electron/security/pinned-fetch.ts
// 用 undici 自定义 Agent 把连接期 IP 校验注入 fetch：
// TCP 建连时经 createPrivateIpBlockingLookup 解析并校验 Socket IP，
// 私网/保留地址（含云元数据 169.254.169.254）直接中断，杜绝 DNS Rebinding 二次解析窗口。
import { Agent, fetch as undiciFetch } from 'undici';
import { createPrivateIpBlockingLookup } from './pinned-lookup';

let pinnedAgent: Agent | null = null;

function getPinnedAgent(): Agent {
  if (pinnedAgent === null) {
    pinnedAgent = new Agent({ connect: { lookup: createPrivateIpBlockingLookup() } });
  }
  return pinnedAgent;
}

/** 与全局 fetch 同形（当前仅支持字符串 URL）。 */
export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await undiciFetch(
    input,
    { ...init, dispatcher: getPinnedAgent() } as unknown as Parameters<typeof undiciFetch>[1],
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
  const agent = pinnedAgent;
  pinnedAgent = null;
  if (agent !== null) await agent.close();
}
