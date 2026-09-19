# S1 双协议一致性（共享行为模块）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Responses / Anthropic 两条 agent loop 的共享行为（工具策略、工具执行管道、上下文预算/压缩、限额语义）收敛为单点实现，并让 Anthropic 路径获得与 Responses 等价的截断/压缩/超限审批保护。

**Architecture:** 新建 `electron/agent/shared/` 下的行为服务模块；两条 loop 保留各自控制流并调用共享模块；Anthropic 通过 `projectAnthropicMessages` 在压缩后/跨轮时重建消息窗口；最后把 main.ts 两个重复的 IPC runner 合并到 `agent/session-runner.ts`。

**Tech Stack:** TypeScript、Electron 主进程、vitest、ContextHub（事件溯源）、OpenAI Responses API + Anthropic Messages API 双协议。

**Spec:** `docs/superpowers/specs/2026-09-19-s1-dual-protocol-consistency-design.md`

## Global Constraints

- 不新增运行时依赖；只用现有依赖。
- 安全策略只收紧不放松；审批「缺少通道即拒绝」的 fail-closed 语义不变。
- Responses 对外行为不变；唯一例外：子代理的 `tool_call_completed` 事件 `sourceAgentId` 从误记的 `main` 修正为实际执行 agent（本计划 Task 3 显式说明）。
- 工作分支：`feat/s1-dual-protocol-consistency`；每个 Task 独立提交。
- 门禁（每个 Task 收尾执行）：`npm run typecheck`、`npm test`；涉及构建产物的任务加 `npm run build`；提交前 `git diff --check`。
- 中文注释与错误文案；测试用 vitest（`describe/it/expect`），与被测文件同目录，命名 `<name>.test.ts`。
- 不在本计划内：Anthropic 流式对齐、审批 UI、S3/S4/S5。

## Review Focus

最容易坑使用者、且 spec 未逐条写明的输入/条件（每条都有对应测试，见括号内任务）：

1. 压缩后重建的 Anthropic 消息窗口：保留窗口内 `function_call`/`function_call_output` 配对必须完整，且丢掉的前缀不能残留在请求里（Task 5 不变式测试 + Task 8 压缩重建测试）。
2. 同轮 text + tool_use 投影顺序：合并进同一条 assistant 消息且 text 块在前（Task 5）。
3. 并行工具：连续多个 `function_call_output` 必须合并进同一条 user 消息（Task 5）。
4. 超限边界：`totalCalls === maxCalls` 不触发；`requireApprovalAfterLimit: false` 时报错而非审批（Task 2）。
5. MCP 审批回调缺失时 fail-closed：未来调用方忘记注入回调也不允许放行（Task 1）。

## File Structure

```
electron/agent/shared/
  tool-policy.ts          危险工具/plan 敏感集合、needsApproval 决策
  loop-limits.ts          迭代/工具调用上限、超限决策
  plan-steps.ts           findPlanStepForTool（两 loop 重复实现合一）
  tool-pipeline.ts        executeToolCall：调用+截断+事件记账
  context-budget.ts       runBudgetCheck：压缩 + 事件产出
  anthropic-projection.ts projectAnthropicMessages：items → Anthropic messages
  history-migration.ts    migrateHistoryToHub：旧历史一次性迁移
  instructions.ts         buildInstructions：指令拼装（两协议共用）
  loop-contract.test.ts   双协议契约测试（参数化对跑两条 loop）

electron/agent/session-runner.ts   IPC 会话编排（Task 9 新建）
electron/agent/responses-loop.ts   接入共享模块（Task 7）
electron/agent/anthropic-loop.ts   接入 + 补齐（Task 8）
electron/main.ts                   调用 session-runner（Task 9）
```

---

### Task 1: tool-policy

**Files:**
- Create: `electron/agent/shared/tool-policy.ts`
- Test: `electron/agent/shared/tool-policy.test.ts`

**Interfaces:**
- Consumes: 无（纯模块）
- Produces:
  - `DANGEROUS_TOOLS: ReadonlySet<string>`
  - `PLAN_MODE_SENSITIVE_TOOLS: ReadonlySet<string>`
  - `needsApproval(input: ApprovalDecisionInput): Promise<boolean>`
  - `ApprovalDecisionInput { toolName, planMode, forceApproval, mcpRequiresApproval? }`

- [ ] **Step 1: 写失败测试**

```ts
// electron/agent/shared/tool-policy.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DANGEROUS_TOOLS, PLAN_MODE_SENSITIVE_TOOLS, needsApproval } from './tool-policy';

describe('needsApproval', () => {
  it('危险工具始终需要审批', async () => {
    for (const toolName of ['write_file', 'edit_file', 'run_command', 'web_fetch', 'dispatch_subagents', 'browser_act', 'browser_exec_js', 'browser_screenshot', 'memory_save']) {
      expect(DANGEROUS_TOOLS.has(toolName)).toBe(true);
      expect(await needsApproval({ toolName, planMode: false, forceApproval: false })).toBe(true);
    }
  });

  it('只读工具默认不需要审批', async () => {
    expect(await needsApproval({ toolName: 'read_file', planMode: false, forceApproval: false })).toBe(false);
  });

  it('强制审批模式让所有工具都需要审批', async () => {
    expect(await needsApproval({ toolName: 'read_file', planMode: false, forceApproval: true })).toBe(true);
  });

  it('plan 模式敏感工具需要审批，普通只读不需要', async () => {
    expect(PLAN_MODE_SENSITIVE_TOOLS.has('browser_snapshot')).toBe(true);
    expect(await needsApproval({ toolName: 'browser_snapshot', planMode: true, forceApproval: false })).toBe(true);
    expect(await needsApproval({ toolName: 'read_file', planMode: true, forceApproval: false })).toBe(false);
  });

  it('MCP 工具走注入的审批查询', async () => {
    const query = vi.fn().mockResolvedValue(true);
    expect(await needsApproval({ toolName: 'mcp__s1__read', planMode: false, forceApproval: false, mcpRequiresApproval: query })).toBe(true);
    expect(query).toHaveBeenCalledWith('mcp__s1__read');
  });

  it('MCP 工具缺少审批回调时 fail-closed', async () => {
    expect(await needsApproval({ toolName: 'mcp__s1__read', planMode: false, forceApproval: false })).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/tool-policy.test.ts`
Expected: FAIL（Cannot find module './tool-policy'）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/tool-policy.ts
/**
 * 工具审批策略（单点定义）
 *
 * 两条 agent loop（Responses / Anthropic）共用；新增危险工具或调整审批
 * 规则只改这里。MCP 查询以回调注入，避免 shared → mcp 的反向依赖。
 */

export const DANGEROUS_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'web_fetch',
  'dispatch_subagents',
  'browser_act',
  'browser_exec_js',
  'browser_screenshot',
  'memory_save',
]);

/** plan（只读）模式下也必须逐次审批的敏感工具：可能读到已登录页面的内容 */
export const PLAN_MODE_SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  'browser_snapshot',
  'browser_extract',
]);

export interface ApprovalDecisionInput {
  toolName: string;
  planMode: boolean;
  forceApproval: boolean;
  /** MCP 工具的审批查询；非 mcp__ 前缀的工具不会调用它 */
  mcpRequiresApproval?: (name: string) => Promise<boolean>;
}

