# S1 设计：双协议一致性（共享行为模块）

- 日期：2026-09-19
- 状态：待评审
- 前置：S2（数据一致性修复）已并入 main（`49d24e7`）
- 关联：本设计是改进计划 S1（评审 P0-1 / P1-5 与 main.ts runner 重复的合并处理）

## 1. 背景与问题

Responses 与 Anthropic 两条 agent loop 长期各自演化，共享行为出现漂移：

| 问题 | 证据 |
|---|---|
| Anthropic 无工具输出截断 | `anthropic-loop.ts:323-326` 把 `JSON.stringify(result)` 原样入库；Responses 走 `capToolOutput`（`responses-loop.ts:567`） |
| Anthropic 无自动压缩 | `ensureContextBudget` 只在 `responses-loop.ts:260` 调用；Anthropic 仅检查 `isHardLimited()`（`:157-160`）后报错 |
| 超限语义不同 | Responses 超过工具调用上限转入强制审批（`responses-loop.ts:436-450`）；Anthropic 直接报错终止（`anthropic-loop.ts:246-249`） |
| 工具策略双份定义 | `responses-loop.ts:98-100` 与 `anthropic-loop.ts:54-56` 各自维护 `DANGEROUS_TOOLS` / `PLAN_MODE_SENSITIVE_TOOLS` |
| 计划步骤匹配双份实现 | `findPlanStepForTool` 两处逐字重复 |
| 指令格式漂移 | Responses 用「已完成/待完成步骤」（`responses-loop.ts` buildInstructions）；Anthropic 用扁平「计划状态」（`anthropic-loop.ts:417-423`） |
| IPC 编排重复 | `main.ts` 的 `runAnthropicLoopForIpc`（1766）与 `runResponsesLoopForIpc`（1947）各约 150 行近似逻辑 |

已排除项：Anthropic 当前为非流式（`anthropic-loop.ts:162` 调 `create`；`AnthropicClient.createStream` 存在但全仓库无人使用）。流式对齐经确认**不在 S1 范围**，单独排期。

## 2. 目标与非目标

目标（验收标准）：

1. 危险工具与审批策略单点定义：新增/修改策略只改一处。
2. Anthropic 会话具备与 Responses 等价的工具输出截断、自动上下文压缩、超限强制审批语义。
3. 关键共享行为有参数化测试同时覆盖两条协议。
4. `npm test` / `npm run typecheck` / `npm run build` 全绿；冒烟清单通过。

非目标：

- Anthropic 流式输出对齐（backlog，单独排期）。
- 两个 loop 合并为单循环（明确选择保留双控制流）。
- 审批 UI、验证模型（S3）、调度写操作（S5）等其它子项目内容。
- 改变 Responses 侧任何对外行为。

## 3. 设计

### 3.1 模块总览

新增 `electron/agent/shared/`：

| 模块 | 职责 | 依赖 |
|---|---|---|
| `tool-policy.ts` | 危险工具/plan 敏感集合、审批判定 | 无（MCP 以回调注入） |
| `tool-pipeline.ts` | 单次工具执行：调用 + 截断 + context 事件记账 | `tools/index`、`context/compactor`、ContextHub |
| `context-budget.ts` | 迭代边界预算检查与压缩，产出待转发事件 | ContextHub |
| `loop-limits.ts` | 迭代/工具调用上限与超限决策 | 无 |
| `plan-steps.ts` | `findPlanStepForTool`（原两处实现合一） | 类型 |
| `anthropic-projection.ts` | ResponseItem[] → AnthropicMessage[] 投影 | 类型 |
| `history-migration.ts` | 旧会话历史一次性迁入 Context Hub（两 loop 统一） | ContextHub、类型 |

两条 loop 保留各自控制流，把上述行为当服务调用。

### 3.2 `tool-policy.ts`

