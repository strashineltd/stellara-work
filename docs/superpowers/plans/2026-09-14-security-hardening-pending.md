# Stellara Work 安全加固续作实施计划（2026-09-14）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `docs/security-audit/2026-09-14-pending-tasks.md` 中 4 项未完成加固（web_fetch 连接期 IP Pinning、safeStorage 明文降级 UI 警示、sed `-i` 拦截、macOS entitlements/公证凭据流文档），并做全量回归与类型检查。

**Architecture:**
- IP Pinning：新增 `undici` 生产依赖，用自定义 `Agent({ connect: { lookup } })` 把私网/保留 IP 判定下沉到 TCP 建连瞬间；`web_fetch` 改用该 Agent 驱动的 `safeFetch`，原 `checkUrlDestination` 预检保留为纵深防御。
- safeStorage 感知：主进程 `secrets.ts` 暴露 `isEncryptionEnabled()`，`app:getInfo` 返回 `secretStorage` 字段，设置-模型面板在 `plaintext` 时显示警示横幅。
- sed 拦截：在 `shell.ts` 的工具级拒绝函数中拦截 `-i` / `--in-place`（含 `-ni`、`-i.bak` 等短选项簇与 `--in-place=.bak`）。
- macOS：新增主进程/子进程 entitlements plist 并在 `package.json` 显式关联；在 macOS 迁移文档补签名与公证凭据流说明（electron-builder 26 已内置 env 凭据自动化）。

**Tech Stack:** TypeScript 7、Electron 43（Node 24）、undici 8.9、Vitest 4、electron-builder 26、React 19。

**Spec:** `docs/security-audit/2026-09-14-pending-tasks.md`

## Global Constraints

- 开发与 CI 使用 Node 22（CI `node-version: 22`）；`undici@^8.9.0` 要求 Node >= 22.19（Electron 43 内置 Node 24 满足）。
- 除 `undici`（生产依赖，`dependencies`）外**不新增任何依赖**；不升级已有依赖。
- 保留 `checkUrlDestination` 预检逻辑与行为不变（`net-policy.ts` 不改），连接期校验是纵深防御的第二层。
- 不修改 `electron/mcp/**`、浏览器工具或其他 fetch 调用方（本次范围仅 `web_fetch`）。
- 所有新增代码走 TDD：先写失败测试，再实现，再跑通。
- 单文件测试命令统一用 `npx vitest run <相对路径>`；全量用 `npm test`；类型检查用 `npm run typecheck`。
- 仓库当前没有可用的 ESLint 配置文件（`npm run lint` 不参与本次验证）。
- **除非用户明确要求，不要执行 `git commit` / `git push`。**
- 源码注释使用中文，风格与现有文件一致（解释安全动机，不逐行翻译代码）。

---

### Task 1: 引入 undici 并实现连接期私网 IP 拦截 lookup（pinned-lookup）

**Files:**
- Modify: `package.json`（dependencies 增加 undici）
- Modify: `package-lock.json`（由 npm 自动更新）
- Create: `electron/security/pinned-lookup.ts`
- Test: `electron/security/pinned-lookup.test.ts`

**Interfaces:**
- Consumes: `isPrivateOrReservedIp(ip: string): boolean`（`electron/security/net-policy.ts`，已存在）
- Produces:
  - `interface LookupAddress { address: string; family: number }`
  - `type LookupAll = (hostname: string, family: number) => Promise<LookupAddress[]>`
  - `class PrivateAddressBlockedError extends Error`（`code = 'ERR_PRIVATE_ADDRESS_BLOCKED'`）
  - `function createPrivateIpBlockingLookup(baseLookup?: LookupAll): LookupFunction`（`LookupFunction` 来自 `node:net`）

- [ ] **Step 1: 安装 undici 生产依赖**

运行：

```bash
npm install undici@8.9.0
```

预期：`package.json` 的 `dependencies` 出现 `"undici": "^8.9.0"`；`package-lock.json` 更新；安装无报错（该版本已在 node_modules 中被 jsdom 传递使用）。

- [ ] **Step 2: 写失败测试** `electron/security/pinned-lookup.test.ts`

```ts
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
```

- [ ] **Step 3: 运行测试确认失败**

运行：`npx vitest run electron/security/pinned-lookup.test.ts`

