# S5 定时任务写操作（预声明策略）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 定时任务可按任务声明写操作策略（允许的工具 + 可写文件范围 + 命令白名单），运行时有强制力地自动放行策略内调用、拒绝其余调用。

**Architecture:** 策略在保存时校验（`electron/scheduler/policy.ts` 纯函数），运行时翻译成三件套注入既有 agent loop：工具子集过滤（`allowedToolNames` 新选项）、自动审批器（`onApproval`）、护栏（复用子代理 guard + 命令白名单）。未配置策略的任务与现状等价（写操作被拒）。

**Tech Stack:** TypeScript、Electron 主进程、better-sqlite3、vitest、React 19。

**Spec:** `docs/superpowers/specs/2026-09-20-s5-scheduled-write-policy-design.md`

## Global Constraints

- 不做审计落库；MCP / 浏览器 / 子代理工具在调度运行中保持默认拒绝；server runtime 任务不纳入策略（UI 注明）。
- 未配置策略的任务行为与今天等价：危险工具不注入、审批恒 false、只读工具不受影响。
- `allowDangerous` 从类型与 UI 移除；DB 列 `allow_dangerous` 保留但不再读写。
- 不新增运行时依赖；安全策略只收紧不放松。
- 分支 `feat/s5-scheduled-write-policy`；每个 Task 独立提交；门禁：`npm run typecheck`、`npm test`、`npm run build`、`git diff --check`。
- 中文注释与错误文案；测试与被测文件同目录，vitest 风格。

## Review Focus

最容易坑使用者、且 spec 未逐条写明的输入/条件（每条都有测试，见括号内任务）：

1. 命令前缀匹配边界：`npm test` 放行 `npm test -- --runInBand`，不命中 `npm testing`；多行/含 shell 特殊字符/非白名单命令的条目在校验期拒绝（Task 1/2）。
2. 审批与护栏顺序：范围外路径必须被 guard 拒绝而不是仅靠审批；策略外危险工具即使被强行调用也 fail-closed（Task 3）。
3. 无策略任务：危险工具不注入、审批恒 false，只读工具与 `task_complete` 保留（Task 4/6）。
4. 保存校验的必填联动：选 write/edit 必须有范围；选 run_command 必须有命令项；空策略合法（Task 2/7）。
5. 迁移兼容：旧行 `policy` 为空 → 只读；dev-preview/共享类型/既有测试全部同步（Task 5/7/8）。

## File Structure

```
shared/ipc.ts                          ScheduledTaskPolicy 类型；In/Out 字段替换
electron/agent/tools/shell.ts          导出 tokenizeCommand；新增 validateAllowedCommandEntry
electron/agent/tools/shell.test.ts     新校验用例
electron/agent/shared/tool-policy.ts   新增 filterToolsByPolicy
electron/agent/shared/tool-policy.test.ts
electron/agent/responses-loop.ts       allowedToolNames 选项 + 过滤
electron/agent/anthropic-loop.ts       同上
electron/agent/responses-loop.test.ts / anthropic-loop.test.ts  过滤用例
electron/scheduler/policy.ts           新建：normalize / validate / matches / buildRuntime
electron/scheduler/policy.test.ts      新建
electron/scheduler/runner.ts           LocalLoopRequest.policy 透传
electron/scheduler/runner.test.ts      透传用例 + 既有断言更新
electron/store/db.ts                   scheduled_tasks.policy 列 + CRUD
electron/store/db-scheduler.test.ts    往返与迁移用例
shared/ipc.scheduled.test.ts           类型用例更新
electron/main.ts                       保存校验 + runLocalLoop 三件套
src/components/ScheduledTasks.tsx      策略编辑器替换 allowDangerous + 摘要
src/components/ScheduledTasks.test.tsx 用例重写
src/dev-preview.ts                     mock 适配
README.md                              调度写操作说明
```

---

### Task 1: shell 侧导出与命令项校验

**Files:**
- Modify: `electron/agent/tools/shell.ts`
- Test: `electron/agent/tools/shell.test.ts`

**Interfaces:**
- Consumes: 现有私有 `tokenize` / `parseCommand` / `allowedCommands` / `findForbiddenToolArg` / `subcommandError` / `isAbsolutePathArg`
- Produces:
  - `export function tokenizeCommand(s: string): string[]`（原 `tokenize` 重命名导出）
  - `export function validateAllowedCommandEntry(entry: string): string | null`

- [ ] **Step 1: 写失败测试（追加到 shell.test.ts 顶部 import 与文件末尾）**

import 行改为：

```ts
import { parseCommand, runCommand, buildChildEnv, shellTools, tokenizeCommand, validateAllowedCommandEntry } from './shell';
```

文件末尾追加：

```ts
describe('tokenizeCommand', () => {
  it('按引号分词且保持 token 原样', () => {
    expect(tokenizeCommand('npm test -- --runInBand')).toEqual(['npm', 'test', '--', '--runInBand']);
    expect(tokenizeCommand('git commit -m "fix test"')).toEqual(['git', 'commit', '-m', 'fix test']);
  });
});

describe('validateAllowedCommandEntry', () => {
  it('接受白名单内的命令（含后续参数）', () => {
    expect(validateAllowedCommandEntry('npm test')).toBeNull();
    expect(validateAllowedCommandEntry('npm test -- --runInBand')).toBeNull();
    expect(validateAllowedCommandEntry('git status')).toBeNull();
  });

  it('拒绝非白名单命令与绝对路径可执行', () => {
    expect(validateAllowedCommandEntry('bash -c "x"')).toContain('白名单');
    expect(validateAllowedCommandEntry('/usr/bin/npm test')).toContain('绝对路径');
  });

  it('拒绝多行 / shell 特殊字符', () => {
    expect(validateAllowedCommandEntry('npm test\nls')).toBeTruthy();
    expect(validateAllowedCommandEntry('npm test && ls')).toBeTruthy();
  });

  it('拒绝工具级禁止的旗标', () => {
    expect(validateAllowedCommandEntry('git --upload-pack=/bin/sh clone x')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/tools/shell.test.ts`
