# S5 设计：定时任务写操作（预声明策略）

- 日期：2026-09-20
- 状态：待评审
- 前置：S2/S1/S4/S3 已并入 main（`23d4f52`）
- 关联：改进计划 S5（评审 P1-6：定时任务写操作缺口）

## 1. 背景与问题

定时任务目前是"要么全禁、要么全放"之间的空白：

- 本地调度运行刻意不传 `onApproval`（`scheduler/runner.ts` 的 `LocalLoopRequest` 注释），危险工具按失败关闭一律拒绝；
- UI 上的 `allowDangerous` 复选框只是风险确认，运行时无任何效果（README 已承认）；
- 结果：读类自动化可用，写类自动化（自动修复并提交等）完全不可用。

已有的可复用设施：

- 子代理护栏 `createSubagentToolGuard({ readOnly, cwd, fileScopes })`（`electron/agent/subagent-guard.ts`）；
- shell 命令白名单与保守解析（`electron/agent/tools/shell.ts` 的 `parseCommand`）；
- loop 的 `onApproval` / `toolGuard` 接口（S1 起由共享管道与两条 loop 统一消费）。

## 2. 目标与非目标

目标（验收标准）：

1. 定时任务可以**逐任务声明**写操作策略：允许的工具、可写文件范围、命令白名单。
2. 运行时有强制力：策略内自动放行，策略外一律拒绝（fail-closed），不依赖模型自觉。
3. 未配置策略的任务行为与今天完全一致（只读自动化零迁移）。
4. 保存时校验策略合法性（提前失败，而不是运行到一半才发现配置错误）。
5. 全量测试绿 + 独立审查通过。

非目标：

- 审计落库（策略拒绝体现在会话消息与运行状态中即可）。
- MCP / 浏览器 / 子代理工具的调度放行（保持默认拒绝）。
- server runtime 任务的策略控制（远端服务器自行治理，UI 注明）。
- 会话级"记住允许"（S4 已排除）。

## 3. 设计

### 3.1 数据模型

```ts
export interface ScheduledTaskPolicy {
  /** 允许的危险工具（仅这三个可选） */
  allowedTools: Array<'write_file' | 'edit_file' | 'run_command'>;
  /** 可写文件范围（glob/目录）：write/edit 的目标路径与 run_command 的 cwd 必须落于其中 */
  fileScopes: string[];
  /** 命令白名单（token 边界前缀匹配） */
  allowedCommands: string[];
}
```

- `ScheduledTask` 增加 `policy?: ScheduledTaskPolicy`。
- `ScheduledTaskInput` / `ScheduledTaskPatch`：用 `policy?: ScheduledTaskPolicy` **取代** `allowDangerous`；渲染层与类型层移除 `allowDangerous`（DB 列 `allow_dangerous` 保留但不再读写）。
- DB：`scheduled_tasks` 增加 `policy TEXT`（JSON），沿用既有 `ALTER TABLE ... ADD COLUMN` 迁移模式；`createScheduledTask` / `updateScheduledTask` / 行映射同步读写 `policy`。

### 3.2 保存时校验

新模块 `electron/scheduler/policy.ts`，导出：

```ts
export function validateTaskPolicy(policy: ScheduledTaskPolicy | undefined): string | null;
```

规则：

1. `allowedTools` 仅允许 `write_file | edit_file | run_command`；重复项去重后判定。
2. 选中 `write_file`/`edit_file` → `fileScopes` 必须非空且每项为合法相对 glob/目录（拒绝绝对路径与 `..`）。
3. 选中 `run_command` → `allowedCommands` 必须非空；保存时先按行 trim、丢弃空行，再对每条非空项调用 shell 侧校验（见 3.3）。
4. `policy` 为空对象或未配置等同于只读。

调用点：`scheduled:create` / `scheduled:update` 的 IPC 处理器（main.ts）在写库前校验，返回中文错误；渲染层用同一规则做**结构性子集校验**（非空/重复/工具名，不依赖 electron 侧解析器）用于即时提示。

### 3.3 命令白名单语义

- 新增 `export function tokenizeCommand(command: string): string[] | null`（从 shell.ts 现有私有 `tokenize` 抽出并导出；多行/空返回 null）。
- 新增 `export function validateAllowedCommandEntry(entry: string): string | null`（供**主进程**策略校验使用；渲染层只做结构性子集校验，不依赖 electron 侧解析器）：
  - 单行、可解析、首 token 必须是 shell 白名单内的命令（复用 `parseCommand` + 现有限制：无 `| & ; < > \` $ ( )`、无 `..` 逃逸意图由后续 guard 负责）；
  - 拒绝空项。