预期：FAIL，报错 `Failed to resolve import "./pinned-lookup"`（或 `Cannot find module`）。

- [ ] **Step 4: 实现** `electron/security/pinned-lookup.ts`

```ts
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
    const wantsAll = typeof options === 'object' && options.all === true;
    const rawFamily = typeof options === 'number' ? options : options.family;
    const family = typeof rawFamily === 'number' ? rawFamily : 0;
    baseLookup(hostname, family).then(
      (addresses) => {
        const allowed: LookupAddress[] = [];
        for (const entry of addresses) {
          if (isPrivateOrReservedIp(entry.address)) {
            callback(new PrivateAddressBlockedError(hostname, entry.address));
            return;
          }
          allowed.push(entry);
        }
        if (allowed.length === 0) {
          const err: NodeJS.ErrnoException = new Error(
            `域名 ${hostname} 无解析结果，已拒绝连接（安全默认）`,
          );
          err.code = 'ENOTFOUND';
          callback(err);
          return;
        }
        if (wantsAll) {
          callback(null, allowed);
        } else {
          callback(null, allowed[0]!.address, allowed[0]!.family);
        }
      },
      (err: unknown) => {
        callback(err instanceof Error ? err : new Error(String(err)));
      },
    );
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

运行：`npx vitest run electron/security/pinned-lookup.test.ts`

预期：6 个用例全部 PASS。

- [ ] **Step 6: electron 类型检查**

运行：`npx tsc -p electron/tsconfig.json --noEmit`

预期：exit 0（若 `options.family` 类型报错，按 `dns.LookupOptions` 定义做最小调整，不得放宽为 `any`）。

---

### Task 2: pinned-fetch（undici Agent + safeFetch + 错误链解析）

**Files:**
- Create: `electron/security/pinned-fetch.ts`
- Test: `electron/security/pinned-fetch.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPrivateIpBlockingLookup`
- Produces:
  - `function safeFetch(input: string, init?: RequestInit): Promise<Response>`（与全局 fetch 同形）
  - `function describeFetchError(err: unknown): string`（解开 `TypeError: fetch failed` 的 `cause` 链）
  - `function closePinnedAgent(): Promise<void>`（测试 / 退出清理）

- [ ] **Step 1: 写失败测试** `electron/security/pinned-fetch.test.ts`

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npx vitest run electron/security/pinned-fetch.test.ts`

预期：FAIL，报错 `Failed to resolve import "./pinned-fetch"`。

- [ ] **Step 3: 实现** `electron/security/pinned-fetch.ts`

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

运行：`npx vitest run electron/security/pinned-fetch.test.ts`

预期：3 个用例全部 PASS。若第一个用例失败且提示找不到 `私网/保留 IP`，打印 `err.cause` 的实际结构并调整 `describeFetchError`（undici 失败链形态：外层 `TypeError: fetch failed` + `cause` 为 lookup 错误，已在本机 Node 22 / Electron Node 24 验证）。

- [ ] **Step 5: electron 类型检查**

运行：`npx tsc -p electron/tsconfig.json --noEmit`

预期：exit 0。

---

### Task 3: web_fetch 接入 safeFetch（替换全局 fetch）并改造测试

**Files:**
- Modify: `electron/agent/tools/web-fetch.ts`（第 3 行 import、第 80 行 fetch 调用、第 179-184 行 catch）
- Test: `electron/agent/tools/web-fetch.test.ts`（mock 机制整体替换）

**Interfaces:**
- Consumes: Task 2 的 `safeFetch` / `describeFetchError`
- Produces: `webFetch` 行为不变，但传输层带连接期 IP 校验；`validateUrl` / `UNTRUSTED_MARKER` / `resolveMaxBytes` 导出保持不变

- [ ] **Step 1: 先改测试（预期失败）**——`electron/agent/tools/web-fetch.test.ts`

1. 在文件顶部 mock 区替换 fetch stub：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetch, validateUrl, UNTRUSTED_MARKER, resolveMaxBytes } from './web-fetch';

// Mock dns/promises（URL 预检）
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
}));