Expected: FAIL（`tokenizeCommand` / `validateAllowedCommandEntry` 未导出）

- [ ] **Step 3: 最小实现**

`shell.ts`：

1. 私有 `function tokenize(s: string)` 改名为 `export function tokenizeCommand(s: string)`，并把 `parseCommand` 内的 `tokenize(trimmed)` 调用同步改名。
2. 在 `runCommand` 之后新增：

```ts
/**
 * 校验一条"命令白名单"项本身可被 shell 策略执行（保存时预检）。
 * 返回 null 表示合法；否则返回中文错误。
 */
export function validateAllowedCommandEntry(entry: string): string | null {
  const parsed = parseCommand(entry);
  if ('error' in parsed) return parsed.error;
  if (isAbsolutePathArg(parsed.exe)) return `不允许使用绝对路径执行命令：${parsed.exe}`;
  const exeBase = path.basename(parsed.exe).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (!allowedCommands().has(exeBase)) return `命令不在白名单内：${parsed.exe}`;
  const forbidden = findForbiddenToolArg(exeBase, parsed.args);
  if (forbidden !== null) return forbidden;
  const subErr = subcommandError(exeBase, parsed.args);
  if (subErr !== null) return subErr;
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/tools/shell.test.ts`
Expected: PASS（含既有全部用例）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/tools/shell.ts electron/agent/tools/shell.test.ts
git commit -m "feat(scheduler): 导出命令分词与白名单项校验"
```

---

### Task 2: 策略校验与命令匹配（policy 模块）

**Files:**
- Create: `electron/scheduler/policy.ts`
- Test: `electron/scheduler/policy.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `tokenizeCommand` / `validateAllowedCommandEntry` / `isAbsolutePathArg`；`ScheduledTaskPolicy`（Task 5 落类型；本任务先用局部类型亦可，但**直接改 shared/ipc.ts 加类型**更顺，放本任务 Step 3 一起做）
- Produces:
  - `normalizeScheduledPolicy(policy?: ScheduledTaskPolicy): ScheduledTaskPolicy | undefined`
  - `validateTaskPolicy(policy?: ScheduledTaskPolicy): string | null`
  - `matchesCommandAllowlist(command: string, allowlist: readonly string[]): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// electron/scheduler/policy.test.ts
import { describe, expect, it } from 'vitest';
import { matchesCommandAllowlist, normalizeScheduledPolicy, validateTaskPolicy } from './policy';

const VALID = {
  allowedTools: ['edit_file', 'run_command'] as const,
  fileScopes: ['src/**'],
  allowedCommands: ['npm test'],
};

describe('normalizeScheduledPolicy', () => {
  it('去重、去空白并丢弃未知工具', () => {
    expect(
      normalizeScheduledPolicy({
        allowedTools: ['edit_file', 'edit_file', 'unknown' as never],
        fileScopes: [' src/** ', ''],
        allowedCommands: [' npm test '],
      }),
    ).toEqual({ allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: ['npm test'] });
  });

  it('空策略归一为 undefined', () => {
    expect(normalizeScheduledPolicy({ allowedTools: [], fileScopes: [], allowedCommands: [] })).toBeUndefined();
    expect(normalizeScheduledPolicy(undefined)).toBeUndefined();
  });
});

describe('validateTaskPolicy', () => {
  it('合法策略通过', () => {
    expect(validateTaskPolicy({ ...VALID, allowedTools: [...VALID.allowedTools] })).toBeNull();
  });

  it('选 write/edit 必须有可写范围', () => {
    expect(validateTaskPolicy({ allowedTools: ['write_file'], fileScopes: [], allowedCommands: [] })).toContain('可写范围');
  });

  it('选 run_command 必须有命令白名单', () => {
    expect(validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: [] })).toContain('命令白名单');
  });

  it('拒绝绝对路径或 ../ 逃逸的可写范围', () => {
    expect(validateTaskPolicy({ allowedTools: ['edit_file'], fileScopes: ['/etc'], allowedCommands: [] })).toContain('相对路径');
    expect(validateTaskPolicy({ allowedTools: ['edit_file'], fileScopes: ['../x'], allowedCommands: [] })).toContain('相对路径');
  });

  it('拒绝不合法的命令项', () => {
    expect(
      validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['bash -c x'] }),
    ).toContain('不合法');
  });

  it('空策略合法', () => {
    expect(validateTaskPolicy(undefined)).toBeNull();
    expect(validateTaskPolicy({ allowedTools: [], fileScopes: [], allowedCommands: [] })).toBeNull();
  });
});

describe('matchesCommandAllowlist', () => {
  const ALLOW = ['npm test', 'git status'];

  it('token 边界前缀命中', () => {
    expect(matchesCommandAllowlist('npm test', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('npm test -- --runInBand', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('git status --short', ALLOW)).toBe(true);
  });

  it('同前缀不同 token 不命中', () => {
    expect(matchesCommandAllowlist('npm testing', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('echo npm test', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('gits status', ALLOW)).toBe(false);
  });

  it('空白名单/空命令不命中', () => {
    expect(matchesCommandAllowlist('npm test', [])).toBe(false);
    expect(matchesCommandAllowlist('', ALLOW)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/scheduler/policy.test.ts`