- 运行时匹配 `matchesCommandAllowlist(command: string, allowlist: readonly string[]): boolean`：
  - 两侧 token 化（大小写敏感，命令与白名单均按原样）；
  - 命令 token 序列以某白名单项 token 序列**逐 token 前缀**匹配即为命中；
  - 例：白名单 `npm test` 命中 `npm test`、`npm test -- --runInBand`；不命中 `npm testing`、`echo npm test`。

### 3.4 运行时执行（fail-closed）

`LocalLoopRequest`（`scheduler/runner.ts`）增加 `policy?: ScheduledTaskPolicy`；`runLocalBody` 把 `task.policy` 传下去。

`main.ts` 的 `runLocalLoop` 依据 policy 组装三件套：

1. **工具子集过滤**：loop 新增选项 `allowedToolNames?: ReadonlySet<string>`（两条 loop 同步支持）。构建工具列表时：只读工具全保留；危险工具只有当名字在集合内才注入；`task_complete` 永远保留。未提供该选项时行为不变。
2. **自动审批器**：
   ```ts
   const approvedTools = new Set(policy?.allowedTools ?? []);
   const onApproval = async (toolCall: ToolCall) => approvedTools.has(toolCall.function.name);
   ```
   策略外（含 MCP、浏览器等）一律 false。
3. **护栏**：
   - 复用 `createSubagentToolGuard({ readOnly: false, cwd, fileScopes: policy?.fileScopes ?? [] })`；
   - 在其上叠加命令白名单：`run_command` 的 `command` 必须 `matchesCommandAllowlist`；
   - 未配置 policy 时：`allowedToolNames` = 只读集（危险工具不注入），`onApproval` 恒 false——与今天等价。

### 3.5 UI

`src/components/ScheduledTasks.tsx`：

- 删除"允许危险工具"开关与 `toggleDangerous`；新增「允许的写操作」区块：
  - 三个复选：写入文件（write_file）、编辑文件（edit_file）、运行命令（run_command）；
  - 「可写范围」多行输入（仅当选了 write/edit 时显示且必填）；
  - 「命令白名单」多行输入（仅当选了 run_command 时显示且必填，每行一条）；
  - 保存时的结构校验提示与主进程错误回显（复用现有 `feedback` 机制）。
- 任务列表/详情显示策略摘要：`写操作：edit_file、run_command · 范围 src/** · 命令 2 条`；未配置显示「只读」。
- 首次保存含写操作的任务时保留一次风险确认（现有确认文案改造）。
- server runtime 时该区块隐藏并提示"由远端服务器治理"。

### 3.6 兼容与迁移

- 既有任务：`policy` 为空 → 运行时与今天完全一致。
- `allowDangerous`：类型与 UI 移除；DB 列保留不动（避免破坏性迁移）。
- 调度运行记录、通知、错过补偿等既有机制不变。

## 4. 测试策略

- `policy.test.ts`：`validateTaskPolicy` 规则表（工具-范围-命令的必填联动、非法项、空策略合法、去重）；`matchesCommandAllowlist` 表格（前缀边界、`npm testing` 不命中、空列表、`task_complete` 无关）。
- shell 侧：`tokenizeCommand` 导出的行为不变测试；`validateAllowedCommandEntry` 对非白名单命令/特殊字符/多行的拒绝。
- loop 侧：两条 loop 的 `allowedToolNames` 过滤（只读保留、危险过滤、task_complete 保留、未提供时不变）。
- runner：`runLocalBody` 透传 policy；策略矩阵（允许工具通过、范围外路径被 guard 拒绝、白名单外命令被拒、无 policy 全拒）——通过既有的 `LocalLoopRunner` 注入 fake 断言选项内容。
- UI：编辑器校验与摘要、旧任务（无 policy）展示为只读、server runtime 隐藏区块。
- 门禁：`npm test` / `npm run typecheck` / `npm run build` 全绿；分支开发，独立审查，验收后合 main。
- 现有引用 `allowDangerous` 的测试（`ipc.scheduled.test.ts`、ScheduledTasks 组件测试等）随类型移除同步更新。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 策略过宽（命令前缀放行危险参数） | 前缀按 token 边界；命令仍受 shell 白名单与禁 shell 特性约束；首次保存有风险确认；README 文档化建议最小授权 |
| guard 与审批顺序造成漏放 | 运行时三件套同时生效（过滤 + 护栏 + 审批），任一层拒绝即失败关闭；策略矩阵测试覆盖 |
| 现有任务受影响 | 无 policy 等价现状；迁移只加列，不改旧列 |
| UI 校验与主进程校验漂移 | 主进程校验为唯一权威；渲染层只做结构性子集校验 |

## 6. 交付物

- 本设计文档（提交到 `docs/superpowers/specs/`）。
- 实施计划（writing-plans 产出）。
- 代码 + 测试（policy 模块、loop 选项、runner 透传、main 接线、UI）。
- README 更新（调度写操作的使用说明与最小授权建议）。