export async function needsApproval(input: ApprovalDecisionInput): Promise<boolean> {
  const { toolName, planMode, forceApproval, mcpRequiresApproval } = input;
  if (forceApproval) return true;
  if (DANGEROUS_TOOLS.has(toolName)) return true;
  if (planMode && PLAN_MODE_SENSITIVE_TOOLS.has(toolName)) return true;
  if (toolName.startsWith('mcp__')) {
    // fail-closed：缺少查询回调时按需要审批处理
    return mcpRequiresApproval ? await mcpRequiresApproval(toolName) : true;
  }
  return false;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/tool-policy.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/tool-policy.ts electron/agent/shared/tool-policy.test.ts
git commit -m "feat(agent): 工具审批策略共享模块"
```

---

### Task 2: loop-limits 与 plan-steps

**Files:**
- Create: `electron/agent/shared/loop-limits.ts`
- Create: `electron/agent/shared/plan-steps.ts`
- Test: `electron/agent/shared/loop-limits.test.ts`
- Test: `electron/agent/shared/plan-steps.test.ts`

**Interfaces:**
- Consumes: `ContextHub`（测试用 `{ persist: false }` 实例）、`TaskContext/PlanStep`（来自 `context/context-hub`）
- Produces:
  - `MAX_TOOL_CALLS_DEFAULT = 50`、`MAX_ITERATIONS_DEFAULT = 200`
  - `evaluateToolCallLimit(totalCalls, maxCalls, opts?) → LimitDecision`
  - `LimitDecision = { kind:'continue' } | { kind:'force_approval', message } | { kind:'error', message, hint }`
  - `findPlanStepForTool(context, toolName, args): PlanStep | undefined`

- [ ] **Step 1: 写失败测试（两个文件）**

```ts
// electron/agent/shared/loop-limits.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_TOOL_CALLS_DEFAULT, MAX_ITERATIONS_DEFAULT, evaluateToolCallLimit } from './loop-limits';

describe('evaluateToolCallLimit', () => {
  it('导出与循环一致的默认上限', () => {
    expect(MAX_TOOL_CALLS_DEFAULT).toBe(50);
    expect(MAX_ITERATIONS_DEFAULT).toBe(200);
  });

  it('未超限继续', () => {
    expect(evaluateToolCallLimit(3, 5)).toEqual({ kind: 'continue' });
  });

  it('恰好等于上限不触发', () => {
    expect(evaluateToolCallLimit(5, 5)).toEqual({ kind: 'continue' });
  });

  it('超限默认转强制审批', () => {
    const decision = evaluateToolCallLimit(6, 5);
    expect(decision.kind).toBe('force_approval');
    if (decision.kind === 'force_approval') {
      expect(decision.message).toContain('已达到工具调用上限(5)');
      expect(decision.message).toContain('进入审批模式');
    }
  });

  it('requireApprovalAfterLimit=false 时报错并携带提示', () => {
    const decision = evaluateToolCallLimit(6, 5, { requireApprovalAfterLimit: false });
    expect(decision).toEqual({
      kind: 'error',
      message: '工具调用次数超过限制 (5)',
      hint: '工具调用次数超过限制',
    });
  });
});
```

```ts
// electron/agent/shared/plan-steps.test.ts
import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { findPlanStepForTool } from './plan-steps';
import type { PlanStep } from '../../context/context-hub';

function step(id: string, description: string, status: PlanStep['status'] = 'pending'): PlanStep {
  return { id, description, status, relatedFiles: [], requiredVerification: [], evidenceIds: [] };
}

async function hubWithSteps(steps: PlanStep[]): Promise<ContextHub> {
  const hub = new ContextHub('plan-steps-test', '/tmp', 100_000, 16_384, { persist: false });
  await hub.commitEvent('plan_created', { objective: 'o', constraints: [], steps });
  return hub;
}

describe('findPlanStepForTool', () => {
  it('in_progress 步骤优先返回', async () => {
    const hub = await hubWithSteps([step('s1', '改 a.ts'), step('s2', '跑测试', 'in_progress')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', { path: 'a.ts' })?.id).toBe('s2');
  });

  it('按路径匹配 pending 步骤', async () => {
    const hub = await hubWithSteps([step('s1', '修改 src/a.ts'), step('s2', '运行 npm test 验证')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', { path: 'src/a.ts' })?.id).toBe('s1');
  });

  it('按命令关键词匹配验证步骤', async () => {
    const hub = await hubWithSteps([step('s1', '实现功能'), step('s2', '运行测试并验证')]);
    expect(findPlanStepForTool(hub.getContext(), 'run_command', { command: 'npm test' })?.id).toBe('s2');
  });

  it('写工具按实现类关键词匹配', async () => {
    const hub = await hubWithSteps([step('s1', '实现登录逻辑'), step('s2', '运行测试')]);
    expect(findPlanStepForTool(hub.getContext(), 'write_file', { path: 'login.ts' })?.id).toBe('s1');
  });

  it('无匹配时回退第一个 pending', async () => {
    const hub = await hubWithSteps([step('s1', '某步骤'), step('s2', '另一步骤')]);
    expect(findPlanStepForTool(hub.getContext(), 'read_file', {})?.id).toBe('s1');
  });

  it('task_complete / dispatch_subagents 不关联步骤', async () => {
    const hub = await hubWithSteps([step('s1', '某步骤')]);
    expect(findPlanStepForTool(hub.getContext(), 'task_complete', {})).toBeUndefined();
    expect(findPlanStepForTool(hub.getContext(), 'dispatch_subagents', {})).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/loop-limits.test.ts electron/agent/shared/plan-steps.test.ts`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/loop-limits.ts
/** 循环限额与超限决策（两条 loop 共用） */

export const MAX_TOOL_CALLS_DEFAULT = 50;
export const MAX_ITERATIONS_DEFAULT = 200;

export type LimitDecision =
  | { kind: 'continue' }
  | { kind: 'force_approval'; message: string }
  | { kind: 'error'; message: string; hint: string };

export function evaluateToolCallLimit(
  totalCalls: number,
  maxCalls: number,
  opts: { requireApprovalAfterLimit?: boolean } = {},
): LimitDecision {
  if (totalCalls <= maxCalls) return { kind: 'continue' };
  if (opts.requireApprovalAfterLimit !== false) {
    return { kind: 'force_approval', message: `\n\n[已达到工具调用上限(${maxCalls})，进入审批模式]` };
  }
  return {
    kind: 'error',
    message: `工具调用次数超过限制 (${maxCalls})`,
    hint: '工具调用次数超过限制',
  };
}
```

```ts
// electron/agent/shared/plan-steps.ts
import type { PlanStep, TaskContext } from '../../context/context-hub';

/**
 * 计划步骤匹配（原 Responses / Anthropic 两处逐字重复实现合一）。
 */
export function findPlanStepForTool(
  context: Readonly<TaskContext>,
  toolName: string,
  args: Record<string, unknown>,
): PlanStep | undefined {
  if (toolName === 'task_complete' || toolName === 'dispatch_subagents') return undefined;
  const active = context.plan.steps.find((step) => step.status === 'in_progress');
  if (active) return active;
  const pathValue = typeof args.path === 'string' ? args.path.toLowerCase() : '';
  const commandValue = typeof args.command === 'string' ? args.command.toLowerCase() : '';
  return context.plan.steps.find((step) => {
    if (step.status !== 'pending') return false;
    const text = step.description.toLowerCase();
    if (pathValue && text.includes(pathValue)) return true;
    if (commandValue && text.includes(commandValue)) return true;
    if (toolName === 'run_command') return /测试|验证|构建|运行|test|build|verify/.test(text);
    if (toolName === 'write_file' || toolName === 'edit_file') return /实现|修改|编辑|创建|写入|add|edit|implement/.test(text);
    return false;
  }) ?? context.plan.steps.find((step) => step.status === 'pending');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/loop-limits.test.ts electron/agent/shared/plan-steps.test.ts`
Expected: PASS（5 + 6 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/loop-limits.ts electron/agent/shared/loop-limits.test.ts electron/agent/shared/plan-steps.ts electron/agent/shared/plan-steps.test.ts
git commit -m "feat(agent): 限额与计划步骤匹配共享模块"
```

---

### Task 3: tool-pipeline

**Files:**
- Create: `electron/agent/shared/tool-pipeline.ts`
- Test: `electron/agent/shared/tool-pipeline.test.ts`

**Interfaces:**
- Consumes: `invokeTool`（`agent/tools`）、`capToolOutput`（`context/compactor`）、`ContextHub`
- Produces: `executeToolCall(input) → { outputText: string; raw: ToolResult }`
- 约定：管道**不**负责把 `function_call_output` 写入 hub（Responses 批量写、Anthropic 逐个写，保持各自现状）；管道**不**处理审批、toolGuard、task_complete 门禁（留在 loop）。
- 显式偏差：`tool_call_completed` 的 `sourceAgentId` 统一传 `context.agentId`（原 Responses 对子代理误记为 `main`）。

- [ ] **Step 1: 写失败测试**

```ts
// electron/agent/shared/tool-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../../context/context-hub';
import { executeToolCall } from './tool-pipeline';
import type { ToolExecutionContext } from '../../../shared/ipc';

let workDir = '';
const baseContext: ToolExecutionContext = {
  sessionId: 'pipe-session',
  agentId: 'main',
  contextRevision: 0,
  workspaceRevision: 0,
  toolCallId: 'tc-1',
};

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-pipe-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

function makeHub(): ContextHub {
  return new ContextHub('pipe-session', workDir, 256_000, 16_384, { persist: false });
}

describe('executeToolCall', () => {
  it('超大文件读取：hub 存截断 stub，raw 返回完整输出', async () => {
    const content = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), content);
    const hub = makeHub();

    const { outputText, raw } = await executeToolCall({
      hub, cwd: workDir, name: 'read_file', args: { path: 'big.txt' }, context: baseContext,
    });

    expect(raw.ok).toBe(true);
    expect(raw.output.length).toBe(content.length);
    const capped = JSON.parse(outputText) as { truncation?: { kind?: string } };
    expect(capped.truncation?.kind).toBe('read_file');
  });

  it('编辑文件：记录 modified/unverified 与完成事件', async () => {
    const hub = makeHub();
    const { raw } = await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'hello' },
      context: { ...baseContext, toolCallId: 'tc-2' },
    });

    expect(raw.ok).toBe(true);
    expect(hub.getContext().workspace.modifiedFiles.size).toBe(1);
    expect(hub.getUnverifiedFiles()).toHaveLength(1);
    expect(hub.getContext().tools.completed.some((t) => t.id === 'tc-2' && t.status === 'completed')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('命令成功：记录验证并清除未验证标记', async () => {
    const hub = makeHub();
    await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'x' },
      context: { ...baseContext, toolCallId: 'tc-a' },
    });
    expect(hub.getUnverifiedFiles()).toHaveLength(1);

    const { raw } = await executeToolCall({
      hub, cwd: workDir, name: 'run_command', args: { command: 'true' },
      context: { ...baseContext, toolCallId: 'tc-b' },
    });

    expect(raw.meta?.kind).toBe('command');
    expect(hub.getUnverifiedFiles()).toHaveLength(0);
    expect(hub.getVerificationEvidence().some((e) => e.kind === 'test' && e.ok)).toBe(true);
  });

  it('匹配到计划步骤且工具成功时推进为 completed', async () => {
    const hub = makeHub();
    await hub.commitEvent('plan_created', {
      objective: 'o', constraints: [],
      steps: [{ id: 'step-1', description: '修改 a.txt', status: 'in_progress', relatedFiles: [], requiredVerification: [], evidenceIds: [] }],
    });

    await executeToolCall({
      hub, cwd: workDir, name: 'write_file', args: { path: 'a.txt', content: 'x' },
      matchedPlanStepId: 'step-1', context: { ...baseContext, toolCallId: 'tc-c' },
    });

    expect(hub.getContext().plan.steps[0]!.status).toBe('completed');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/tool-pipeline.test.ts`
Expected: FAIL（Cannot find module './tool-pipeline'）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/tool-pipeline.ts
/**
 * 共享工具执行管道：调用工具 + 输出截断 + context 事件记账。
 *
 * 两条 agent loop（Responses / Anthropic）共用。事件提交顺序与 Responses
 * 历史实现逐条一致，保证事件回放兼容。
 */
import { invokeTool } from '../tools';
import { capToolOutput } from '../../context/compactor';
import type { ContextHub } from '../../context/context-hub';
import type { ToolArgs, ToolExecutionContext, ToolName, ToolResult } from '../../../shared/ipc';

export interface ExecuteToolCallInput {
  hub: ContextHub;
  cwd: string;
  name: string;
  args: Record<string, unknown>;
  /** 由 findPlanStepForTool 得到；仅用于完成态推进 */
  matchedPlanStepId?: string;
  context: ToolExecutionContext;
}

export interface ExecuteToolCallResult {
  /** 截断后的结果序列化：回传模型并作为 function_call_output 入库 */
  outputText: string;
  /** 完整结果：供 UI tool_result 事件使用 */
  raw: ToolResult;
}

export async function executeToolCall(input: ExecuteToolCallInput): Promise<ExecuteToolCallResult> {
  const { hub, cwd, name, args, matchedPlanStepId, context } = input;
  const planStepId = matchedPlanStepId ?? context.planStepId;
  const toolContext: ToolExecutionContext = { ...context, planStepId };

  await hub.commitEvent('tool_call_started', {
    id: context.toolCallId,
    name,
    args,
    planStepId: matchedPlanStepId,
  }, context.agentId);

  const result = await invokeTool(name as ToolName, args as ToolArgs, cwd, toolContext);
  const capped = capToolOutput(name, args, result);

  await hub.commitEvent('tool_call_completed', {
    id: context.toolCallId,
    result: result.output,
    affectedFiles: result.meta?.kind === 'edit' ? [result.meta.path] : [],
  }, context.agentId);

  if (result.meta?.kind === 'command') {
    await hub.commitEvent('command_completed', {
      command: result.meta.command,
      exitCode: result.meta.exitCode,
      stdout: result.meta.stdout,
      stderr: result.meta.stderr,
      planStepId,
    }, context.agentId);
    if (result.meta.exitCode === 0) {
      await hub.commitEvent('verification_completed', {
        kind: 'test',
        command: result.meta.command,
        relatedFiles: hub.getUnverifiedFiles(),
        planStepIds: planStepId ? [planStepId] : [],
        ok: true,
        summary: `验证命令通过：${result.meta.command}`,
      }, context.agentId);
    }
  }

  if (result.meta?.kind === 'edit') {
    await hub.commitEvent('file_modified', {
      filePath: result.meta.path,
      toolCallId: context.toolCallId,
      agentId: context.agentId,
      planStepId,
    }, context.agentId);
  }

  if (result.ok && matchedPlanStepId) {
    await hub.commitEvent('plan_step_changed', {
      stepId: matchedPlanStepId,
      status: 'completed',
    }, context.agentId);
  }

  return { outputText: JSON.stringify(capped), raw: result };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/tool-pipeline.test.ts`
Expected: PASS（4 tests，Windows 下 3 个）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/tool-pipeline.ts electron/agent/shared/tool-pipeline.test.ts
git commit -m "feat(agent): 共享工具执行管道（截断+事件记账）"
```

---

### Task 4: context-budget

**Files:**
- Create: `electron/agent/shared/context-budget.ts`
- Test: `electron/agent/shared/context-budget.test.ts`

**Interfaces:**
- Consumes: `ContextHub.ensureContextBudget`、`ChatStreamEvent`
- Produces: `runBudgetCheck({ hub, requestTokens, summarize?, signal? }) → BudgetCheckResult { compacted, hardLimited, tokensBefore?, tokensAfter?, compressedCount?, summary?, events: ChatStreamEvent[] }`

- [ ] **Step 1: 写失败测试**

```ts
// electron/agent/shared/context-budget.test.ts
import { describe, expect, it, vi } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { runBudgetCheck } from './context-budget';

function bigItems(hub: ContextHub, count: number): void {
  for (let i = 0; i < count; i++) {
    hub.addResponseItem({
      type: 'message',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `m${i} `.repeat(100) }],
      status: 'completed',
    });
  }
}

describe('runBudgetCheck', () => {
  it('低于软阈值不压缩、不产出事件', async () => {
    const hub = new ContextHub('budget-1', '/tmp', 100_000, 16_384, { persist: false });
    const result = await runBudgetCheck({ hub, requestTokens: 100 });
    expect(result).toEqual({ compacted: false, hardLimited: false, events: [] });
  });

  it('达到软阈值压缩并产出 summary 事件', async () => {
    const hub = new ContextHub('budget-2', '/tmp', 8_000, 1_000, { persist: false });
    bigItems(hub, 60);

    const result = await runBudgetCheck({ hub, requestTokens: 100 });

    expect(result.compacted).toBe(true);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event.type).toBe('summary');
    expect(event.tokensBefore!).toBeGreaterThan(event.tokensAfter!);
  });

  it('压缩后仍超硬阈值：产出统一错误事件', async () => {
    const hub = new ContextHub('budget-3', '/tmp', 100_000, 16_384, { persist: false });
    vi.spyOn(hub, 'ensureContextBudget').mockResolvedValue({ compacted: false, hardLimited: true });

    const result = await runBudgetCheck({ hub, requestTokens: 1 });

    expect(result.hardLimited).toBe(true);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'error',
        error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
        errorMeta: expect.objectContaining({ kind: 'context_too_long', retryable: false }),
      }),
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/context-budget.test.ts`
Expected: FAIL（Cannot find module './context-budget'）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/context-budget.ts
/**
 * 迭代边界上下文预算检查（两条 loop 共用）：
 * 达到软阈值同步压缩；压缩后仍超硬阈值产出统一错误事件。
 */
import type { ChatStreamEvent } from '../../../shared/ipc';
import type { ContextHub } from '../../context/context-hub';

export interface BudgetCheckResult {
  compacted: boolean;
  hardLimited: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
  /** 待转发的 UI 事件：summary（压缩成功）或 error（压缩后仍超硬阈值） */
  events: ChatStreamEvent[];
}

export async function runBudgetCheck(input: {
  hub: ContextHub;
  requestTokens: number;
  summarize?: (transcript: string) => Promise<string | undefined>;
  signal?: AbortSignal;
}): Promise<BudgetCheckResult> {
  const { hub, requestTokens, summarize, signal } = input;
  const budget = await hub.ensureContextBudget({ extraTokens: requestTokens, signal, summarize });

  const result: BudgetCheckResult = {
    compacted: budget.compacted,
    hardLimited: budget.hardLimited,
    events: [],
  };

  if (budget.compacted) {
    result.tokensBefore = budget.tokensBefore;
    result.tokensAfter = budget.tokensAfter;
    result.compressedCount = budget.compressedCount;
    result.summary = budget.summary;
    result.events.push({
      type: 'summary',
      tokensBefore: budget.tokensBefore,
      tokensAfter: budget.tokensAfter,
      compressedCount: budget.compressedCount,
      summary: budget.summary,
    });
  }

  if (budget.hardLimited) {
    result.events.push({
      type: 'error',
      error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
      errorMeta: {
        kind: 'context_too_long',
        hint: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模',
        retryable: false,
      },
    });
  }

  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/context-budget.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/context-budget.ts electron/agent/shared/context-budget.test.ts
git commit -m "feat(agent): 共享上下文预算检查模块"
```

---

### Task 5: anthropic-projection

**Files:**
- Create: `electron/agent/shared/anthropic-projection.ts`
- Test: `electron/agent/shared/anthropic-projection.test.ts`

**Interfaces:**
- Consumes: `ResponseItem`（`shared/responses`）、`AnthropicMessage/AnthropicContent`（`llm/anthropic`）
- Produces: `projectAnthropicMessages(items: ResponseItem[]): AnthropicMessage[]`
- 不变式：任一保留的 `function_call_output`，其 `function_call` 必在保留窗口内（由压缩事务组件保证）；本函数不校验，仅按序投影。

- [ ] **Step 1: 写失败测试**

```ts
// electron/agent/shared/anthropic-projection.test.ts
import { describe, expect, it } from 'vitest';
import { projectAnthropicMessages } from './anthropic-projection';
import type { ResponseItem } from '../../../shared/responses';

describe('projectAnthropicMessages', () => {
  it('文本 + tool_use 合并进同一条 assistant 消息，text 在前', () => {
    const items: ResponseItem[] = [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我来读取' }], status: 'completed' },
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}', status: 'completed' },
      { type: 'function_call_output', call_id: 'call-1', output: '文件内容' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来读取' },
          { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.txt' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '文件内容' }] },
    ]);
  });

  it('并行工具：多个 tool_use 合并进一条 assistant，多个 tool_result 合并进一条 user', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a"}', status: 'completed' },
      { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{"path":"b"}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'A' },
      { type: 'function_call_output', call_id: 'c2', output: 'B' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a' } },
          { type: 'tool_use', id: 'c2', name: 'read_file', input: { path: 'b' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'c1', content: 'A' },
          { type: 'tool_result', tool_use_id: 'c2', content: 'B' },
        ],
      },
    ]);
  });

  it('user/assistant 文本交替保持独立消息', () => {
    const items: ResponseItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题' }], status: 'completed' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '答案' }], status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '问题' }] },
      { role: 'assistant', content: [{ type: 'text', text: '答案' }] },
    ]);
  });

  it('跳过 reasoning、system 与空文本', () => {
    const items: ResponseItem[] = [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: '思考' }] },
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: '系统' }], status: 'completed' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '' }], status: 'completed' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: '保留' }], status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'user', content: [{ type: 'text', text: '保留' }] },
    ]);
  });

  it('arguments 非法 JSON 时 input 兜底为空对象', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{bad json', status: 'completed' },
    ];

    expect(projectAnthropicMessages(items)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }] },
    ]);
  });

  it('保留窗口含 function_call 时其 output 紧随其后（配对不拆）', () => {
    const items: ResponseItem[] = [
      { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c1', output: 'OUT-1' },
      { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{}', status: 'completed' },
      { type: 'function_call_output', call_id: 'c2', output: 'OUT-2' },
    ];

    const messages = projectAnthropicMessages(items);
    const flat = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const callIds = flat.filter((b) => b.type === 'tool_use').map((b) => b.id);
    const outputIds = flat.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
    expect(outputIds).toEqual(callIds);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/anthropic-projection.test.ts`
Expected: FAIL（Cannot find module './anthropic-projection'）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/anthropic-projection.ts
/**
 * ResponseItem[] → Anthropic messages 投影。
 *
 * 用途：Anthropic loop 在跨轮开跑与压缩后从 Context Hub 重建消息窗口，
 * 让被压缩丢弃的前缀真正离开请求体。
 * - function_call → assistant 的 tool_use 块（与相邻 assistant 消息合并）
 * - function_call_output → user 的 tool_result 块（连续的合并进同一条 user 消息）
 * - reasoning 跳过（Anthropic 未持久化 thinking；请求未启用 extended thinking）
 */
import type { ResponseItem } from '../../../shared/responses';
import type { AnthropicContent, AnthropicMessage } from '../../llm/anthropic';

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

export function projectAnthropicMessages(items: ResponseItem[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  const pushBlock = (role: 'user' | 'assistant', block: AnthropicContent): void => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      const content = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text' as const, text: last.content }];
      content.push(block);
      last.content = content;
      return;
    }
    messages.push({ role, content: [block] });
  };

  for (const item of items) {
    if (item.type === 'message') {
      if (item.role !== 'user' && item.role !== 'assistant') continue;
      const text = item.content.map((part) => part.text).join('');
      if (!text) continue;
      pushBlock(item.role, { type: 'text', text });
      continue;
    }
    if (item.type === 'function_call') {
      pushBlock('assistant', {
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parseToolInput(item.arguments),
      });
      continue;
    }
    if (item.type === 'function_call_output') {
      pushBlock('user', {
        type: 'tool_result',
        tool_use_id: item.call_id,
        content: item.output,
      });
      continue;
    }
    // reasoning 及其它：跳过
  }

  return messages;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/anthropic-projection.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/anthropic-projection.ts electron/agent/shared/anthropic-projection.test.ts
git commit -m "feat(agent): Anthropic 消息投影模块"
```

---

### Task 6: history-migration 与 instructions

**Files:**
- Create: `electron/agent/shared/history-migration.ts`
- Create: `electron/agent/shared/instructions.ts`
- Test: `electron/agent/shared/history-migration.test.ts`
- Test: `electron/agent/shared/instructions.test.ts`

**Interfaces:**
- Consumes: `ContextHub`、`TaskContext`
- Produces:
  - `migrateHistoryToHub(hub: ContextHub, history?: LegacyHistoryMessage[]): void`
  - `LegacyHistoryMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; tool_calls?; tool_call_id? }`
  - `buildInstructions(systemPrompt: string, context: Readonly<TaskContext>): string`

- [ ] **Step 1: 写失败测试（两个文件）**

```ts
// electron/agent/shared/history-migration.test.ts
import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { migrateHistoryToHub } from './history-migration';

describe('migrateHistoryToHub', () => {
  it('迁移 user/assistant/tool_calls/tool 输出', () => {
    const hub = new ContextHub('mig-1', '/tmp', 100_000, 16_384, { persist: false });

    migrateHistoryToHub(hub, [
      { role: 'user', content: '问题' },
      {
        role: 'assistant',
        content: '我来跑命令',
        tool_calls: [{ id: 'call-1', function: { name: 'run_command', arguments: '{"command":"true"}' } }],
      },
      { role: 'tool', content: 'exit 0', tool_call_id: 'call-1' },
    ]);

    expect(hub.getResponseItems().map((item) => item.type)).toEqual([
      'message',
      'message',
      'function_call',
      'function_call_output',
    ]);
    const output = hub.getResponseItems()[3]!;
    expect(output.type === 'function_call_output' && output.call_id).toBe('call-1');
  });

  it('hub 非空时不迁移', () => {
    const hub = new ContextHub('mig-2', '/tmp', 100_000, 16_384, { persist: false });
    hub.addResponseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '已有' }], status: 'completed' });

    migrateHistoryToHub(hub, [{ role: 'user', content: '旧历史' }]);

    expect(hub.getResponseItems()).toHaveLength(1);
  });

  it('空历史是 no-op', () => {
    const hub = new ContextHub('mig-3', '/tmp', 100_000, 16_384, { persist: false });
    migrateHistoryToHub(hub, undefined);
    expect(hub.getResponseItems()).toHaveLength(0);
  });
});
```

```ts
// electron/agent/shared/instructions.test.ts
import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { buildInstructions } from './instructions';

describe('buildInstructions', () => {
  it('拼装目标、约束、决策、计划与未验证文件段落', async () => {
    const hub = new ContextHub('instr-1', '/tmp', 100_000, 16_384, { persist: false });
    await hub.commitEvent('plan_created', {
      objective: '修复登录',
      constraints: ['不破坏现有测试'],
      steps: [
        { id: 's1', description: '改代码', status: 'completed', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
        { id: 's2', description: '跑测试', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    const text = buildInstructions('SYS', hub.getContext());

    expect(text).toContain('SYS');
    expect(text).toContain('## 当前目标\n修复登录');
    expect(text).toContain('## 约束\n- 不破坏现有测试');
    expect(text).toContain('## 已完成步骤\n- 改代码');
    expect(text).toContain('## 待完成步骤\n- [pending] 跑测试');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run electron/agent/shared/history-migration.test.ts electron/agent/shared/instructions.test.ts`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 最小实现**

```ts
// electron/agent/shared/history-migration.ts
/**
 * 旧会话历史一次性迁入 Context Hub（两条 loop 共用）。
 * 仅当 hub 为空时执行；tool_calls / tool 输出完整迁移。
 */
import type { ContextHub } from '../../context/context-hub';

export interface LegacyHistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ReadonlyArray<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function migrateHistoryToHub(hub: ContextHub, history?: LegacyHistoryMessage[]): void {
  if (!history?.length) return;
  if (hub.getResponseItems().length > 0) return;

  for (const message of history) {
    if ((message.role === 'user' || message.role === 'assistant') && message.content) {
      hub.addResponseItem({
        type: 'message',
        role: message.role,
        content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
        status: 'completed',
      });
    }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        hub.addResponseItem({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: 'completed',
        });
      }
    }
    if (message.role === 'tool' && message.tool_call_id) {
      hub.addResponseItem({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
    }
  }
}
```

```ts
// electron/agent/shared/instructions.ts
/**
 * instructions 拼装（两条协议共用；原先 Responses / Anthropic 格式漂移已收敛）。
 */
import type { TaskContext } from '../../context/context-hub';

export function buildInstructions(systemPrompt: string, context: Readonly<TaskContext>): string {
  let instructions = systemPrompt;

  if (context.objective) {
    instructions += `\n\n## 当前目标\n${context.objective}`;
  }
  if (context.constraints.length > 0) {
    instructions += `\n\n## 约束\n${context.constraints.map((c) => `- ${c}`).join('\n')}`;
  }
  if (context.decisions.length > 0) {
    instructions += `\n\n## 已确认的决策\n${context.decisions.map((d) => `- ${d.description}: ${d.reason}`).join('\n')}`;
  }
  if (context.plan.steps.length > 0) {
    const completedSteps = context.plan.steps.filter((s) => s.status === 'completed');
    const pendingSteps = context.plan.steps.filter((s) => s.status !== 'completed');
    if (completedSteps.length > 0) {
      instructions += `\n\n## 已完成步骤\n${completedSteps.map((s) => `- ${s.description}`).join('\n')}`;
    }
    if (pendingSteps.length > 0) {
      instructions += `\n\n## 待完成步骤\n${pendingSteps.map((s) => `- [${s.status}] ${s.description}`).join('\n')}`;
    }
  }
  if (context.workspace.unverifiedFiles.size > 0) {
    instructions += `\n\n## 未验证文件\n以下文件已修改但未验证：\n${Array.from(context.workspace.unverifiedFiles).map((f) => `- ${f}`).join('\n')}`;
  }
  if (context.compactionSummary) {
    instructions += `\n\n## 早期对话摘要（已压缩）\n${context.compactionSummary}`;
  }

  return instructions;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run electron/agent/shared/history-migration.test.ts electron/agent/shared/instructions.test.ts`
Expected: PASS（3 + 1 tests）

- [ ] **Step 5: 提交**

```bash
git add electron/agent/shared/history-migration.ts electron/agent/shared/history-migration.test.ts electron/agent/shared/instructions.ts electron/agent/shared/instructions.test.ts
git commit -m "feat(agent): 历史迁移与指令拼装共享模块"
```

---

### Task 7: Responses loop 接入共享模块（行为不变）

**Files:**
- Modify: `electron/agent/responses-loop.ts`

**Interfaces:**
- Consumes: Task 1-6 的全部共享模块
- Produces: 无新接口；现有 `runResponsesLoop(userMessage, options)` 保持逐字节等价的对外行为
- 门禁：`electron/agent/responses-loop.test.ts` 的断言不做任何修改即通过

- [ ] **Step 1: 跑一遍现有测试记录基线**

Run: `npx vitest run electron/agent/responses-loop.test.ts`
Expected: PASS（当前全绿基线）

- [ ] **Step 2: 替换 imports**

在 `responses-loop.ts` 顶部：

- 删除：`invokeTool`（`./tools` 导入中）、`capToolOutput`（`../context/compactor` 导入中）
- 新增：

```ts
import { needsApproval } from './shared/tool-policy';
import { findPlanStepForTool } from './shared/plan-steps';
import { executeToolCall } from './shared/tool-pipeline';
import { runBudgetCheck } from './shared/context-budget';
import { evaluateToolCallLimit, MAX_TOOL_CALLS_DEFAULT, MAX_ITERATIONS_DEFAULT } from './shared/loop-limits';
import { migrateHistoryToHub } from './shared/history-migration';
import { buildInstructions } from './shared/instructions';
```

- 删除文件内的本地常量 `DANGEROUS_TOOLS`、`PLAN_MODE_SENSITIVE_TOOLS`、`MAX_TOOL_CALLS_DEFAULT`、`MAX_ITERATIONS_DEFAULT`（改由共享模块提供）。
- 删除文件内的本地函数 `findPlanStepForTool`、`buildInstructions`（已移入共享模块）。

- [ ] **Step 3: 历史迁移改共享实现**

把从 `// v0.9.1 会话尚未持久化完整 Responses Items 时……` 开始到迁移 for 循环结束的整段替换为：

```ts
  // v0.9.1 会话尚未持久化完整 Responses Items 时，用领域历史做一次迁移。
  migrateHistoryToHub(contextHub, options.history);
```

- [ ] **Step 4: 预算检查改共享实现**

把 `// 上下文预算检查：达到软阈值时在迭代边界同步压缩` 开始的整段（到 hardLimited 的 `return;` 结束）替换为：

```ts
    // 上下文预算检查：达到软阈值时在迭代边界同步压缩
    let instructions = buildInstructions(systemPrompt, contextHub.getContext());
    const budget = await runBudgetCheck({
      hub: contextHub,
      requestTokens: estimateRequestTokens({ items: [], instructions, tools }),
      signal,
      summarize:
        options.compactionSummaryEnabled === true
          ? (transcript) => summarizeWithModel(model, COMPACTION_SUMMARY_PROMPT, transcript, signal)
          : undefined,
    });
    for (const budgetEvent of budget.events) yield budgetEvent;
    if (budget.compacted) {
      instructions = buildInstructions(systemPrompt, contextHub.getContext());
    }
    if (budget.hardLimited) {
      return;
    }
```

- [ ] **Step 5: 限额检查改共享实现**

把 `// 检查是否超过工具调用限制` 开始的整段替换为：

```ts
    // 检查是否超过工具调用限制
    toolCallCount += functionCalls.size;
    const limit = evaluateToolCallLimit(toolCallCount, maxToolCalls, {
      requireApprovalAfterLimit: options.requireApprovalAfterLimit,
    });
    if (limit.kind === 'force_approval') {
      forceApprovalMode = true;
      yield { type: 'content', content: limit.message };
    } else if (limit.kind === 'error') {
      yield {
        type: 'error',
        error: limit.message,
        errorMeta: { kind: 'invalid_request', hint: limit.hint, retryable: false },
      };
      return;
    }
```

- [ ] **Step 6: 审批判定改共享实现**

把 `// 检查是否需要审批：……` 到 `if (needsApproval) {` 替换为：

```ts
      // 检查是否需要审批：强制审批模式 / 内置危险工具 / plan 模式敏感工具 / MCP 策略（approval 配置）
      const requiresApproval = await needsApproval({
        toolName: fc.name,
        planMode,
        forceApproval: forceApprovalMode,
        mcpRequiresApproval: (toolName) => mcpManager.requiresApproval(toolName),
      });
      if (requiresApproval) {
```

- [ ] **Step 7: 工具执行改共享管道**

把 `// 执行工具` 的 `try { ... }` 块内从 `const toolContext: ToolExecutionContext = {` 到 `if (fc.name === 'task_complete' && result.ok) taskCompleteAccepted = true;` 之前的部分替换为：

```ts
        const toolContext: ToolExecutionContext = {
          sessionId,
          agentId: options.agentId ?? 'main',
          contextRevision: contextHub.getRevision(),
          workspaceRevision: contextHub.getWorkspaceRevision(),
          toolCallId: fc.call_id,
          planStepId: matchedPlanStep?.id ?? contextHub.getContext().plan.steps.find(s => s.status === 'in_progress')?.id,
        };

        const { outputText, raw } = await executeToolCall({
          hub: contextHub,
          cwd,
          name: fc.name,
          args,
          matchedPlanStepId: matchedPlanStep?.id,
          context: toolContext,
        });

        toolResults.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: outputText,
        });

        yield {
          type: 'tool_result',
          toolResult: { name: fc.name, toolCallId: fc.call_id, result: raw },
        };

        if (fc.name === 'task_complete' && raw.ok) taskCompleteAccepted = true;
```

catch 分支保持原样不动。

- [ ] **Step 8: 清理并跑测试**

Run: `npm run typecheck`
Expected: exit 0（按需删除因重构而未使用的 imports，如 `ToolName`、`TaskContext`）

Run: `npx vitest run electron/agent/responses-loop.test.ts`
Expected: PASS（测试文件未做任何修改）

- [ ] **Step 9: 全量测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 10: 提交**

```bash
git add electron/agent/responses-loop.ts
git commit -m "refactor(agent): Responses loop 接入共享行为模块（行为不变）"
```

---

### Task 8: Anthropic loop 接入共享模块（补齐缺口）

**Files:**
- Modify: `electron/agent/anthropic-loop.ts`
- Test: `electron/agent/anthropic-loop.test.ts`（追加用例）
- Test: `electron/agent/shared/loop-contract.test.ts`（双协议契约测试，新建）
- Modify: `electron/main.ts`（子代理选项对齐，`runOneSubagent` 的 anthropic 分支）

**Interfaces:**
- Consumes: Task 1-6 全部共享模块
- Produces: `AnthropicLoopOptions` 新增 `requireApprovalAfterLimit?: boolean`、`compactionSummaryEnabled?: boolean`

- [ ] **Step 1: 写失败测试（追加到现有 describe 内 + 新增契约测试文件）**

```ts
  it('工具输出超过上限时截断写入 hub，tool_result 事件仍返回完整结果', async () => {
    const big = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), big);
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'big.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 6 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const seen: Array<{ output?: string }> = [];
    for await (const event of runAnthropicAgentLoop('读大文件', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: { create: mockCreate },
    })) {
      if (event.type === 'tool_result') seen.push((event.toolResult?.result ?? {}) as { output?: string });
    }

    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('"truncation"');
    expect(seen[0]?.output?.length).toBe(big.length);
  });

  it('达到软阈值时压缩并重建消息窗口（被丢弃前缀不进入请求）', async () => {
    const hub = new ContextHub('sub-session', workDir, 30_000, 1_000, { persist: false });
    const prefix = Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    hub.addResponseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `DROP-ME-PREFIX ${prefix}` }], status: 'completed' });
    for (let i = 0; i < 10; i++) {
      hub.addResponseItem({
        type: 'message',
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: [{ type: i % 2 === 0 ? 'output_text' : 'input_text', text: `KEEP-${i} ${'y'.repeat(200)}` }],
        status: 'completed',
      });
    }

    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
      content: [{ type: 'text', text: 'ok' }],
    });

    const events = [];
    for await (const event of runAnthropicAgentLoop('继续', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: { create: mockCreate },
    })) events.push(event);

    expect(events.some((event) => event.type === 'summary')).toBe(true);
    const firstRequest = mockCreate.mock.calls[0]![0];
    const serialized = JSON.stringify(firstRequest.messages);
    expect(serialized).not.toContain('DROP-ME-PREFIX');
    expect(serialized).toContain('继续');
  });

  it('超过工具调用上限后进入强制审批（只读工具也会征求批准）', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'note.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-2', name: 'read_file', input: { path: 'note.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-3', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const onApproval = vi.fn().mockResolvedValue(true);
    const events = [];
    for await (const event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: { create: mockCreate }, maxToolCalls: 1, onApproval,
    })) events.push(event);

    expect(events.some((event) => event.type === 'content' && event.content?.includes('已达到工具调用上限(1)'))).toBe(true);
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) }),
    );
  });

  it('危险工具（write_file）在 Anthropic 路径同样需要审批', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'write_file', input: { path: 'x.txt', content: 'x' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const onApproval = vi.fn().mockResolvedValue(false);
    for await (const _event of runAnthropicAgentLoop('写文件', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: { create: mockCreate }, onApproval,
    })) { /* 消费事件 */ }

    expect(onApproval).toHaveBeenCalledTimes(1);
    const output = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(output && output.type === 'function_call_output' ? output.output : '').toContain('用户拒绝了此操作');
  });
```

契约测试文件（参数化对跑两条协议；anthropic 半区在实现前应失败）：

```ts
// electron/agent/shared/loop-contract.test.ts
/**
 * 双协议契约测试：同一场景分别驱动 Responses / Anthropic 两条 loop，
 * 断言共享行为（输出截断 / 超限审批 / 危险工具审批）表现一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../../context/context-hub';
import { runResponsesLoop } from '../responses-loop';
import { runAnthropicAgentLoop } from '../anthropic-loop';
import type { ChatStreamEvent, ModelConfig, ToolCall } from '../../../shared/ipc';

const { mockCreateStream, mockAnthropicCreate, mockRetrieveMemories, mockRequiresApproval } = vi.hoisted(() => ({
  mockCreateStream: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockRetrieveMemories: vi.fn().mockResolvedValue({ memories: [], promptBlock: null }),
  mockRequiresApproval: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../llm/responses', () => ({
  ResponsesClient: class {
    async *createStream(): AsyncGenerator<Record<string, unknown>> {
      const events = (await mockCreateStream()) as Record<string, unknown>[];
      for (const event of events ?? []) yield event;
    }
    cancel() {}
  },
}));
vi.mock('../../memory/memory-injector', () => ({ retrieveMemoriesForInjection: mockRetrieveMemories }));
vi.mock('../../mcp/mcp-manager', () => ({
  mcpManager: { requiresApproval: mockRequiresApproval, callTool: vi.fn() },
}));

const MODEL: ModelConfig = {
  id: 'contract-model',
  label: 'Contract',
  baseUrl: 'https://api.example.com',
  model: 'test',
  apiKey: 'test-key',
  isCustom: false,
};

let workDir = '';

function queueResponsesRounds(rounds: Array<Array<Record<string, unknown>>>): void {
  mockCreateStream.mockImplementation(async () => rounds.shift() ?? []);
}

function makeAnthropicRound(content: unknown[], stopReason: string): Record<string, unknown> {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
    content,
  };
}

async function runScenario(
  protocol: 'responses' | 'anthropic',
  prompt: string,
  options: { onApproval?: (toolCall: ToolCall) => Promise<boolean>; maxToolCalls?: number } = {},
): Promise<{ events: ChatStreamEvent[]; hub: ContextHub }> {
  const sessionId = `contract-${protocol}`;
  const hub = new ContextHub(sessionId, workDir, 256_000, 16_384, { persist: false });
  const events: ChatStreamEvent[] = [];
  if (protocol === 'responses') {
    for await (const event of runResponsesLoop(prompt, {
      model: MODEL, cwd: workDir, sessionId, contextHub: hub, allowSubagents: false,
      ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}),
      ...(options.onApproval ? { onApproval: options.onApproval } : {}),
    })) events.push(event);
  } else {
    for await (const event of runAnthropicAgentLoop(prompt, {
      model: MODEL, cwd: workDir, sessionId, contextHub: hub, allowSubagents: false,
      client: { create: mockAnthropicCreate },
      ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}),
      ...(options.onApproval ? { onApproval: options.onApproval } : {}),
    })) events.push(event);
  }
  return { events, hub };
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-contract-'));
  await fs.writeFile(path.join(workDir, 'note.txt'), 'hello contract');
  mockCreateStream.mockReset();
  mockAnthropicCreate.mockReset();
  mockRetrieveMemories.mockClear();
  mockRetrieveMemories.mockResolvedValue({ memories: [], promptBlock: null });
  mockRequiresApproval.mockReset();
  mockRequiresApproval.mockResolvedValue(false);
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe.each(['responses', 'anthropic'] as const)('%s 契约', (protocol) => {
  it('工具输出超限时 hub 截断、事件仍为完整结果', async () => {
    const big = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), big);
    const args = JSON.stringify({ path: 'big.txt' });

    if (protocol === 'responses') {
      const call = { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'big.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }

    const { events, hub } = await runScenario(protocol, '读大文件');

    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('"truncation"');
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect((toolResult?.toolResult?.result as { output?: string } | undefined)?.output?.length).toBe(big.length);
  });

  it('超过工具调用上限后转为强制审批', async () => {
    const args = JSON.stringify({ path: 'note.txt' });
    if (protocol === 'responses') {
      const call1 = { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: args, status: 'completed' };
      const call2 = { type: 'function_call', call_id: 'call-2', name: 'read_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call1 },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call1], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.output_item.done', item: call2 },
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [call2], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r3', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'note.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'note.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }
    const onApproval = vi.fn().mockResolvedValue(true);

    const { events } = await runScenario(protocol, '任务', { maxToolCalls: 1, onApproval });

    expect(events.some((event) => event.type === 'content' && event.content?.includes('已达到工具调用上限(1)'))).toBe(true);
    expect(onApproval).toHaveBeenCalledWith(expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) }));
  });

  it('危险工具需审批，拒绝后不落盘', async () => {
    const args = JSON.stringify({ path: 'x.txt', content: 'x' });
    if (protocol === 'responses') {
      const call = { type: 'function_call', call_id: 'call-1', name: 'write_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'write_file', input: { path: 'x.txt', content: 'x' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }
    const onApproval = vi.fn().mockResolvedValue(false);

    const { hub } = await runScenario(protocol, '写文件', { onApproval });

    expect(onApproval).toHaveBeenCalledTimes(1);
    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('用户拒绝了此操作');
    await expect(fs.stat(path.join(workDir, 'x.txt'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行新测试确认失败**

Run: `npx vitest run electron/agent/anthropic-loop.test.ts electron/agent/shared/loop-contract.test.ts`
Expected: anthropic 新增 4 例与契约测试的 anthropic 半区 FAIL（截断未实现 / 无 summary / 报错而非审批 / 无审批调用）；现有用例与契约测试的 responses 半区 PASS

- [ ] **Step 3: 替换 imports 与本地定义**

- 删除：`invokeTool`（`./tools` 导入中）、本地常量 `DANGEROUS_TOOLS` / `PLAN_MODE_SENSITIVE_TOOLS`、本地函数 `findPlanStepForTool` / `buildInstructions`
- 新增：

```ts
import { needsApproval } from './shared/tool-policy';
import { findPlanStepForTool } from './shared/plan-steps';
import { executeToolCall } from './shared/tool-pipeline';
import { runBudgetCheck } from './shared/context-budget';
import { evaluateToolCallLimit, MAX_TOOL_CALLS_DEFAULT } from './shared/loop-limits';
import { migrateHistoryToHub } from './shared/history-migration';
import { buildInstructions } from './shared/instructions';
import { projectAnthropicMessages } from './shared/anthropic-projection';
import { estimateRequestTokens } from '../context/token-estimator';
import { summarizeWithModel } from '../llm/client-factory';
import { COMPACTION_SUMMARY_PROMPT } from '../context/compactor';
```

（`getSystemPrompt`/`AgentPlatformInfo` 文件已有导入，不要重复添加；按 typecheck 结果清理未使用 imports。）

- [ ] **Step 4: 选项接口扩展**

在 `AnthropicLoopOptions` 中新增：

```ts
  /** 达到 maxToolCalls 上限后转为强制审批模式（默认 true） */
  requireApprovalAfterLimit?: boolean;
  /** 压缩时是否调用 LLM 生成对话摘要（默认 false） */
  compactionSummaryEnabled?: boolean;
```

- [ ] **Step 5: 消息初始化改为迁移 + 投影**

把 `const messages: AnthropicMessage[] = [];` 起到 `messages.push({ role: 'user', content: userMessage });` 的整段替换为：

```ts
  migrateHistoryToHub(options.contextHub, options.history);
  let messages: AnthropicMessage[] = projectAnthropicMessages(options.contextHub.getResponseItems());

  messages.push({ role: 'user', content: userMessage });
```

- [ ] **Step 6: 预算检查替换硬阈值预检**

把循环内 `if (options.contextHub.isHardLimited()) { ... }` 整段替换为：

```ts
    const budget = await runBudgetCheck({
      hub: options.contextHub,
      requestTokens: estimateRequestTokens({
        items: [],
        instructions: buildInstructions(system, options.contextHub.getContext()),
        tools,
      }),
      signal: options.signal,
      summarize:
        options.compactionSummaryEnabled === true
          ? (transcript) => summarizeWithModel(options.model, COMPACTION_SUMMARY_PROMPT, transcript, options.signal)
          : undefined,
    });
    for (const budgetEvent of budget.events) yield budgetEvent;
    if (budget.compacted) {
      // 压缩后从 hub 重建消息窗口：被丢弃前缀必须离开请求体
      messages = projectAnthropicMessages(options.contextHub.getResponseItems());
    }
    if (budget.hardLimited) {
      return;
    }
```

- [ ] **Step 7: 限额检查替换**

把 `toolCalls += uses.length;` 起的三行报错替换为：

```ts
    toolCalls += uses.length;
    const limit = evaluateToolCallLimit(toolCalls, options.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT, {
      requireApprovalAfterLimit: options.requireApprovalAfterLimit,
    });
    if (limit.kind === 'force_approval') {
      forceApprovalMode = true;
      yield { type: 'content', content: limit.message };
    } else if (limit.kind === 'error') {
      yield { type: 'error', error: limit.message, errorMeta: { kind: 'invalid_request', hint: limit.hint, retryable: false } };
      return;
    }
```

并在循环前声明 `let forceApprovalMode = false;`（与 `toolCalls` 同处）。

- [ ] **Step 8: 审批判定替换**

把 `// 内置危险工具 / plan 模式敏感工具 / MCP 审批策略要求时等待用户批准……` 起到 `if (requiresApproval) {` 替换为：

```ts
      // 内置危险工具 / plan 模式敏感工具 / MCP 审批策略 / 强制审批模式要求时等待用户批准；缺少 onApproval 时 fail-closed 拒绝
      const requiresApproval = await needsApproval({
        toolName: name,
        planMode,
        forceApproval: forceApprovalMode,
        mcpRequiresApproval: (toolName) => mcpManager.requiresApproval(toolName),
      });
      if (requiresApproval) {
```

- [ ] **Step 9: 工具执行改共享管道**

把工具执行的 `try { ... } catch` 内从 `const toolContext: ToolExecutionContext = {` 到 `if (name === 'task_complete' && result.ok) taskCompleteAccepted = true;` 之前替换为：

```ts
        const toolContext: ToolExecutionContext = {
          sessionId: options.sessionId,
          agentId: options.agentId ?? 'main',
          contextRevision: options.contextHub.getRevision(),
          workspaceRevision: options.contextHub.getWorkspaceRevision(),
          planStepId: matchedPlanStep?.id ?? options.contextHub.getContext().plan.steps.find((step) => step.status === 'in_progress')?.id,
          toolCallId: callId,
        };

        const { outputText, raw } = await executeToolCall({
          hub: options.contextHub,
          cwd: options.cwd,
          name,
          args,
          matchedPlanStepId: matchedPlanStep?.id,
          context: toolContext,
        });

        outputs.push({ type: 'tool_result', tool_use_id: callId, content: outputText });
        options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output: outputText });
        yield { type: 'tool_result', toolResult: { name, toolCallId: callId, result: raw } };

        if (name === 'task_complete' && raw.ok) taskCompleteAccepted = true;
```

catch 分支保持原样。

- [ ] **Step 10: 子代理选项对齐（main.ts）**

在 `runOneSubagent` 的 anthropic 分支（`runAnthropicAgentLoop(definition.task, {`）新增一行，与 responses 分支一致：

```ts
          requireApprovalAfterLimit: true,
```

- [ ] **Step 11: 跑测试**

Run: `npm run typecheck`
Expected: exit 0

Run: `npx vitest run electron/agent/anthropic-loop.test.ts electron/agent/shared/loop-contract.test.ts`
Expected: PASS（含新增 4 例与契约测试 6 例）

Run: `npm test`
Expected: 全部通过

- [ ] **Step 12: 提交**

```bash
git add electron/agent/anthropic-loop.ts electron/agent/anthropic-loop.test.ts electron/agent/shared/loop-contract.test.ts electron/main.ts
git commit -m "feat(agent): Anthropic loop 接入共享模块并补齐截断/压缩/超限审批"
```

---

### Task 9: main.ts IPC runner 去重（session-runner）

**Files:**
- Create: `electron/agent/session-runner.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `runResponsesLoop`、`runAnthropicAgentLoop`、`ContextHub`、`SubagentCoordinator`、`ChatStreamRegistry`
- Produces: `runAgentSession(deps: SessionRunnerDeps, request, model, streamId): Promise<void>`

- [ ] **Step 1: 记录基线**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 2: 创建 `electron/agent/session-runner.ts`（完整内容）**

```ts
/**
 * IPC 会话编排（协议无关）。
 *
 * 合并原 main.ts 的 runResponsesLoopForIpc / runAnthropicLoopForIpc 两份近似实现：
 * 会话/身份解析、附件注入、ContextHub + 子代理接线、审批桥、事件转发、
 * 通知、资源清理与会话后记忆提取。协议差异仅剩循环选择。
 */
import { app, powerSaveBlocker, type BrowserWindow } from 'electron';
import type {
  ChatRequest,
  ChatStreamEvent,
  ModelConfig,
  OpenAITool,
  SkillDef,
  SubagentDef,
  ToolCall,
} from '../../shared/ipc';
import type { ResponseFunctionTool } from '../../shared/responses';
import type { ChatStreamRegistry } from '../chat/stream-registry';
import { ContextHub, type PlanStep } from '../context/context-hub';
import { SubagentCoordinator, type SubagentContextPacket } from './subagent-coordinator';
import { setSubagentRunner } from './tools/dispatch-subagents';
import { runResponsesLoop } from './responses-loop';
import { runAnthropicAgentLoop } from './anthropic-loop';

export interface SessionRunnerDeps {
  getWindow: () => BrowserWindow | null;
  chatStreams: ChatStreamRegistry;
  attachContextEvents: (hub: ContextHub, send: (event: ChatStreamEvent) => void) => () => void;
  notifyTaskEnd: (
    state: { completed: boolean; failed: boolean; aborted: boolean },
    focus: () => void,
  ) => void;
  unregisterBrowserStream: (sessionId: string, streamId: string) => void;
  runSubagent: (
    definition: SubagentDef,
    packet: SubagentContextPacket,
    model: ModelConfig,
    cwd: string,
    sessionId: string,
    send: (event: ChatStreamEvent) => void,
    signal: AbortSignal,
    parentStreamId: string,
    approvalTimeoutMs?: number,
  ) => Promise<{ summary: string; ok: boolean; usage: { promptTokens: number; completionTokens: number } }>;
  extractMemories: (request: ChatRequest, model: ModelConfig) => Promise<void>;
}

export async function runAgentSession(
  deps: SessionRunnerDeps,
  request: ChatRequest,
  model: ModelConfig,
  streamId: string,
): Promise<void> {
  const send = (event: ChatStreamEvent) => {
    const win = deps.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('chat-stream', { streamId, event });
    }
  };

  // 记忆注入按项目 + 归属身份检索：解析会话所属项目与身份
  let memoryProjectId: string | undefined;
  let memoryUserId: string | undefined;
  try {
    const { getSession } = await import('../store/db');
    const session = getSession(request.sessionId);
    memoryProjectId = session?.projectId ?? undefined;
    memoryUserId = session?.userId;
  } catch {
    // 会话解析失败时按个人记忆注入
  }

  const messages = request.messages.map(({ attachments: _a, ...rest }) => rest);
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    send({ type: 'error', error: '消息历史末尾必须是 user 消息' });
    return;
  }

  // 附件注入
  let userContent = last.content;
  if (request.attachments && request.attachments.length > 0) {
    const attachmentLines = request.attachments.map(
      (a) => `- ${a.name} → ${a.relPath}（${a.kind === 'image' ? '图片' : '文件'}）`,
    );
    userContent = `用户附带附件（位于工作区 .stellara-attachments/ 目录，可用 read_file 读取）：\n${attachmentLines.join('\n')}\n\n${userContent}`;
  }

  // 防御：初始化失败（如数据库表缺失）时向 UI 回传错误，而不是无事件挂起
  let contextHub: ContextHub;
  try {
    contextHub = new ContextHub(
      request.sessionId,
      model.workDir || '.',
      model.contextWindow || 256000,
      model.maxOutputTokens || 16384,
    );
  } catch (err) {
    send({ type: 'error', error: `会话上下文初始化失败：${err instanceof Error ? err.message : String(err)}` });
    send({ type: 'done' });
    return;
  }
  const coordinator = new SubagentCoordinator(request.sessionId, contextHub);
  deps.attachContextEvents(contextHub, send);

  // 创建 AbortController
  const ctrl = deps.chatStreams.start(streamId, request.sessionId);
  let terminalEventSent = false;
  let taskCompleted = false;
  let taskFailed = false;

  // macOS：阻止系统休眠
  let powerSaveId: number | null = null;
  if (process.platform === 'darwin') {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  }

  const onApproval = async (toolCall: ToolCall): Promise<boolean> => {
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    send({
      type: 'approval_required',
      approval: { id: approvalId, toolName: toolCall.function.name, args: toolCall.function.arguments, toolCallId: toolCall.id },
    });
    const requestedTimeout = request.approvalTimeoutMs ?? 60_000;
    return deps.chatStreams.requestApproval(streamId, approvalId, Math.min(Math.max(requestedTimeout, 1_000), 300_000));
  };
  const onPlanApproval = async (plan: { objective: string; constraints: string[]; steps: PlanStep[] }): Promise<boolean> => {
    const approvalId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    send({
      type: 'plan_approval_required',
      planApproval: { id: approvalId, plan: plan.steps.map((step) => step.description) },
    });
    const requestedTimeout = request.approvalTimeoutMs ?? 300_000;
    return deps.chatStreams.requestApproval(streamId, approvalId, Math.min(Math.max(requestedTimeout, 1_000), 300_000));
  };

  try {
    const cwd = model.workDir!;

    const { loadConfig } = await import('../config/config-v2');
    const appConfig = await loadConfig();
    const compactionSummaryEnabled = appConfig.app.contextCompactionSummaryEnabled !== false;

    // 加载 skills + /skill 精确调用目标
    let skills: SkillDef[] = [];
    let activeSkill: SkillDef | undefined;
    try {
      const { loadSkillsWithErrors, findSkill } = await import('./skills');
      const { items } = await loadSkillsWithErrors(cwd);
      skills = items.filter((s) => s.enabled !== false);
      if (request.activeSkillName) {
        activeSkill = findSkill(items.filter((s) => s.enabled !== false), request.activeSkillName) ?? undefined;
      }
    } catch {
      // skills 加载失败不影响 agent 运行
    }

    // 加载 MCP 工具（全量 + plan 模式可见的子集）
    let extraTools: OpenAITool[] = [];
    let planExtraTools: OpenAITool[] = [];
    try {
      const { mcpManager } = await import('../mcp/mcp-manager');
      extraTools = await mcpManager.getEnabledTools();
      planExtraTools = await mcpManager.getEnabledTools(true);
    } catch {
      // MCP 工具加载失败不影响 agent 运行
    }

    // 设置子代理执行器
    coordinator.setRunner(async (definition, packet, signal) => {
      return deps.runSubagent(definition, packet, model, cwd, request.sessionId, send, signal, streamId, request.approvalTimeoutMs);
    });
    setSubagentRunner(request.sessionId, {
      dispatch: (definitions) => coordinator.dispatch(definitions),
    });

    const loop = model.wireApi === 'anthropic'
      ? runAnthropicAgentLoop(userContent, {
          model,
          cwd,
          sessionId: request.sessionId,
          contextHub,
          history: messages.slice(0, -1),
          planMode: request.planMode ?? false,
          platform: { platform: process.platform, arch: process.arch },
          skills,
          activeSkill,
          extraTools,
          planExtraTools,
          memoryProjectId,
          memoryUserId,
          compactionSummaryEnabled,
          signal: ctrl.signal,
          onApproval,
          onPlanApproval,
        })
      : runResponsesLoop(userContent, {
          model,
          cwd,
          sessionId: request.sessionId,
          contextHub,
          history: messages.slice(0, -1),
          planMode: request.planMode ?? false,
          platform: { platform: process.platform, arch: process.arch },
          skills,
          activeSkill,
          extraTools: extraTools as unknown as ResponseFunctionTool[],
          planExtraTools: planExtraTools as unknown as ResponseFunctionTool[],
          memoryProjectId,
          memoryUserId,
          compactionSummaryEnabled,
          signal: ctrl.signal,
          onApproval,
          onPlanApproval,
        });

    for await (const event of loop) {
      if (ctrl.signal.aborted) break;
      send(event);
      if (event.type === 'task_complete') taskCompleted = true;
      if (event.type === 'error') taskFailed = true;
      if (event.type === 'done' || event.type === 'error') terminalEventSent = true;
    }

    // 任务结束通知
    const win = deps.getWindow();
    const windowActive = win !== null && !win.isDestroyed() && win.isFocused();
    if (!windowActive && !ctrl.signal.aborted && (taskCompleted || taskFailed)) {
      if (process.platform === 'darwin') {
        app.dock?.bounce(taskFailed ? 'critical' : 'informational');
      }
      deps.notifyTaskEnd(
        { completed: taskCompleted, failed: taskFailed, aborted: false },
        () => {
          const focusWin = deps.getWindow();
          if (focusWin && !focusWin.isDestroyed()) {
            if (focusWin.isMinimized()) focusWin.restore();
            focusWin.show();
            focusWin.focus();
          }
        },
      );
    }
  } catch (err) {
    if (!ctrl.signal.aborted) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    setSubagentRunner(request.sessionId, null);
    coordinator.dispose();
    contextHub.dispose();
    deps.chatStreams.cleanup(streamId);
    deps.unregisterBrowserStream(request.sessionId, streamId);
    if (!terminalEventSent) send({ type: 'done' });

    // macOS：恢复系统休眠
    if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }

    // 异步提取记忆
    void deps.extractMemories(request, model).catch(() => {});
  }
}
```

- [ ] **Step 3: main.ts 调用点替换**

把 `chat:start` 处理里的分支：

```ts
    const wireApi = configured.wireApi ?? 'responses';
    if (wireApi === 'anthropic') {
      void runAnthropicLoopForIpc(request, configured, streamId);
    } else {
      void runResponsesLoopForIpc(request, configured, streamId);
    }
```

替换为：

```ts
    void runAgentSession(
      {
        getWindow: () => mainWindow,
        chatStreams,
        attachContextEvents,
        notifyTaskEnd,
        unregisterBrowserStream,
        runSubagent: runOneSubagent,
        extractMemories: extractMemoriesFromSession,
      },
      request,
      configured,
      streamId,
    );
```

并在 main.ts imports 增加：

```ts
import { runAgentSession } from './agent/session-runner';
```

- [ ] **Step 4: 删除旧的 runner 函数**

删除 `main.ts` 中的 `runAnthropicLoopForIpc`（原 1766 起）与 `runResponsesLoopForIpc`（原 1947 起）两个函数整体。`runOneSubagent`、`resolveSubagentModel`、`extractMemoriesFromSession` 保留在 main.ts。

- [ ] **Step 5: 类型检查与清理**

Run: `npm run typecheck`
Expected: exit 0（删除 main.ts 中因迁出而未使用的 imports，如 `runAnthropicAgentLoop` 仅剩 `runOneSubagent` 使用则保留）

- [ ] **Step 6: 全量测试与构建**

Run: `npm test`
Expected: 全部通过

Run: `npm run build`
Expected: exit 0

- [ ] **Step 7: 提交**

```bash
git add electron/agent/session-runner.ts electron/main.ts
git commit -m "refactor(agent): IPC 会话编排合并到 session-runner"
```

---

### Task 10: 最终门禁与冒烟

**Files:**
- 无代码改动（验证任务）

- [ ] **Step 1: 跑全部 CI 门禁**

```bash
git diff --check
npm run typecheck
npm test
npm run build
```

Expected: 全部 exit 0；测试数与基线一致（新增测试除外）。

- [ ] **Step 2: 人工冒烟（需要运行应用）**

启动：`npm run dev`，逐项确认并勾选：

- [ ] Responses 会话：新建会话 → 让 agent「读一个文件 → 改一个文件 → 跑 `npm test` 或 `ls` → 汇报完成」，审批弹窗正常，任务收尾无报错。
- [ ] Anthropic 会话（wireApi=anthropic 的模型）：同上流程走通。
- [ ] 两条协议各触发一次审批拒绝：拒绝后 agent 收到「用户拒绝了此操作」，会话可继续。
- [ ] 长会话压缩：在 Anthropic 会话里让 agent 读取多个大文件触发软阈值压缩，UI 出现压缩提示且后续对话正常（若难以人工触发，以 Task 8 单测为准并在报告里注明）。

- [ ] **Step 3: 结果记录与分支收尾**

在会话里报告：门禁结果、冒烟结论、分支名与 commit 列表；随后按 finishing-a-development-branch 流程征询合并方式（合回 main / PR / 保留）。

---

## Self-Review

- **Spec coverage**：spec §3.1-3.9 的 7 个共享模块（另加 `instructions.ts`，见 Task 6）→ Task 1-6；§3.8 两条 loop 接入 → Task 7/8；§3.9 runner 去重 → Task 9；§4 行为变化 → Task 8（截断/压缩/超限/指令统一）已逐条落到测试；§5 测试策略 → 各任务单测 + 双协议契约测试（Task 8 的 `loop-contract.test.ts`，参数化对跑截断/超限/审批）+ Task 10 冒烟；§6 分期 → Task 1-6/7/8/9 与分期一一对应；§7 风险缓解 → 门禁与逐任务提交。
- **Placeholder scan**：无 TBD/TODO；所有代码步骤含完整可执行代码。
- **Type consistency**：`LimitDecision`（Task 2）在 Task 7/8 按 `force_approval/error(message,hint)` 使用；`BudgetCheckResult`（Task 4）在 Task 7/8 按 `events/compacted/hardLimited` 使用；`ExecuteToolCallResult.outputText/raw`（Task 3）在 Task 7/8 一致；`SessionRunnerDeps`（Task 9）与 main.ts 调用点字段一致。
- **Review Focus**：5 条均有测试（Task 1/2/5/8）。

