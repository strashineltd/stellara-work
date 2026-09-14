# 上下文压缩与 checkpoint 恢复（子项目 A）设计规格

> 日期：2026-09-14
> 状态：设计已确认，待写实施计划
> 前置：`main` @ `a7ba9cf`
> 来源：`docs/superpowers/plans/2026-08-19-v0.9.2-responses-context-upgrade.md` §6（已定但未实施的压缩设计）+ 2026-09-14 代码审查结论

## 1. 背景

v0.9.2 计划定义了 Token 预算、压缩顺序和结构化检查点，但只实施了数据结构，没有接线执行：

- `electron/agent/compress.ts` 是死代码（仅测试引用），且基于 `ChatMessage[]`，与现在的 `ResponseItem[]` 模型不匹配。
- 两个 agent loop 在达到硬阈值时直接报错中止（`responses-loop.ts:250-257`、`anthropic-loop.ts:154-157`），提示「请压缩后再继续」，但系统中没有压缩入口，会话死局。
- `context_compacted` 事件与 `summary` 流事件的定义、处理器和 UI 渲染器都已存在，但从无生产者（`context-hub.ts:691-701`、`shared/ipc.ts:151/191-195`、`MainView.tsx:688-697`）。
- `createCheckpoint()` 只能手动触发且不能恢复；构造函数重放全部事件与 items，无激活窗口概念（`context-hub.ts:182-196`）。
- Token 估算用 `JSON.stringify(item).length / 4`，不计入 instructions/工具 schema/注入记忆，对中文严重低估（`context-hub.ts:275-278`）。
- 单条工具输出无 token 上限，一次大 `read_file`/命令输出可让下一轮直接跨过硬阈值。

本子项目把上下文生命周期补齐：准确的预算估算、迭代边界同步压缩、事件溯源的前缀指针、崩溃幂等的恢复、UI 可见。Anthropic 通道因消息组装方式不同（`anthropic-loop.ts:69-92` 维护独立 message 数组），在子项目 C 重写时接入；本子项目的 hub 与压缩器按通道无关设计。

## 2. 已确认决策

- **范围**：本子项目为 Responses 通道接线 + 通道无关基建（估算器、压缩器、指针、checkpoint）；Anthropic 通道保持现状，C 接入。
- **触发**：迭代边界同步压缩。每次模型调用前检查：≥软阈值即压缩后继续；硬阈值只是兜底（压缩失败后仍超限才中止）；压缩失败降级为确定性结果，不阻塞。
- **恢复语义**：重启/重开会话时从指针自动重建活跃窗口；原始 items 保留在 `response_items` 表仅供审计/导出；**不自动续跑**任务。
- **内容策略**：确定性剪枝 + 结构化 checkpoint 为主；仅对无法结构化表达的对话残留做可选 LLM 摘要，摘要失败不影响压缩成功。
- **机制**：事件溯源前缀指针（`context_compacted` 事件载荷记录窗口起点），不做 schema 迁移、不做 active 标记列、不物理删除/替换 items。
- **默认值**：摘要默认开；单条工具输出上限 16K tokens；保留窗口目标 `usableInputBudget × 60%`；保留最少 1 个完整事务组。

## 3. Token 估算与预算

### 3.1 新增 `electron/context/token-estimator.ts`

- `estimateTextTokens(text: string): number`：tiktoken `cl100k_base` 单例（复用 `compress.ts` 的加载与回退思路）；加载失败回退 `ceil(len/4)`。
- `estimateItemsTokens(items: ResponseItem[]): number`：逐条序列化估算，含类型元数据开销。
- `estimateRequestTokens(input: { items: ResponseItem[]; instructions?: string; tools?: unknown[] }): number`：一次性覆盖 items + instructions + 工具 schema。
- 估算器本身不含校准；校准系数由 hub 统一应用（见 3.3）。

### 3.2 预算公式（沿用计划 §6.1）

```text
usableInputBudget = contextWindow − maxOutputTokens − toolReserveTokens(2000) − safetyReserveTokens(2000)
softThreshold = usableInputBudget × 0.75
hardThreshold = usableInputBudget × 0.90
```