// Mock 传输层：本文件只验证 web_fetch 的编排逻辑，连接期校验由 pinned-fetch.test.ts 覆盖
vi.mock('../../security/pinned-fetch', () => ({
  safeFetch: vi.fn(),
  describeFetchError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import dns from 'node:dns/promises';
import { safeFetch } from '../../security/pinned-fetch';

const mockDns = vi.mocked(dns);
const mockSafeFetch = vi.mocked(safeFetch);

function mockFetch(body: string, init?: ResponseInit & { headers?: Record<string, string> }) {
  const headers = new Headers(init?.headers);
  const resp = new Response(body, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers,
  });
  mockSafeFetch.mockResolvedValue(resp);
}

beforeEach(() => {
  mockSafeFetch.mockReset();
  mockDns.lookup.mockReset();
});

afterEach(() => {
  mockSafeFetch.mockReset();
});
```

2. 删除原 `mockFetchError` 函数（原本就未被使用）。

3. 原「rejects unsafe redirect to localhost」用例中的全局 fetch stub 改为：

```ts
    const redirectResp = new Response(null, {
      status: 302,
      headers: { location: 'http://localhost/secret' },
    });
    mockSafeFetch.mockResolvedValue(redirectResp);
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
```

4. 新增用例（放在 redirect 用例之后）：

```ts
  it('连接期被拦截时返回底层原因（DNS Rebinding 防护）', async () => {
    mockDns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    mockSafeFetch.mockRejectedValue(
      new Error('域名 evil.example 在连接时解析到私网/保留 IP（127.0.0.1），已拒绝连接'),
    );
    const result = await webFetch({ url: 'https://evil.example.com' }, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('私网/保留 IP');
  });
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npx vitest run electron/agent/tools/web-fetch.test.ts`

预期：多个用例 FAIL（`web-fetch.ts` 仍在调用真实全局 fetch，未经过 mock；成功类用例报网络错误或超时，连接期用例断言失败）。

- [ ] **Step 3: 修改** `electron/agent/tools/web-fetch.ts`

1. 第 3 行 import 之后增加一行：

```ts
import { safeFetch, describeFetchError } from '../../security/pinned-fetch';
```

2. 第 80 行改为调用 `safeFetch`：

```ts
        response = await safeFetch(currentUrl, {
          method: 'GET',
          headers: { 'User-Agent': 'Stellara-Work/0.9' },
          redirect: 'manual',
          signal: controller.signal,
        });
```

3. catch 块（第 179-184 行）改为：

```ts
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, output: '', error: `请求超时（${FETCH_TIMEOUT_MS}ms）` };
    }
    return { ok: false, output: '', error: describeFetchError(err) };
  }
```

4. 文件头注释下方、`validateUrl` 的 doc 注释补一句（与现有中文注释风格一致）：

```ts
/**
 * 校验 URL 是否安全（hostname + DNS）。
 * IP/主机名判定统一走 security/net-policy（含 IPv6 规范化，见 H3）。
 * 注意：这里只是预检；连接期还会由 safeFetch 的 lookup 再次校验真实 Socket IP（防 DNS Rebinding）。
 */