Expected: FAIL（Cannot find module './policy'）

- [ ] **Step 3: 最小实现（含 shared/ipc.ts 类型）**

`shared/ipc.ts` 在 `ScheduledTask` 之前新增：

```ts
/** 定时任务写操作预声明策略（缺省 = 只读） */
export interface ScheduledTaskPolicy {
  /** 允许危险工具白名单（仅这三个可选） */
  allowedTools: Array<'write_file' | 'edit_file' | 'run_command'>;
  /** 可写文件范围（glob/目录）；write/edit 路径与 run_command 的 cwd 必须落于其中 */
  fileScopes: string[];
  /** 命令白名单（token 边界前缀匹配） */
  allowedCommands: string[];
}
```

（`ScheduledTask` / `ScheduledTaskInput` / `ScheduledTaskPatch` 的字段替换见 Task 5，本任务先只加类型。）

`electron/scheduler/policy.ts`：

```ts
/**
 * 定时任务写操作策略：保存时校验与运行时匹配（纯函数）。
 */
import { parseCommand, tokenizeCommand, validateAllowedCommandEntry, isAbsolutePathArg } from '../agent/tools/shell';
import type { ScheduledTaskPolicy } from '../../shared/ipc';

const ALLOWED_POLICY_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

export function normalizeScheduledPolicy(policy: ScheduledTaskPolicy | undefined): ScheduledTaskPolicy | undefined {
  if (!policy) return undefined;
  const allowedTools = [...new Set(policy.allowedTools)].filter((tool) => ALLOWED_POLICY_TOOLS.has(tool));
  const fileScopes = policy.fileScopes.map((scope) => scope.trim()).filter(Boolean);
  const allowedCommands = policy.allowedCommands.map((entry) => entry.trim()).filter(Boolean);
  if (allowedTools.length === 0 && fileScopes.length === 0 && allowedCommands.length === 0) return undefined;
  return { allowedTools, fileScopes, allowedCommands };
}

/** 保存时校验；返回 null 表示合法 */
export function validateTaskPolicy(policy: ScheduledTaskPolicy | undefined): string | null {
  const normalized = normalizeScheduledPolicy(policy);
  if (!normalized) return null;
  const tools = new Set(normalized.allowedTools);

  if ((tools.has('write_file') || tools.has('edit_file')) && normalized.fileScopes.length === 0) {
    return '选择写入/编辑文件后必须声明可写范围';
  }
  if (tools.has('run_command') && normalized.allowedCommands.length === 0) {
    return '选择运行命令后必须声明命令白名单';
  }
  for (const scope of normalized.fileScopes) {
    if (isAbsolutePathArg(scope) || scope.split(/[\\/]/).includes('..')) {
      return `可写范围必须是工作目录内的相对路径：${scope}`;
    }
  }
  for (const entry of normalized.allowedCommands) {
    const error = validateAllowedCommandEntry(entry);
    if (error) return `命令白名单项「${entry}」不合法：${error}`;
  }
  return null;
}

/** 命令是否命中白名单（token 边界前缀） */
export function matchesCommandAllowlist(command: string, allowlist: readonly string[]): boolean {
  const commandTokens = tokenizeCommand(command);
  if (commandTokens.length === 0) return false;
  for (const entry of allowlist) {
    const entryTokens = tokenizeCommand(entry);
    if (entryTokens.length === 0 || entryTokens.length > commandTokens.length) continue;
    let match = true;
    for (let i = 0; i < entryTokens.length; i++) {
      if (entryTokens[i] !== commandTokens[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/scheduler/policy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add shared/ipc.ts electron/scheduler/policy.ts electron/scheduler/policy.test.ts
git commit -m "feat(scheduler): 写操作策略校验与命令白名单匹配"
```

---

### Task 3: 运行时策略组装（buildScheduledPolicyRuntime）

**Files:**
- Modify: `electron/scheduler/policy.ts`
- Test: `electron/scheduler/policy.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 2 的 normalize/matches；`createSubagentToolGuard`（`electron/agent/subagent-guard.ts`）
- Produces:

```ts
export interface ScheduledPolicyRuntime {
  allowedToolNames: ReadonlySet<string>;
  shouldApprove: (toolName: string) => boolean;
  toolGuard: (name: string, args: Record<string, unknown>) => string | null;
}
export function buildScheduledPolicyRuntime(policy: ScheduledTaskPolicy | undefined, cwd: string): ScheduledPolicyRuntime;
```

- [ ] **Step 1: 写失败测试（追加到 policy.test.ts）**

```ts
import { buildScheduledPolicyRuntime } from './policy';