`ContextHub.calculateUsage()` 改为：`currentInputTokens = estimateItemsTokens(items) × calibrationRatio + extraTokens`。`extraTokens` 由 loop 通过 `ensureContextBudget({ extraTokens })` 传入（instructions + 工具 schema + 记忆块的估算值），hub 记录最近一次值以便 `context_usage` 事件保持准确。

### 3.3 校准系数

- Hub 维护 `calibrationRatio`（初始 1.0，clamp `[0.5, 2.0]`）。
- Provider 返回 usage 后，loop 调用 `hub.recordReportedInputTokens(reported)`；hub 以 `reported / 本次请求的估算值` 为样本做 EWMA（α = 0.3）。
- 系数不持久化：每次构造 hub 从 1.0 开始，首轮调用后收敛。可接受，记为已知限制。

## 4. 压缩器（新增 `electron/context/compactor.ts`）

纯函数为主，输入活跃 items + TaskContext 状态 + 预算，输出保留 items、切点统计与可选摘要。不直接操作 DB/事件。

### 4.1 事务分组与切点

- 从新到旧把 items 分组成「事务组」：一个 `function_call` 与其配对的 `function_call_output`（同 `call_id`）必须在同一组；找不到配对 output 的 `function_call` 单独成组且必须保留（防御性，正常流程不会出现）。
- `reasoning` 与 `message` 归入其相邻组（向前归组），保证不会把 reasoning 与它解释的调用拆开。
- 从最新组向前累计 token，保留至累计超过保留目标 `floor(usableInputBudget × 0.6)`；**至少保留 1 个完整事务组**。
- 切点 = 最老的被保留组之前的边界；`windowStartIndex = 被丢弃的 items 数量`。

### 4.2 保留窗口内的大输出改写

- 同内容输出（sha256 相同且长度超过 2K tokens）去重：后者替换为 `{ deduped: true, sameAs: <call_id> }`。
- 单条工具结果超过 16K tokens（`estimateTextTokens`）时替换为 stub，按工具名区分：
  - `read_file`：`{ path, range?, digest, bytes, truncated: true }`（从原结果 JSON 提取 path/offset/limit；解析失败则退化为通用 stub）。
  - `run_command`：`{ exitCode, head（前 20 行）, tail（后 20 行）, digest, truncated: true }`。
  - 其他：`{ head, tail, digest, bytes, truncated: true }`。
- 工具结果进 hub 前由 loop 调用 `capToolOutput(name, result)` 施加同一上限（对 UI 展示的完整结果不受影响，只截进入上下文的部分）。

### 4.3 前缀摘要（可选，LLM）

- 仅当开关开启且存在 `summarize` 回调时执行；输入为被丢弃前缀中所有 `message` 文本 + 工具结果一行 stub（工具名 + 首行 + digest），并附带上一次压缩摘要以累积信息。
- 摘要 prompt：保留用户意图/约束、已完成工作、失败与排除过程、当前进展与未完成事项；≤ 800 字；不得编造。
- 失败（超时、空串、异常）只记录日志并返回 `summary: undefined`，确定性压缩结果照常生效。

### 4.4 迭代收缩

1. 先做 4.2 改写，按 4.1 切点，估算新窗口。
2. 若仍 ≥ 硬阈值：保留目标 × 0.5 重新切点（最低 1 组），最多 3 轮。
3. 仍超限：返回 `{ ok: false, reason: 'over_hard_limit' }`，由 loop 报明确错误终止（保留现有 error 事件机制）。

### 4.5 返回结构

```ts
interface CompactResult {
  ok: boolean;
  keptItems: ResponseItem[];
  droppedCount: number;
  windowStartIndex: number;
  windowDigest?: string;   // 首个保留 item 的 sha256（无保留则空）
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
  reason: 'soft_threshold' | 'hard_threshold' | 'manual';
}
```

`windowDigest` 用于恢复时的指针完整性校验（见 6.3）。

## 5. Hub 编排（`electron/context/context-hub.ts`）

### 5.1 `ensureContextBudget()`

```ts
async ensureContextBudget(opts: {
  extraTokens?: number;                       // instructions + tools + 记忆块
  summarize?: (transcript: string) => Promise<string | undefined>;
  force?: boolean;                            // 手动压缩：低于软阈值也执行
  signal?: AbortSignal;
}): Promise<{
  compacted: boolean;
  hardLimited: boolean;
  tokensBefore?: number;                      // compacted 时携带，供流事件直接使用
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
}>
```