```ts
export const DANGEROUS_TOOLS: ReadonlySet<string>;
export const PLAN_MODE_SENSITIVE_TOOLS: ReadonlySet<string>;

export interface ApprovalDecisionInput {
  toolName: string;
  planMode: boolean;
  forceApproval: boolean;
  /** MCP 工具的审批查询；非 mcp__ 前缀的工具不会调用它 */
  mcpRequiresApproval?: (name: string) => Promise<boolean>;
}

export async function needsApproval(input: ApprovalDecisionInput): Promise<boolean>;
```

判定顺序与现状保持一致：
`forceApproval || DANGEROUS_TOOLS.has(name) || (planMode && PLAN_MODE_SENSITIVE_TOOLS.has(name)) || (name.startsWith('mcp__') && await mcpRequiresApproval(name))`。

fail-closed：`mcp__` 前缀的工具若未提供 `mcpRequiresApproval` 回调，判定为需要审批（返回 true），而不是放行。

依赖方向：shared 不 import `mcp/mcp-manager`，由 loop 传入 `(name) => mcpManager.requiresApproval(name)`。

### 3.3 `tool-pipeline.ts`

```ts
export interface ExecuteToolCallInput {
  hub: ContextHub;
  cwd: string;
  name: string;
  args: Record<string, unknown>;
  /** from findPlanStepForTool；仅用于完成态推进，可为 undefined */
  matchedPlanStepId?: string;
  context: ToolExecutionContext; // sessionId/agentId/toolCallId/contextRevision/workspaceRevision
}

export interface ExecuteToolCallResult {
  /** 截断后的结果序列化，回传模型并写入 hub */
  outputText: string;
  /** 完整结果，供 UI tool_result 事件使用 */
  raw: ToolResult;
}

export async function executeToolCall(input: ExecuteToolCallInput): Promise<ExecuteToolCallResult>;
```

步骤序列（与现 Responses 完全一致，保证事件回放兼容）：

1. `commitEvent('tool_call_started', { id, name, args, planStepId })`
2. `invokeTool(name, args, cwd, { ...context, planStepId: matchedPlanStepId ?? context.planStepId })`
3. `capToolOutput(name, args, result)`
4. `commitEvent('tool_call_completed', { id, result: result.output, affectedFiles })`
5. `result.meta?.kind === 'command'` → `command_completed`；`exitCode === 0` → `verification_completed`（`relatedFiles = hub.getUnverifiedFiles()`）
6. `result.meta?.kind === 'edit'` → `file_modified`
7. `result.ok && matchedPlanStepId` → `plan_step_changed(completed)`

不变式：

- hub 存截断版（`capToolOutput` 结果），UI 拿完整版（现 Responses 语义）。
- 不含参数解析、`toolGuard`、审批等待、`task_complete` 门禁——这些留在 loop（与完成语义/审批通道强相关）。
- 调用方负责 yield `tool_call`（调用前）与 `tool_result`（调用后，使用 `raw`）。

### 3.4 `context-budget.ts`

```ts
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
  requestTokens: number; // 由 loop 用 estimateRequestTokens({items:[], instructions, tools}) 计算
  summarize?: (transcript: string) => Promise<string | undefined>;
  signal?: AbortSignal;
}): Promise<BudgetCheckResult>;
```

- 语义与现 Responses 一致：软阈值触发压缩、压缩后仍超硬阈值产出 error 事件（文案与现状一致，Anthropic 采用同一文案）。
- loop 侧职责：`events` 逐一 yield；`hardLimited` 时终止；`compacted` 时刷新 instructions（Responses）或重建 messages（Anthropic）。

### 3.5 `loop-limits.ts`

```ts
export const MAX_TOOL_CALLS_DEFAULT = 50;
export const MAX_ITERATIONS_DEFAULT = 200;

export type LimitDecision =
  | { kind: 'continue' }
  | { kind: 'force_approval' }
  | { kind: 'error'; message: string };

export function evaluateToolCallLimit(
  totalCalls: number,
  maxCalls: number,
  opts: { requireApprovalAfterLimit?: boolean },
): LimitDecision;
```