```

- [ ] **Step 4: 运行测试确认通过**

运行：`npx vitest run electron/agent/tools/web-fetch.test.ts`

预期：全部用例 PASS（含原有 20+ 个用例与新增连接期用例）。

- [ ] **Step 5: electron 类型检查**

运行：`npx tsc -p electron/tsconfig.json --noEmit`

预期：exit 0。

---

### Task 4: safeStorage 明文降级的用户感知（AppInfo + 设置面板横幅）

**Files:**
- Modify: `electron/config/secrets.ts`（新增 `isEncryptionEnabled`）
- Test: `electron/config/secrets.test.ts`
- Modify: `shared/ipc.ts:481-486`（`AppInfo` 增加 `secretStorage`）
- Modify: `electron/main.ts:261-270`（`app:getInfo` 返回 `secretStorage`）
- Modify: `src/components/settings/SettingsModelsPanel.tsx`（读取状态并渲染横幅）
- Test: `src/components/settings/SettingsModelsPanel.test.tsx`
- Modify: `src/App.test.tsx:7`、`src/components/MainView.test.tsx:14`、`src/dev-preview.ts:115`（补 `secretStorage` 字段）

**Interfaces:**
- Produces:
  - `function isEncryptionEnabled(): boolean`（`electron/config/secrets.ts`）
  - `AppInfo.secretStorage: 'encrypted' | 'plaintext'`
- Consumes: 现有 `_setCipher`（测试注入）、现有 `window.electronAPI.app.getInfo()`

- [ ] **Step 1: 写失败测试**（`electron/config/secrets.test.ts` 文件末尾新增）

先在 import 列表中补 `isEncryptionEnabled`：

```ts
import {
  getKey, setKey, deleteKey, listKeys, migrateLegacyKeys,
  getServerPassword, setServerPassword, getCloudSecret, setCloudSecret,
  _setSecretsDir, _setCipher, isEncryptionEnabled, type KeyCipher,
} from './secrets';
```

文件末尾新增：

```ts
describe('isEncryptionEnabled', () => {
  it('未注入 cipher 时为 false（明文降级）', () => {
    expect(isEncryptionEnabled()).toBe(false);
  });

  it('注入 cipher 后为 true', () => {
    _setCipher(fakeCipher);
    expect(isEncryptionEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npx vitest run electron/config/secrets.test.ts`

预期：FAIL（`isEncryptionEnabled is not a function`；顶层 beforeEach 已注入 `_setCipher(null)` / afterEach 已清理）。

- [ ] **Step 3: 实现** `electron/config/secrets.ts`——在 `_setCipher` 定义之后（约第 40 行）加入：

```ts
/** 当前是否有可用的密钥加密器（safeStorage/DPAPI）；false 表示 .env 中的密钥为明文存储。 */
export function isEncryptionEnabled(): boolean {
  return _cipher !== null;
}
```

- [ ] **Step 4: 运行测试确认通过**

运行：`npx vitest run electron/config/secrets.test.ts`

预期：全部 PASS。

- [ ] **Step 5: 扩展 `AppInfo` 类型**（`shared/ipc.ts`）

把 `AppInfo` 接口改为：

```ts
export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  appDataPath: string;
  envPath: string;
  /**
   * 密钥存储模式：encrypted = 系统加密可用（safeStorage/DPAPI）；
   * plaintext = 降级明文（.env 权限 0600，仅当前用户可读）。
   */
  secretStorage: 'encrypted' | 'plaintext';
}
```

- [ ] **Step 6: 主进程接线**（`electron/main.ts` 的 `app:getInfo`）

```ts
  handle('app:getInfo', async (): Promise<AppInfo> => {
    const appDataPath = app.getPath('userData');
    await fs.mkdir(appDataPath, { recursive: true });
    const { isEncryptionEnabled } = await import('./config/secrets');
    return {
      version: app.getVersion(),
      platform: process.platform,
      appDataPath,
      envPath: getEnvPath(),
      secretStorage: isEncryptionEnabled() ? 'encrypted' : 'plaintext',
    };
  });
```

- [ ] **Step 7: 写 UI 失败测试**（`src/components/settings/SettingsModelsPanel.test.tsx`）

1. `installApi` 签名与 `getInfo` mock 改为：

```ts
function installApi(
  models: ModelListItem[] = MODELS,
  secretStorage: 'encrypted' | 'plaintext' = 'encrypted',
) {
```

```ts
      app: {
        getInfo: vi.fn().mockResolvedValue({
          version: '0.9.0-test',
          platform: 'darwin',
          appDataPath: '/tmp',
          envPath: '/tmp',
          secretStorage,
        }),
        onSettingsChanged: vi.fn().mockReturnValue(() => {}),
      },
```

2. 在 `describe('SettingsModelsPanel', ...)` 内新增两个用例：

```ts
  it('shows a plaintext-storage warning when safeStorage is unavailable', async () => {
    installApi(MODELS, 'plaintext');
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);
    const banner = byText(container, '明文存储');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('系统加密服务');
  });

  it('hides the plaintext-storage warning when encryption is available', async () => {
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);
    expect(byText(container, '明文存储')).toBeNull();
  });
```

- [ ] **Step 8: 运行测试确认失败**

运行：`npx vitest run src/components/settings/SettingsModelsPanel.test.tsx`

预期：第一个新增用例 FAIL（页面无横幅）。

- [ ] **Step 9: 实现横幅**（`src/components/settings/SettingsModelsPanel.tsx`）

1. 增加 state：

```ts
  const [secretStorage, setSecretStorage] = useState<'encrypted' | 'plaintext' | null>(null);
```

2. 首个 `useEffect` 的 `Promise.all` 增加 getInfo：

```ts
        const [m, list, info] = await Promise.all([
          window.electronAPI.models.getAll(),
          window.electronAPI.models.list(),
          window.electronAPI.app.getInfo(),
        ]);
        setModels(m);
        setPresets(list.presets);
        setSecretStorage(info.secretStorage);
```

3. 在 `{error && (...)}` 之后、`{showAdd && ...}` 之前插入：

```tsx
      {secretStorage === 'plaintext' && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div>
            <div className="error-text">
              当前运行环境缺少系统加密服务，API key 以受限权限明文存储（仅当前用户可读）。
            </div>
            <div className="error-banner-hint">
              建议配置系统凭据服务（如 Linux 的 gnome-keyring / kwallet）后重新保存密钥。
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 10: 运行 UI 测试确认通过**

运行：`npx vitest run src/components/settings/SettingsModelsPanel.test.tsx`

预期：全部 PASS（原有用例 + 新增 2 个）。

- [ ] **Step 11: 补齐 AppInfo 字面量与 dev preview**

- `src/App.test.tsx:7` 的 `INFO` 增加 `secretStorage: 'encrypted',`
- `src/components/MainView.test.tsx:14` 的 `INFO` 增加 `secretStorage: 'encrypted',`
- `src/dev-preview.ts:115` 的 `getInfo` mock 增加 `secretStorage: 'encrypted',`

- [ ] **Step 12: 全量类型检查**

运行：`npm run typecheck`

预期：exit 0（若 tsc 报出其他 `AppInfo` 字面量缺字段，按同一模式补 `secretStorage: 'encrypted'`）。

---

### Task 5: `sed -i` / `--in-place` 就地写拦截

**Files:**
- Modify: `electron/agent/tools/shell.ts`（`findForbiddenToolArg` 及其工具级拒绝注释）
- Test: `electron/agent/tools/shell.test.ts`

**Interfaces:**
- Consumes: 现有 `runCommand` / `findForbiddenToolArg` 调用链，无需新增导出
- Produces: 白名单内 `sed` 只允许 stdin/stdout 只读处理；`-i`、`-i.bak`、`-ni`、`--in-place`、`--in-place=.bak` 一律拒绝

- [ ] **Step 1: 写失败测试**（`electron/agent/tools/shell.test.ts` 的 `runCommand` describe 内，放在 `rejects @-form paths...` 用例附近）

```ts
  it('rejects sed in-place writes (-i / --in-place) (P2)', async () => {
    for (const cmd of [
      "sed -i 's/a/b/' sample.txt",
      "sed -i.bak 's/a/b/' sample.txt",
      "sed --in-place 's/a/b/' sample.txt",
      "sed --in-place=.bak 's/a/b/' sample.txt",
      "sed -ni 's/a/b/p' sample.txt",
      "sed -Ei 's/a/b/' sample.txt",
    ]) {
      const r = await runCommand({ command: cmd, timeoutMs: 1000 }, tmpDir);
      expect(r.ok, cmd).toBe(false);
      expect(r.error ?? '', cmd).toContain('不允许');
      expect(r.error ?? '', cmd).toContain('覆写');
    }
  });

  (process.platform !== 'win32' ? it : it.skip)('keeps read-only sed usage allowed (P2)', async () => {
    await fs.writeFile(path.join(tmpDir, 'sample.txt'), 'hello\nworld\n');
    const r = await runCommand({ command: "sed -n '1p' sample.txt" }, tmpDir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('hello');
  });
```

- [ ] **Step 2: 运行测试确认失败**

运行：`npx vitest run electron/agent/tools/shell.test.ts`

预期：第一个新增用例 FAIL（`sed -i ...` 被执行；因文件不存在 exit code 非 0，但错误文案不含「不允许/覆写」）。

- [ ] **Step 3: 实现**（`electron/agent/tools/shell.ts`）

1. 在 `findForbiddenToolArg` 之前新增辅助函数（放在 `GIT_CONFIG_WRITE_FLAGS` 定义之后、`findForbiddenToolArg` 之前均可）：

```ts
/** sed 短选项簇中出现 i（-i / -i.bak / -ni）即为就地写；遇到取值型选项（e/f/l）后停止扫描，避免把脚本内容误判为旗标 */
const SED_VALUE_FLAGS = new Set(['e', 'f', 'l']);

function sedHasInPlaceShortFlag(arg: string): boolean {
  for (const ch of arg.slice(1)) {
    if (ch === 'i') return true;
    if (SED_VALUE_FLAGS.has(ch)) return false;
  }
  return false;
}
```

2. 在 `findForbiddenToolArg` 内、`if (exeBase === 'find') {` 之前插入：

```ts
  if (exeBase === 'sed') {
    for (const arg of args) {
      if (arg === '--in-place' || arg.startsWith('--in-place=')) {
        return '不允许：sed --in-place 会就地覆写文件（sed 仅用于 stdin/stdout 只读处理）。';
      }
      if (arg.startsWith('-') && !arg.startsWith('--') && sedHasInPlaceShortFlag(arg)) {
        return '不允许：sed -i 会就地覆写文件（sed 仅用于 stdin/stdout 只读处理）。';
      }
    }
  }
```

3. 更新 `findForbiddenToolArg` 的 doc 注释，在条目列表中补一行：

```ts
 * - sed -i/--in-place：就地覆写文件，突破只读文本处理定位
```

- [ ] **Step 4: 运行测试确认通过**

运行：`npx vitest run electron/agent/tools/shell.test.ts`

预期：全部 PASS（含原有用例；`sed -f @/etc/hosts` 仍被路径规则拒绝）。

- [ ] **Step 5: electron 类型检查**

运行：`npx tsc -p electron/tsconfig.json --noEmit`

预期：exit 0。

---

### Task 6: macOS entitlements 与公证凭据流文档

**Files:**
- Create: `assets/entitlements.mac.plist`
- Create: `assets/entitlements.mac.inherit.plist`
- Modify: `package.json`（`build.mac` 显式关联 entitlements）
- Modify: `docs/macos-migration.md`（新增「Signing & Notarization」章节）

**Interfaces:**
- Consumes: electron-builder 26 内置公证流程（`MacTargetHelper.notarizeIfProvided`：读取 `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` 或 `APPLE_API_KEY*` 或 `APPLE_KEYCHAIN*` 环境变量；`notarize: false` 关闭）
- Produces: 主进程与子进程各自的最小 entitlements；发布文档；无需新增任何 npm 依赖

- [ ] **Step 1: 创建** `assets/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <!-- V8/Electron JIT 与新生成可执行代码（V8 必需） -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- 加固运行时下允许加载本地原生模块（better-sqlite3）与 Electron 框架/助手；ad-hoc 签名必需 -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <!-- 出站网络（网络已由应用层 SSRF 策略约束；该项为惯例声明） -->
    <key>com.apple.security.network.client</key>
    <true/>
  </dict>
</plist>
```

- [ ] **Step 2: 创建** `assets/entitlements.mac.inherit.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <!-- 渲染器/GPU/工具进程等助手继承的权限 -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
```

- [ ] **Step 3: 校验 plist 合法**

运行：

```bash
plutil -lint assets/entitlements.mac.plist assets/entitlements.mac.inherit.plist
```

预期：两行 `... OK`，exit 0。

- [ ] **Step 4: 关联 package.json**

`build.mac` 在 `"hardenedRuntime": true,` 之后增加两行（保持与 `assets/` buildResources 一致）：

```json
      "hardenedRuntime": true,
      "entitlements": "assets/entitlements.mac.plist",
      "entitlementsInherit": "assets/entitlements.mac.inherit.plist",
      "artifactName": "${productName}-${version}-${arch}.${ext}"
```

- [ ] **Step 5: 校验配置引用**

运行：

```bash
node -e "const m=require('./package.json').build.mac; for (const k of ['entitlements','entitlementsInherit']) { const p=m[k]; require('fs').accessSync(p); console.log(k, p, 'ok'); } console.log('hardenedRuntime', m.hardenedRuntime)"
```

预期：输出两行 `... ok` 与 `hardenedRuntime true`。

- [ ] **Step 6: 补文档**（`docs/macos-migration.md` 末尾追加章节）

```markdown
## 6. Signing & Notarization · 签名与公证

### 6.1 本地 / ad-hoc 构建

`package.json` 的 `build.mac` 已启用 `hardenedRuntime`，并显式关联：

- `assets/entitlements.mac.plist`（主进程）
- `assets/entitlements.mac.inherit.plist`（渲染器 / GPU / 工具等子进程）

未配置证书的构建仍用 `"identity": "-"` 做 ad-hoc 签名（Apple Silicon 要求二进制至少有 ad-hoc 签名）。**ad-hoc 签名无法通过公证**，README 中「右键打开 / xattr」的 Gatekeeper 绕过说明依然适用。

### 6.2 发布：Developer ID + 公证（Notarization）

1. **证书**：安装 `Developer ID Application` 证书，并把 `build.mac.identity` 从 `"-"` 改为证书名（如 `Developer ID Application: Your Name (TEAMID)`）。没有证书时不要开启公证。
2. **凭据**（electron-builder 26 读取环境变量，三选一）：
   - `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`
   - `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`（推荐）
   - `APPLE_KEYCHAIN` + `APPLE_KEYCHAIN_PROFILE`
3. **构建**：`npm run package:mac`。凭据齐全时 electron-builder 在签名后自动调用 notarytool 公证；未配置凭据时日志显示 `skipped macOS notarization`。如需显式关闭，设置 `build.mac.notarize: false`。
4. **验证**：

   ```bash
   spctl -a -vvv -t install "release/mac-arm64/Stellara Work.app"
   xcrun stapler validate "release/mac-arm64/Stellara Work.app"
   ```
```

- [ ] **Step 7: 回归确认配置未破坏打包脚本**

运行：`npm run build:electron`

预期：exit 0（仅编译主进程；不触发打包与签名）。

---

### Task 7: 全量回归与类型检查验证

**Files:**
- 无代码改动（若发现失败则回到对应 Task 修复）

- [ ] **Step 1: 类型检查**

运行：`npm run typecheck`

预期：exit 0（根工程 + electron 两个 tsconfig 均无错误）。

- [ ] **Step 2: 文档指定重点用例**

运行：

```bash
npx vitest run electron/agent/tools/shell.test.ts electron/mcp/mcp.test.ts electron/security/net-policy.test.ts
```

预期：全部 PASS。

- [ ] **Step 3: 本次新增/改造用例**

运行：

```bash
npx vitest run electron/security/pinned-lookup.test.ts electron/security/pinned-fetch.test.ts electron/agent/tools/web-fetch.test.ts electron/config/secrets.test.ts src/components/settings/SettingsModelsPanel.test.tsx
```

预期：全部 PASS。

- [ ] **Step 4: 全量测试**

运行：`npm test`

预期：全部 PASS（vitest `fileParallelism: false`，串行执行；如出现与本计划无关的既存失败，记录并单独说明，不顺手修）。

- [ ] **Step 5: 汇总验收清单**

确认以下全部成立后收尾：

- `web_fetch` 传输层在 DNS 解析出私网/保留地址时于建连瞬间拒绝（`pinned-fetch.test.ts` 集成用例为证）。
- `sed -i` / `--in-place` 及各变体被拒绝，纯只读用法仍可用。
- 无系统加密时设置-模型面板显示明文存储警示横幅。
- `assets/entitlements.mac.plist` + `assets/entitlements.mac.inherit.plist` 通过 `plutil -lint`，`package.json` 已关联。
- `docs/macos-migration.md` 含 Developer ID + 公证凭据流说明。

---

## 附录 A：明确不做的事（与 Spec 对齐）

1. **主密码（Master Password）加密方案**：spec 标记为「可选」，本次仅做 UI 警示；后续如需落地应单独立项（解锁流程、密钥派生、迁移与找回）。
2. **`sed` 的 `w` 指令过滤**：spec 的加固建议只要求拦截 `-i` / `--in-place`；`w <file>` 属于独立评估项（涉及 sed 脚本语义解析，误报风险高），本计划不做。
3. **不改造 `search-providers.ts` / `llm/*` 的 fetch**：超出本 spec 范围；它们不面向模型可传入的任意 URL。
4. **不实际执行 Apple 公证**：本机无 Developer ID 与公证凭据，交付物为 entitlements + 配置接线 + 凭据流文档；真实公证需在持证环境验证。