流程：

1. 更新 `extraTokens` 与 usage；低于软阈值且非 `force` → `{ compacted: false }`。
2. `createCheckpoint()` 生成结构化检查点（失败则中止本次压缩并返回 `{ compacted: false, hardLimited: <当前是否超硬> }`）。
3. 调 `compactor.compact(...)`；确定性失败且超硬 → `{ compacted: false, hardLimited: true }`。
4. 成功：内存 `responseItems = keptItems`；`commitEvent('context_compacted', payload)`；返回 `{ compacted: true }`。
5. 提交事件后再重算 usage；若仍超硬（极端情况），同样返回 `hardLimited: true`。

`reason` 取值：`force` → `manual`；压缩前已超硬 → `hard_threshold`；否则 `soft_threshold`。返回值中的 `tokensBefore/tokensAfter/compressedCount/summary` 直接取自 `CompactResult`。

### 5.2 `context_compacted` 事件载荷

```ts
{
  windowStartIndex: number;   // 累计被丢弃的 items 数（恢复用，最新的覆盖旧的）
  droppedCount: number;       // 本次丢弃数量（UI 统计）
  windowDigest?: string;
  checkpointId: string;
  tokensBefore: number;
  tokensAfter: number;
  compressedCount: number;    // = droppedCount，沿用 UI 既有字段
  summary?: string;
  reason: 'soft_threshold' | 'hard_threshold' | 'manual';
}
```

`handleContextCompacted` 在重放与实时两条路径统一处理：写入 `context.compactionWindowStartIndex`、`context.compactionSummary`（新摘要覆盖旧值；无摘要时保留旧值）、`usage.lastCompactedAt`。`calculateUsage` 不再读取该事件里的 tokensAfter（统一由估算器计算，避免 691-701 行的覆盖问题）。

### 5.3 内存状态新增（`TaskContext`）

- `compactionWindowStartIndex: number`（默认 0）
- `compactionSummary?: string`
- 不进入 `contextStateView` 的敏感字段；如需展示，另加只读字段。

## 6. 恢复语义

### 6.1 构造时应用指针

- `restoreResponseItems()` 完成后，若 `compactionWindowStartIndex > 0`：执行 6.3 校验；通过则 `responseItems = responseItems.slice(windowStartIndex)`，失败则忽略指针（保留全量窗口，下一轮 `ensureContextBudget` 会重新压缩）。
- `restoreResponseItems()` 的 `responseItemSequence` 改为 `max(row.sequence)`（现在是 `rows.length`，跨压缩后会与持久化序列冲突）。

### 6.2 实时压缩路径

- 运行中压缩直接 slice 内存列表；后续新 items 正常 append；DB 中旧行不删除。重复压缩时 `windowStartIndex` 累计。

### 6.3 指针完整性校验

- 若 `windowStartIndex > items.length` → 指针非法，忽略并保留全量窗口。
- 若 `windowStartIndex === items.length`（压缩后尚未追加新 item）→ 合法，活跃窗口为空。
- 若 `windowStartIndex < items.length` 且 `windowDigest` 存在：对 `items[windowStartIndex]` 做 `sha256(stableJSON)`（键排序的 JSON.stringify）比对，不匹配 → 忽略指针并 `log.warn`。

### 6.4 checkpoint 与恢复的关系

- checkpoint 是审计与状态快照（`context_checkpoints` 表已存在）；任务状态本身由事件重放重建，不依赖 checkpoint。
- 指针存在但 `context_checkpoints` 中对应 `checkpointId` 缺失（写到一半崩溃）→ 指针仍有效（窗口正确性不依赖 checkpoint 行），只记录告警。此规则保证「事件未落库 = 窗口不变，下一轮重压」的幂等性。

## 7. Responses Loop 接线（`electron/agent/responses-loop.ts`）

### 7.1 每轮迭代开头

- 删除现有 `isHardLimited()` 直接中止分支（250-257 行），替换为：