决策表：`totalCalls <= maxCalls` → continue；超限且 `requireApprovalAfterLimit !== false` → force_approval（附「已达到工具调用上限(N)，进入审批模式」提示，由 loop yield）；否则 → error（原文案）。

### 3.6 `anthropic-projection.ts`

```ts
export function projectAnthropicMessages(items: ResponseItem[]): AnthropicMessage[];
```

映射规则：

| ResponseItem | Anthropic message |
|---|---|
| `message` role=user/assistant，文本非空 | 同角色消息，文本块；与相邻同角色消息合并 |
| `function_call` | assistant 的 `tool_use` 块（`input` 用 `JSON.parse(arguments)`，失败兜底 `{}`）；合并进相邻 assistant 消息 |
| `function_call_output` | user 的 `tool_result` 块（`tool_use_id = call_id`，`content = output`）；连续多个合并进同一条 user 消息 |
| `reasoning` | 跳过 |
| 其它/空文本 | 跳过 |

不变式：

- 任一被保留的 `function_call_output`，其对应 `function_call` 必然也在被保留窗口内（由压缩的「事务组件」保证，`compactor.ts:transactionComponents`）。
- Anthropic 未持久化 thinking 块，且请求未启用 extended thinking（`create` 未传 `thinking` 参数）；将来若启用，需同步扩展投影（在 spec 中记为已知限制）。

使用时机（Anthropic loop）：

1. run 开始且 hub 非空：`messages = projectAnthropicMessages(hub.getResponseItems())`（替代目前直接回灌原始 history）。
2. 每次 `runBudgetCheck` 返回 `compacted === true` 后：用同一投影重建 `messages`，确保被丢弃前缀真正离开请求体。
3. 其余迭代继续使用本地 `messages` 追加（保留 API 返回的原始块，迭代内零转换）。

### 3.7 `history-migration.ts`

把两 loop 中「hub 为空时迁移旧会话历史」的内联逻辑合一：user/assistant 消息、assistant 上的 `tool_calls`、role=tool 的 `tool_call_id` 输出完整迁移；调用后统一由投影（Anthropic）或 hub items（Responses）构造请求。行为与现 Responses 迁移一致。

### 3.8 两条 loop 的接入

**Responses loop（行为不变）**：

- 删除本地 `DANGEROUS_TOOLS` / `PLAN_MODE_SENSITIVE_TOOLS`，改 `tool-policy`。
- 工具执行改 `executeToolCall`（连同 `capToolOutput` 一并移入管道）。
- 预算检查改 `runBudgetCheck`；instructions 刷新逻辑保留。
- 超限改 `evaluateToolCallLimit`。

**Anthropic loop（消除缺口）**：

- 同上四项接入（首次获得截断、自动压缩、force approval）。
- 新增 `requireApprovalAfterLimit?: boolean` 与 `compactionSummaryEnabled?: boolean` 选项（与 Responses 对齐）；主会话传配置值，子代理沿用默认。
- `messages` 重建：按 3.6 的两个时机。
- `buildInstructions` 统一为 Responses 格式（已完成/待完成步骤、压缩摘要注入）。这是本设计唯一主动改变 Anthropic 提示词的点。

### 3.9 `main.ts` runner 去重

抽 `electron/agent/session-runner.ts`，承载：

- 发送包装（`mainWindow.webContents.send('chat-stream')`）、stream 注册与 AbortController、macOS 防休眠。
- 会话/项目/身份解析、附件注入、skills/MCP 工具加载。
- ContextHub + SubagentCoordinator 创建与接线、子代理 runner 选项对齐（两协议同一选项集：`planMode: readOnly`、`rolePrompt`、`agentId`、`signal`、`maxToolCalls: 100`、`requireApprovalAfterLimit: true`、`allowSubagents: false`、`onApproval`、`toolGuard`）。
- 审批闭包（工具/计划审批 ID、超时钳制）与 `onApproval` / `onPlanApproval`。
- `wireApi` 选择循环（`anthropic` → `runAnthropicAgentLoop`，否则 `runResponsesLoop`）、事件转发、终止态跟踪、通知、finally 清理、会话后记忆提取。