describe('buildScheduledPolicyRuntime', () => {
  const POLICY = {
    allowedTools: ['edit_file', 'run_command'] as const,
    fileScopes: ['src/**'],
    allowedCommands: ['npm test'],
  };

  it('无策略：空工具集、审批恒 false', () => {
    const runtime = buildScheduledPolicyRuntime(undefined, '/tmp/ws');
    expect([...runtime.allowedToolNames]).toEqual([]);
    expect(runtime.shouldApprove('edit_file')).toBe(false);
    expect(runtime.shouldApprove('read_file')).toBe(false);
  });

  it('有策略：只批准白名单工具', () => {
    const runtime = buildScheduledPolicyRuntime({ ...POLICY, allowedTools: [...POLICY.allowedTools] }, '/tmp/ws');
    expect(runtime.shouldApprove('edit_file')).toBe(true);
    expect(runtime.shouldApprove('run_command')).toBe(true);
    expect(runtime.shouldApprove('write_file')).toBe(false);
  });

  it('guard：范围内写入放行、范围外拒绝', () => {
    const runtime = buildScheduledPolicyRuntime({ ...POLICY, allowedTools: [...POLICY.allowedTools] }, '/tmp/ws');
    expect(runtime.toolGuard('edit_file', { path: 'src/a.ts' })).toBeNull();
    expect(runtime.toolGuard('edit_file', { path: '../outside.ts' })).toContain('超出');
  });

  it('guard：白名单外命令拒绝、白名单内放行', () => {
    const runtime = buildScheduledPolicyRuntime({ ...POLICY, allowedTools: [...POLICY.allowedTools] }, '/tmp/ws');
    expect(runtime.toolGuard('run_command', { command: 'npm test -- --runInBand' })).toBeNull();
    expect(runtime.toolGuard('run_command', { command: 'npm install' })).toContain('命令不在任务白名单内');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/scheduler/policy.test.ts`
Expected: FAIL（`buildScheduledPolicyRuntime` 未导出）

- [ ] **Step 3: 最小实现（追加到 policy.ts）**

```ts
import { createSubagentToolGuard } from '../agent/subagent-guard';

export interface ScheduledPolicyRuntime {
  allowedToolNames: ReadonlySet<string>;
  shouldApprove: (toolName: string) => boolean;
  toolGuard: (name: string, args: Record<string, unknown>) => string | null;
}

/**
 * 把任务策略翻译成运行时三件套（工具过滤集合 + 审批器 + 护栏）。
 * 无策略：空集合 + 恒拒绝 + 空范围护栏（危险工具也不会被注入）。
 */
export function buildScheduledPolicyRuntime(
  policy: ScheduledTaskPolicy | undefined,
  cwd: string,
): ScheduledPolicyRuntime {
  const normalized = normalizeScheduledPolicy(policy);
  const allowedToolNames = new Set<string>(normalized?.allowedTools ?? []);
  const allowedCommands = normalized?.allowedCommands ?? [];
  const baseGuard = createSubagentToolGuard({
    readOnly: false,
    cwd,
    fileScopes: normalized?.fileScopes ?? [],
  });

  return {
    allowedToolNames,
    shouldApprove: (toolName) => allowedToolNames.has(toolName),
    toolGuard: (name, args) => {
      const baseError = baseGuard(name, args);
      if (baseError) return baseError;
      if (name === 'run_command') {
        const command = typeof args.command === 'string' ? args.command : '';
        if (!matchesCommandAllowlist(command, allowedCommands)) {
          return '命令不在任务白名单内（已拒绝）';
        }
      }
      return null;
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/scheduler/policy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/scheduler/policy.ts electron/scheduler/policy.test.ts
git commit -m "feat(scheduler): 策略运行时组装（工具集/审批器/护栏）"
```

---

### Task 4: agent loop 支持工具子集过滤

**Files:**
- Modify: `electron/agent/shared/tool-policy.ts`、`electron/agent/responses-loop.ts`、`electron/agent/anthropic-loop.ts`
- Test: `electron/agent/shared/tool-policy.test.ts`、`electron/agent/responses-loop.test.ts`、`electron/agent/anthropic-loop.test.ts`

**Interfaces:**
- Consumes: `DANGEROUS_TOOLS`
- Produces:
  - `filterToolsByPolicy(tools: OpenAITool[], allowedToolNames?: ReadonlySet<string>): OpenAITool[]`
  - 两条 loop 的 options 新增 `allowedToolNames?: ReadonlySet<string>`

- [ ] **Step 1: 写失败测试**

`tool-policy.test.ts` 追加：

```ts
import { filterToolsByPolicy } from './tool-policy';
import type { OpenAITool } from '../../../shared/ipc';

function tool(name: string): OpenAITool {
  return { type: 'function', function: { name, description: '', parameters: {} } };
}

describe('filterToolsByPolicy', () => {
  it('未提供集合时原样返回', () => {
    const tools = [tool('write_file'), tool('read_file')];
    expect(filterToolsByPolicy(tools)).toBe(tools);
  });

  it('过滤未授权的危险工具并保留 task_complete 与只读工具', () => {
    const tools = [tool('write_file'), tool('read_file'), tool('run_command'), tool('task_complete'), tool('edit_file')];
    expect(filterToolsByPolicy(tools, new Set(['edit_file'])).map((t) => t.function.name).sort())
      .toEqual(['edit_file', 'read_file', 'task_complete']);
  });
});
```

`responses-loop.test.ts` 主 describe 追加：

```ts
  it('allowedToolNames 过滤未授权的危险工具（task_complete 保留）', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
      allowedToolNames: new Set(['read_file']),
    });
    for await (const _event of gen) { /* 消费事件 */ }

    const toolNames = (responseRequests[0]?.tools ?? []).map((entry) => entry.name);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('task_complete');
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('run_command');
  });
```

`anthropic-loop.test.ts` 主 describe 追加：

```ts
  it('allowedToolNames 过滤未授权的危险工具（task_complete 保留）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'ok' }],
    });
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    for await (const _event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: { create: mockCreate }, allowedToolNames: new Set(['read_file']),
    })) { /* 消费事件 */ }

    const firstRequest = mockCreate.mock.calls[0]![0] as { tools: Array<{ name: string }> };
    const names = firstRequest.tools.map((entry) => entry.name);
    expect(names).toContain('read_file');
    expect(names).toContain('task_complete');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/tool-policy.test.ts electron/agent/responses-loop.test.ts electron/agent/anthropic-loop.test.ts`
Expected: 新用例 FAIL（未导出 / 选项未生效）

- [ ] **Step 3: 最小实现**

`tool-policy.ts` 追加（顶部补 `import type { OpenAITool } from '../../../shared/ipc';`）：

```ts
/**
 * 工具子集过滤：未提供 allowedToolNames 时不变；
 * 提供时仅保留"只读/非危险工具 + 白名单内的危险工具 + task_complete"。
 */
export function filterToolsByPolicy(tools: OpenAITool[], allowedToolNames?: ReadonlySet<string>): OpenAITool[] {
  if (!allowedToolNames) return tools;
  return tools.filter((tool) => {
    const name = tool.function.name;
    if (name === 'task_complete') return true;
    if (!DANGEROUS_TOOLS.has(name)) return true;
    return allowedToolNames.has(name);
  });
}
```

`responses-loop.ts`：
- options 增加 `allowedToolNames?: ReadonlySet<string>;`
- import 行改 `import { needsApproval, filterToolsByPolicy } from './shared/tool-policy';`
- 构建处：

```ts
  const executableTools = filterToolsByPolicy(
    options.allowSubagents === false ? allTools.filter((tool) => tool.function.name !== 'dispatch_subagents') : allTools,
    options.allowedToolNames,
  );
  let tools = planMode
    ? [...filterToolsByPolicy(planModeTools, options.allowedToolNames).map(t => convertToResponseTool(t)), ...(options.planExtraTools ?? [])]
    : [...executableTools.map(t => convertToResponseTool(t)), ...(options.extraTools ?? [])];
```

`anthropic-loop.ts`：
- options 增加 `allowedToolNames?: ReadonlySet<string>;`
- import 行改 `import { needsApproval, filterToolsByPolicy } from './shared/tool-policy';`
- 构建处：

```ts
  const executableTools = filterToolsByPolicy(
    options.allowSubagents === false ? allTools.filter((tool) => tool.function.name !== 'dispatch_subagents') : allTools,
    options.allowedToolNames,
  );
  let tools = (planMode
    ? [...filterToolsByPolicy(planModeTools, options.allowedToolNames), ...(options.planExtraTools ?? [])]
    : [...executableTools, ...(options.extraTools ?? [])])
    .map(toAnthropicTool);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/tool-policy.test.ts electron/agent/responses-loop.test.ts electron/agent/anthropic-loop.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/tool-policy.ts electron/agent/shared/tool-policy.test.ts electron/agent/responses-loop.ts electron/agent/responses-loop.test.ts electron/agent/anthropic-loop.ts electron/agent/anthropic-loop.test.ts
git commit -m "feat(agent): loop 支持按策略过滤工具子集"
```

---

### Task 5: 类型替换与 DB 列

**Files:**
- Modify: `shared/ipc.ts`、`electron/store/db.ts`
- Test: `electron/store/db-scheduler.test.ts`、`shared/ipc.scheduled.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `ScheduledTaskPolicy`
- Produces: `ScheduledTask.policy?`、DB 读写与迁移

- [ ] **Step 1: 更新类型（shared/ipc.ts）**

- `ScheduledTask`：删除 `allowDangerous: boolean;`，替换为：

```ts
  /** 写操作预声明策略；缺省 = 只读（危险工具不注入） */
  policy?: ScheduledTaskPolicy;
```

- `ScheduledTaskInput` / `ScheduledTaskPatch`：删除 `allowDangerous?: boolean;`，新增 `policy?: ScheduledTaskPolicy;`（Patch 额外允许 `policy: null` 清空 → 类型写 `policy?: ScheduledTaskPolicy | null;`）。

- [ ] **Step 2: 更新 DB 与测试**

`db.ts`：

1. 迁移（放在 messages attachments 迁移之后）：

```ts
  // v0.10 定时任务写操作策略（旧库加列，幂等）
  const scheduledColumns = _db.prepare('PRAGMA table_info(scheduled_tasks)').all() as Array<{ name: string }>;
  if (!scheduledColumns.some((column) => column.name === 'policy')) {
    _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN policy TEXT');
  }
```

2. 行映射 helper（`rowToScheduledTask` 之前）：

```ts
function parseStoredPolicy(value: unknown): ScheduledTask['policy'] {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return JSON.parse(value) as ScheduledTask['policy'];
  } catch {
    return undefined;
  }
}
```

3. `rowToScheduledTask`：`allowDangerous: row.allow_dangerous === 1,` → `policy: parseStoredPolicy(row.policy),`
4. `createScheduledTask`：入参删 `allowDangerous?: boolean;` 加 `policy?: ScheduledTaskPolicy;`；INSERT 列 `allow_dangerous` 换成 `policy`，参数传 `input.policy ? JSON.stringify(input.policy) : null`；返回对象 `allowDangerous` 换成 `policy: input.policy`。
5. `updateScheduledTask`：patch 类型删 `allowDangerous` 加 `policy?: ScheduledTaskPolicy | null;`；行 `if (patch.allowDangerous !== undefined) ...` 换成：

```ts
  if (patch.policy !== undefined) add('policy', patch.policy ? JSON.stringify(patch.policy) : null);
```

`db-scheduler.test.ts`：
- 工厂默认值里删除 `allowDangerous: false,`（第 65 行附近）；
- 「round-trips runtime, server, model...」用例（第 73-83 行）：`allowDangerous: true` 改为 `policy: { allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [] }`，断言 `allowDangerous: true` 同步改为 `policy: { ... }`；
- 「updates task fields...」用例（第 104 行起）删除 `allowDangerous: true,`；
- 追加：

```ts
  it('policy JSON 往返', () => {
    const policy = { allowedTools: ['edit_file', 'run_command'], fileScopes: ['src/**'], allowedCommands: ['npm test'] };
    makeTask('t-policy', { policy });
    expect(getScheduledTask('t-policy')!.policy).toEqual(policy);
  });

  it('update 缺省不动 policy；显式 null 清空', () => {
    makeTask('t-p2', { policy: { allowedTools: ['edit_file'], fileScopes: ['a/**'], allowedCommands: [] } });
    updateScheduledTask('t-p2', { name: '改名' });
    expect(getScheduledTask('t-p2')!.policy).toBeTruthy();
    updateScheduledTask('t-p2', { policy: null });
    expect(getScheduledTask('t-p2')!.policy).toBeUndefined();
  });
```

`ipc.scheduled.test.ts` 第 86 行一带：`allowDangerous: true` 替换为：

```ts
      policy: { allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['npm test'] },
```

- [ ] **Step 3: 运行测试确认失败再通过**

Run: `npm run typecheck`
Expected: 类型错误定位到所有残留 `allowDangerous` 引用（逐一清完）

Run: `npx vitest run electron/store/db-scheduler.test.ts shared/ipc.scheduled.test.ts`
Expected: PASS（含新用例）

- [ ] **Step 4: 提交**

```bash
git add shared/ipc.ts shared/ipc.scheduled.test.ts electron/store/db.ts electron/store/db-scheduler.test.ts
git commit -m "feat(scheduler): 任务策略字段替换 allowDangerous 并落库"
```

---

### Task 6: runner 透传与 main.ts 接线

**Files:**
- Modify: `electron/scheduler/runner.ts`、`electron/main.ts`
- Test: `electron/scheduler/runner.test.ts`

**Interfaces:**
- Consumes: `validateTaskPolicy` / `normalizeScheduledPolicy` / `buildScheduledPolicyRuntime`（Task 2/3）、`filterToolsByPolicy` 选项（Task 4）
- Produces: `LocalLoopRequest.policy`；保存校验；本地循环三件套

- [ ] **Step 1: 写失败测试（runner.test.ts）**

- `makeTask` 里删除 `allowDangerous: false,`；在副作用循环里删除对 allowDangerous 的引用。
- 把「never hands an approval callback...」用例改为：

```ts
  it('runner 不注入审批回调（审批由 main.ts 按策略构造）', async () => {
    const h = createHarness({ loop: errorLoop('危险工具 write_file 已被拒绝（无审批通道）') });
    const run = await runLocalTask(makeTask(), h.deps);

    expect(h.loopRequests).toHaveLength(1);
    expect((h.loopRequests[0] as { onApproval?: unknown }).onApproval).toBeUndefined();
    expect(h.loopRequests[0]!.policy).toBeUndefined();
    expect(run.status).toBe('error');
    expect(h.notifications).toEqual([{ completed: false, failed: true, aborted: false }]);
  });

  it('把任务的 policy 透传给本地循环', async () => {
    const policy = { allowedTools: ['edit_file'] as const, fileScopes: ['src/**'], allowedCommands: [] };
    const h = createHarness();
    await runLocalTask(makeTask({ policy: { ...policy, allowedTools: [...policy.allowedTools] } }), h.deps);
    expect(h.loopRequests[0]!.policy).toEqual({ ...policy, allowedTools: [...policy.allowedTools] });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/scheduler/runner.test.ts`
Expected: 新用例 FAIL（`policy` 字段不存在/未透传）；typecheck 也会指出 makeTask 残留

- [ ] **Step 3: 实现**

`runner.ts`：
- `LocalLoopRequest` 增加 `policy?: ScheduledTaskPolicy;`（import type from `../../shared/ipc`）
- `runLocalBody` 的 `deps.runLocalLoop({...})` 增加 `...(task.policy !== undefined ? { policy: task.policy } : {})`
- 顶部文档注释里 `task.allowDangerous 仅 UI 风险确认…` 改为：`任务策略（policy）决定写操作授权；未配置 = 只读（危险工具不注入，详见 scheduler/policy.ts）。`

`main.ts`：
- import：`import { buildScheduledPolicyRuntime, normalizeScheduledPolicy, validateTaskPolicy } from './scheduler/policy';`（若已有 scheduler import 行则合并）
- `scheduled:create`：在 `computeNextRun` 之后加：

```ts
    const policyError = validateTaskPolicy(input.policy);
    if (policyError) throw new Error(policyError);
```

并把 create 入参改为 `policy: normalizeScheduledPolicy(input.policy)`。

- `scheduled:update`：在 `nextRunPatchForUpdate` 之前加：

```ts
    if (patch.policy !== undefined) {
      const policyError = validateTaskPolicy(patch.policy ?? undefined);
      if (policyError) throw new Error(policyError);
      patch = { ...patch, policy: normalizeScheduledPolicy(patch.policy ?? undefined) ?? null };
    }
```

- `runLocalLoop`（约 2231 行）：把「刻意不传 onApproval」的实现替换为：

```ts
      runLocalLoop: (request) => {
        // 策略在保存时校验；运行时翻译为工具过滤 + 自动审批 + 护栏（任一未授权调用失败关闭）
        const contextHub = new ContextHub(
          request.sessionId,
          request.cwd,
          request.model.contextWindow ?? 256000,
          request.model.maxOutputTokens ?? 16384,
        );
        const runtime = buildScheduledPolicyRuntime(request.policy, request.cwd);
        const common = {
          model: request.model,
          cwd: request.cwd,
          sessionId: request.sessionId,
          contextHub,
          platform: { platform: process.platform, arch: process.arch },
          signal: request.signal,
          ...(request.memoryProjectId !== undefined ? { memoryProjectId: request.memoryProjectId } : {}),
          memoryUserId: request.memoryUserId,
          allowedToolNames: runtime.allowedToolNames,
          onApproval: async (toolCall: ToolCall) => runtime.shouldApprove(toolCall.function.name),
          toolGuard: (name: string, args: Record<string, unknown>) => runtime.toolGuard(name, args),
        };
        const loop = request.model.wireApi === 'anthropic'
          ? runAnthropicAgentLoop(request.prompt, common)
          : runResponsesLoop(request.prompt, common);
        return disposeContextAfter(loop, contextHub);
      },
```

（`ToolCall` 类型加入 main.ts 顶部 import；若 `runAnthropicAgentLoop` / `runResponsesLoop` 的 options 类型对 `onApproval` 参数类型不一致，按 typecheck 结果微调。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/scheduler/runner.test.ts`
Expected: PASS（既有调度器用例全部保持）

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add electron/scheduler/runner.ts electron/scheduler/runner.test.ts electron/main.ts
git commit -m "feat(scheduler): 策略透传与本地运行三件套接线"
```

---

### Task 7: UI 策略编辑器与摘要

**Files:**
- Modify: `src/components/ScheduledTasks.tsx`
- Test: `src/components/ScheduledTasks.test.tsx`

**Interfaces:**
- Consumes: `ScheduledTaskPolicy`（shared/ipc）
- Produces: 编辑器字段与卡片摘要；`export function policySummary(policy?: ScheduledTaskPolicy): string`

- [ ] **Step 1: 写失败测试（替换现有 allowDangerous describe）**

删除 `describe('ScheduledTasks allowDangerous 风险确认', ...)` 整块，替换为：

```ts
describe('ScheduledTasks 写操作策略', () => {
  it('未选择写工具时保存不带 policy', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).toHaveBeenCalledTimes(1);
    expect(api.scheduled.create.mock.calls[0][0].policy).toBeUndefined();
  });

  it('选择写工具但缺少范围时提示且不保存', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '编辑文件')!);
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('可写范围');
  });

  it('填写完整并确认后保存带 policy', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '编辑文件')!);
    await fillTextarea(dialog, '可写范围', 'src/**');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(exactButton(dialog, '创建'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(api.scheduled.create.mock.calls[0][0].policy).toEqual({
      allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [],
    });
  });

  it('风险确认被拒绝时不保存', async () => {
    const { api } = stubApi([]);
    const { container } = await renderScheduled();
    const dialog = await openCreateDialog(container);
    await fillRequiredFields(dialog);
    await click(byLabel(dialog, '运行命令')!);
    await fillTextarea(dialog, '命令白名单', 'npm test');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click(exactButton(dialog, '创建'));
    expect(api.scheduled.create).not.toHaveBeenCalled();
  });

  it('卡片展示策略摘要', async () => {
    const { container } = await renderScheduled([makeTask({ policy: { allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [] } })]);
    expect(container.textContent).toContain('写操作：编辑文件');
    expect(container.textContent).toContain('范围 src/**');
  });
});
```

若测试文件没有 `fillTextarea` helper，在 helper 区（`byLabel` 之后）新增：

```ts
async function fillTextarea(scope: HTMLElement, label: string, value: string) {
  const textarea = byLabel(scope, label) as HTMLTextAreaElement | null;
  if (!textarea) throw new Error(`textarea not found: ${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/ScheduledTasks.test.tsx`
Expected: 新用例 FAIL（控件不存在）

- [ ] **Step 3: 实现（ScheduledTasks.tsx）**

- 顶部 import 增加 `ScheduledTaskPolicy`。
- 导出摘要纯函数：

```ts
export function policySummary(policy?: ScheduledTaskPolicy): string {
  if (!policy) return '只读';
  const labels: Record<string, string> = { write_file: '写入文件', edit_file: '编辑文件', run_command: '运行命令' };
  const tools = policy.allowedTools.map((tool) => labels[tool] ?? tool).join('、');
  const parts = [tools ? `写操作：${tools}` : '只读'];
  if (policy.fileScopes.length > 0) parts.push(`范围 ${policy.fileScopes.join('、')}`);
  if (policy.allowedCommands.length > 0) parts.push(`命令 ${policy.allowedCommands.length} 条`);
  return parts.join(' · ');
}
```

- 表单 state：删除 `allowDangerous`/`toggleDangerous`，新增：

```ts
  const [allowedTools, setAllowedTools] = useState<Array<'write_file' | 'edit_file' | 'run_command'>>(task?.policy?.allowedTools ?? []);
  const [fileScopesText, setFileScopesText] = useState((task?.policy?.fileScopes ?? []).join('\n'));
  const [allowedCommandsText, setAllowedCommandsText] = useState((task?.policy?.allowedCommands ?? []).join('\n'));

  function toggleTool(tool: 'write_file' | 'edit_file' | 'run_command') {
    setAllowedTools((prev) => prev.includes(tool) ? prev.filter((item) => item !== tool) : [...prev, tool]);
  }
```

- 提交处（原 `allowDangerous` 拼装处）改为：

```ts
    const policyDraft = {
      allowedTools: [...allowedTools],
      fileScopes: fileScopesText.split('\n').map((line) => line.trim()).filter(Boolean),
      allowedCommands: allowedCommandsText.split('\n').map((line) => line.trim()).filter(Boolean),
    };
    const needsScopes = allowedTools.includes('write_file') || allowedTools.includes('edit_file');
    if (runtime === 'local' && needsScopes && policyDraft.fileScopes.length === 0) {
      setFeedback('选择写入/编辑文件后必须填写可写范围');
      return;
    }
    if (runtime === 'local' && allowedTools.includes('run_command') && policyDraft.allowedCommands.length === 0) {
      setFeedback('选择运行命令后必须填写至少一条命令');
      return;
    }
    const hasPolicy = runtime === 'local' && allowedTools.length > 0;
    if (hasPolicy && !window.confirm('该任务将在无人值守时执行写操作（按声明范围）。确认按最小范围授权？')) {
      return;
    }
```

并在 `const input: ScheduledTaskInput = {...}` 中删除 `allowDangerous,`，加：

```ts
    if (hasPolicy) input.policy = policyDraft;
```

- JSX：把原 `.scheduled-danger` 区块替换为（`runtime === 'local'` 时渲染）：

```tsx
          {runtime === 'local' ? (
            <div className="scheduled-policy">
              <strong>允许的写操作</strong>
              {([
                ['write_file', '写入文件'],
                ['edit_file', '编辑文件'],
                ['run_command', '运行命令'],
              ] as const).map(([value, label]) => (
                <label key={value} className="scheduled-policy__option">
                  <input type="checkbox" checked={allowedTools.includes(value)} onChange={() => toggleTool(value)} aria-label={label} />
                  {label}
                </label>
              ))}
              {(allowedTools.includes('write_file') || allowedTools.includes('edit_file')) && (
                <textarea aria-label="可写范围" placeholder="每行一个范围，如 src/**" value={fileScopesText} onChange={(e) => setFileScopesText(e.target.value)} />
              )}
              {allowedTools.includes('run_command') && (
                <textarea aria-label="命令白名单" placeholder="每行一条命令，如 npm test" value={allowedCommandsText} onChange={(e) => setAllowedCommandsText(e.target.value)} />
              )}
            </div>
          ) : (
            <p className="scheduled-policy__server-note">写操作策略由远端服务器治理，本地不配置。</p>
          )}
```

- 卡片 meta（约 324 行 `<div className="scheduled-task-row__meta">` 内）追加：`<span>{policySummary(task.policy)}</span>`。
- 样式：在 `src/styles/workbench.css` 的 `.scheduled-danger` 附近追加最小样式（纵向排列、textarea 高约 72px），沿用既有 token。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/ScheduledTasks.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/ScheduledTasks.tsx src/components/ScheduledTasks.test.tsx src/styles/workbench.css
git commit -m "feat(ui): 定时任务写操作策略编辑器与摘要"
```

---

### Task 8: dev-preview、README 与收尾

**Files:**
- Modify: `src/dev-preview.ts`、`README.md`
- Test: 既有测试全量（无新增单测；dev-preview 由 typecheck 与 UI 预览兜底）

- [ ] **Step 1: dev-preview 适配**

- `previewScheduledTasks` 两条任务：`allowDangerous: false/true` 替换为 `policy`（一条 `{ allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [] }`，一条不设）。
- `previewPatchToTask`：`if (patch.allowDangerous !== undefined) ...` 换成 `if (patch.policy !== undefined) next.policy = patch.policy ?? undefined;`
- 创建映射（约 547 行）：`allowDangerous: input.allowDangerous ?? false,` 换成 `policy: input.policy,`

- [ ] **Step 2: README 更新**

把 "Scheduled Tasks & Tray Residency" 的 "Execution model" 段落中关于 allow dangerous tools 的表述替换为：

```
**执行模型**：调度运行无人值守，没有人工审批通道。任务的**写操作策略**（允许的工具 + 可写范围 + 命令白名单）在保存时校验、运行时强制执行：策略内自动放行，策略外一律拒绝（fail-closed）。未配置策略的任务为只读。建议按最小范围授权（例如只允许 `npm test`、只开放 `src/**`）。
```

- [ ] **Step 3: 全量门禁**

```bash
git diff --check
npm run typecheck
npm test
npm run build
```

Expected: 全部 exit 0。

- [ ] **Step 4: 人工冒烟（需要运行应用）**

- [ ] 新建定时任务：勾选「编辑文件」+ 范围 `src/**`，保存时出现风险确认，任务卡片显示「写操作：编辑文件 · 范围 src/**」。
- [ ] 同一任务「立即运行」：提示词要求修改 `src/` 下文件 → 成功写入；要求修改根目录文件 → 工具返回「超出…fileScopes（已拒绝）」。
- [ ] 勾选「运行命令」+ 白名单 `npm test`：运行 `npm test` 放行；运行 `npm install` 被拒（命令不在任务白名单内）。
- [ ] 未配置策略的任务「立即运行」：写操作被拒（危险工具不可见/审批拒绝），只读流程正常。

- [ ] **Step 5: 提交**

```bash
git add src/dev-preview.ts README.md
git commit -m "docs+preview(scheduler): 写操作策略说明与预览适配"
```

---

## Self-Review

- **Spec coverage**：spec §3.1 数据模型 → Task 2/5；§3.2 保存校验 → Task 2/6；§3.3 命令语义 → Task 1/2；§3.4 运行时三件套 → Task 3/4/6；§3.5 UI → Task 7；§3.6 兼容迁移 → Task 5/8；§4 测试策略 → 各任务用例 + Task 8 冒烟；§5 风险缓解 → 前缀 token 边界（Task 2 测试）、层叠拒绝（Task 3/6）、旧任务兼容（Task 5 测试）。
- **Placeholder scan**：无 TBD/TODO；代码步骤均含完整实现或精确改动位置。
- **Type consistency**：`ScheduledTaskPolicy`（Task 2 定义）在 Task 3/5/6/7 使用一致；`ScheduledPolicyRuntime.allowedToolNames/shouldApprove/toolGuard`（Task 3）与 Task 6 main.ts 用法一致；`filterToolsByPolicy`（Task 4）签名两条 loop 共用；`validateTaskPolicy` 返回 `string | null`（Task 2）在 Task 6 以 `if (policyError) throw` 消费。
- **Review Focus**：5 条均有对应测试任务（Task 1/2/3/4/5/7）。