```ts
const summaryEnabled = options.compactionSummaryEnabled !== false;
// instructions 为本轮 buildInstructions 的产物；tools 为 convertToResponseTool 后的数组
const instructions = buildInstructions(...);
const extraTokens = estimateRequestTokens({ instructions, tools });
const budget = await contextHub.ensureContextBudget({
  extraTokens,
  summarize: summaryEnabled ? (t) => summarizeWithModel(model, SUMMARY_PROMPT, t, signal) : undefined,
  signal,
});
if (budget.compacted) {
  yield {
    type: 'summary',
    tokensBefore: budget.tokensBefore,
    tokensAfter: budget.tokensAfter,
    compressedCount: budget.compressedCount,
    summary: budget.summary,
  };
  instructions = buildInstructions(...);   // 重建，带上新增的压缩摘要
}
if (budget.hardLimited) {
  yield { type: 'error', error: '上下文压缩后仍超出硬阈值，请新开会话或降低单次任务规模' };
  return;
}
```

- 压缩在迭代边界执行（工具执行已在上一轮全部完成），不会切割进行中的事务。
- `extraTokens` 用压缩前的 instructions 估算；摘要 ≤ 800 字，下一轮迭代会计入，偏差可忽略。
- `summarizeWithModel` 复用 `electron/llm/client-factory.ts:21`。

### 7.2 buildInstructions

- 在 `buildInstructions`（660-696 行）加入「早期对话摘要（已压缩）」段：`contextHub.getCompactionSummary()` 非空时注入；摘要只作背景，不重复 objective/plan（这些已有独立段落）。
- instructions 因动态段存在不做前缀缓存优化，属子项目 B 范畴。

### 7.3 usage 上报与校准

- 收到 provider usage 后调用 `contextHub.recordReportedInputTokens(response.usage.input_tokens)`；`usage` 流事件字段保持不变。
- 每轮 `context_usage` 事件使用 hub 的最新估算（不再混用 provider 累计值；UI 的 `totals` 语义保持现状）。

### 7.4 工具结果截断

- 工具执行完成后、写入 hub 前：`capToolOutput(name, result)`（4.2），UI 的 `tool_result` 事件仍发完整结果。

### 7.5 子代理

- 子代理 hub（`persist: false`，`main.ts:1887-1893`）同样在每轮迭代调用 `ensureContextBudget`；因不持久化，指针仅内存有效，事件照常通过 `commitEvent` 应用到内存（`insertContextEvent` 已由 `shouldPersist` 短路），恢复不适用。
- 子代理保留窗口目标与主会话一致；摘要默认关闭（子代理任务短、避免额外调用），由调用方传 `summaryEnabled: false`。

## 8. UI

- **聊天流分隔条**：`summary` 事件渲染器已存在（`MainView.tsx:688-697`、`ChatStream.tsx:118-120`），只需主进程发出即可显示「已压缩 N 条上下文（before → after tokens）」。
- **手动压缩**：新增 IPC `context:compact(sessionId)`；`WorkspacePanel` 现有「创建检查点」旁增加「立即压缩」按钮（`WorkspacePanel.tsx:427-456`）。IPC 行为：
  - 会话有运行中的流（`chatStreams`）→ 返回 `{ ok: false, busy: true }`，按钮提示「任务运行中，将在下一轮自动压缩」。
  - 空闲 → 打开持久化 hub，`ensureContextBudget({ force: true })`，返回快照；UI 刷新 `contextStateView`。
- **上下文指示器**：`context_usage` 采用准确估算 + 校准；`WorkspacePanel.tsx:335-341` 的百分比逻辑不变（数据源更准）。`lastCompactedAt` 继续展示。
- **设置开关**：`config-v2.ts` 增加 `contextCompaction?: { summaryEnabled?: boolean }`（默认 `true`）；设置 → 通用面板加开关「压缩时生成对话摘要（会调用一次模型）」。`main.ts` 读取后传入 loop options（`ResponsesLoopOptions.compactionSummaryEnabled`）。

## 9. 测试

### 9.1 单元测试