两个 IPC 入口退化为薄封装。纯等价搬移：现有 IPC 行为、事件序列、通知语义不变。

## 4. 显式行为变化（仅 Anthropic 侧）

1. 工具输出入库 16k 截断（新增保护）。
2. 自动上下文压缩（新增）；压缩后会重建消息。
3. 超过工具调用上限：由「直接报错终止」改为「进入强制审批模式」。
4. 指令格式与 Responses 统一（轻微提示词变化）。
5. 压缩摘要能力可用（跟随 `app.contextCompactionSummaryEnabled`，与 Responses 一致）。

Responses 侧、安全策略、审批语义、MCP 策略：不变。

## 5. 测试策略

新模块单测：

- `tool-policy.test.ts`：危险工具 / plan 敏感 / force / MCP 回调组合表；非 mcp 前缀不触发回调。
- `tool-pipeline.test.ts`：大输出被截断（hub 输出为 truncation stub、`raw` 完整）；事件序列（edit → file_modified；command exit 0 → command_completed + verification_completed；ok + step → completed）。
- `context-budget.test.ts`：低于软阈值 no-op；软阈值压缩并产出 summary 事件；压缩后仍超硬阈值产出 error。
- `loop-limits.test.ts`：未超限 / 超限转审批 / 超限报错 三分支。
- `anthropic-projection.test.ts`：纯文本；单工具轮；并行多工具轮（fc,fc,out,out）；文本+tool_use 合并；连续 output 合并；reasoning 跳过；args JSON 异常兜底；空文本跳过。
- `history-migration.test.ts`：含 tool_calls 与 tool 消息的历史迁移。

Loop 级等价用例（参数化对跑两条协议）：工具输出截断、预算压缩触发、超限决策、危险工具审批。

回归门禁：现有 2179 个测试全部保持通过；`npm run typecheck`、`npm run build`、`git diff --check`。

冒烟清单（main.ts 无单测，人工执行）：

1. Responses 会话：读文件 → 改文件 → 跑命令 → task_complete（回归确认）。
2. Anthropic 会话：同一流程（确认新接入不破主流程）。
3. 两条协议各触发一次审批拒绝，确认工具结果回传拒绝文案。

## 6. 实施分期

1. **阶段 1**：`shared/` 模块 + 单测（纯新增，不接 loop）。门禁：全量测试绿。
2. **阶段 2**：Responses loop 接入（行为不变）。门禁：现有 `responses-loop.test.ts` 断言不做修改即通过 + 全量测试绿。
3. **阶段 3**：Anthropic loop 接入（含补齐与投影）+ 新增测试。门禁：全量测试绿 + 冒烟 2/3。
4. **阶段 4**：main.ts runner 去重。门禁：typecheck/build/全量测试 + 冒烟 1-3。

每阶段独立提交；分支 `feat/s1-dual-protocol-consistency`，验收后合回 main。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 投影配对/顺序错误导致 Anthropic 请求非法 | 纯函数 + fixture 单测；压缩后重建的集成用例；保留窗口事务组件保证配对完整 |
| 管道抽取造成事件序列漂移（影响回放） | 事件提交顺序逐条对齐现状；loop 级测试断言事件 |
| main.ts 去重引入行为差异 | 等价搬移、不改外部接口；typecheck/build/全量测试 + 冒烟清单 |
| Anthropic 行为变化超预期 | 变化点已在第 4 节显式列出并单独提交，便于回退 |

## 8. 交付物

- 本设计文档（提交到 `docs/superpowers/specs/`）。
- 实施计划（writing-plans 产出，`docs/superpowers/plans/`）。
- 代码 + 测试（阶段 1-4）。

后续项（不在本 spec 内，列入实施计划的 backlog 章节）：Anthropic 流式输出对齐、S3 验证模型、S4 审批体验、S5 定时任务写操作。