- `token-estimator.test.ts`：中英文估算（中文不再 4 字符/token 低估）、tiktoken 加载失败回退、items/instructions/tools 合计、校准系数作用。
- `compactor.test.ts`：
  - 事务分组：多组 function_call + 乱序 output 不乱切；缺 output 的 call 必保留；reasoning 与相邻组绑定。
  - 切点：保留目标累计、至少 1 组、`windowStartIndex`/`droppedCount` 正确。
  - 大输出 stub：`read_file`/`run_command`/通用三种形态；`capToolOutput` 阈值边界。
  - 去重：同内容长输出替换为 `sameAs`。
  - 迭代收缩：仍超硬时降目标重切，3 轮后 `ok: false`。
  - 摘要：成功注入、异常/空串/超时返回 undefined 且 `ok: true`。
- `context-hub.test.ts`（扩展）：
  - `ensureContextBudget`：低于软阈值不压；≥软压；`force` 压低阈值；checkpoint 失败不损坏窗口；compaction 事件载荷落库。
  - 指针重放：两次压缩累计 `windowStartIndex`；构造时 slice；digest 不匹配/越界时忽略指针；半写（无 checkpoint 行）不影响。
  - 幂等：事件未提交（模拟 dispose/崩溃）后重开，窗口为压缩前状态且可再次压缩。
  - `recordReportedInputTokens` EWMA 与 clamp。
- `responses-loop.test.ts`（扩展）：
  - 软阈值触发压缩后再发请求，且发出 `summary` 流事件。
  - 压缩失败但未超硬 → 继续；超硬 → 明确 error 事件并终止。
  - 工具结果超限进入 hub 前被 stub（mock 工具返回大结果）。
  - `buildInstructions` 注入压缩摘要。

### 9.2 集成测试

- 模拟 300 轮长会话（mock 客户端按输入增长返回）：全程保持在硬阈值以下、请求输入 items 数量有界、压缩事件次数 > 0。
- 崩溃模拟：压缩后不提交事件直接构造新 hub → 全量窗口可继续工作并在下一轮边界重新压缩。
- 回归：`npm test`、`npm run typecheck` 全绿。

## 10. 文件触达清单

- 新增：`electron/context/token-estimator.ts`（+test）、`electron/context/compactor.ts`（+test）。
- 修改：`electron/context/context-hub.ts`（+test）、`electron/agent/responses-loop.ts`（+test）、`electron/main.ts`（`context:compact` IPC、配置透传）、`shared/ipc.ts`（IPC 契约、`ContextUsage` 字段、loop option 类型）、`electron/preload.ts`、`electron/config/config-v2.ts`、`src/components/WorkspacePanel.tsx`、`src/components/settings/*`（开关）、`src/dev-preview.ts`（新 IPC 的预览桩，如需要）。
- 删除：`electron/agent/compress.ts` 及其测试（被 compactor + estimator 取代，无生产引用）。
- 无新增依赖（tiktoken 已在依赖中）。

## 11. 非目标

- Anthropic 通道的压缩接入（子项目 C）。
- provider 端 `/responses/compact` 压缩。
- 任务自动续跑 / 运行中断点恢复（只恢复上下文，不恢复执行）。
- 事件重放总量优化、旧 item 的物理清理/保留策略、向量检索。
- Prompt 前缀缓存优化（子项目 B/future）。
- 两个 loop 的架构统一（子项目 D）；本子项目不改 Anthropic 行为。

## 12. 验收标准

- [ ] 长会话达到软阈值时在迭代边界自动压缩，任务继续；不再出现「请压缩后再继续」死局。
- [ ] 压缩不拆分任何 function_call / function_call_output 事务（单测覆盖多种交错形态）。
- [ ] `context_compacted` 与 `summary` 端到端到达渲染层，聊天流显示分隔条，上下文百分比使用准确估算。
- [ ] 重启/重开会话后活跃窗口按指针恢复，已压缩 items 不进入请求；指针损坏时安全回退（忽略并重新压缩）。
- [ ] LLM 摘要失败不影响确定性压缩成功；确定性压缩后仍超硬阈值才中止，且错误信息可行动。
- [ ] 单条工具输出超过 16K tokens 时以 stub 进入上下文，UI 仍可见完整结果。
- [ ] 空闲会话可手动「立即压缩」；运行中的会话拒绝手动压缩并提示自动压缩。
- [ ] `npm test`、`npm run typecheck` 全绿。

