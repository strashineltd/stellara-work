# 新会话交接：接下来的开发（2026-09-13）

## 现状（main @ `cff4a63`）

- 已完成并合入 `main`：
  - **界面外壳重构（Plan 1）**：顶栏/侧栏 IA/首页能力卡/设置皮肤/PR 与已安排占位页
  - **服务器内核（Plan 2A）**：opencode 客户端（HTTP/SSE）、事件与消息适配、服务器管理器、会话/聊天桥接、真实服务端（1.18.29）端到端验证
  - **服务器 UI（Plan 2B）**：设置→服务器面板（图 2）、顶栏执行端选择器、服务器会话流式/审批/模型与 Agent、侧栏服务器分组、离线重连
  - **安全修复**：P0（子代理审批失败关闭、workDir/附件授权、MCP 确认与白名单）＋ P1（浏览器权限/请求级 SSRF、IPv6、命令路径、env 清洗、symlink 搜索、git textconv、API Key 绑定、https 凭据、身份-云会话一致性）＋ P2（.env 编码/迁移/权限、日志脱敏、开发导航同源、子框架 IPC、敏感工具、maxBytes、生产菜单）＋ `run_command` 结构白名单化；生产依赖审计已清零（hono/qs 升级）
  - **本地身份数据隔离（H10）**：三表 `user_id`、默认档+多用户、`identity:switch`（busy/force/云守卫/广播）、一次性回填、会话派生 IPC 越权守卫、切换前落盘、默认档云登录主进程拦截
- 测试：主仓库全量通过（注意：主仓库 vitest 会扫描并行 worktree `.worktrees/0.9.3-context-compaction` 的测试副本，计数约×2，属正常现象）；typecheck/build 通过
- 并行工作：用户另一会话正在做「上下文压缩与 checkpoint 恢复（子项目 A）」（`feat/0.9.3-context-compaction` 分支 + spec/plan 已在 main），不属于本线

## 下一步（本线唯一剩余大项）：Plan 3

**计划文件**：`docs/superpowers/plans/2026-09-13-v0.9.3-scheduler-tray.md`（7 个任务）
**规格**：`docs/superpowers/specs/2026-09-10-v0.9.3-redesign-server-scheduler-design.md` §5/§6.3

任务概览：
1. `croner` 依赖 + `scheduled_tasks`/`scheduled_runs`（带 `user_id`）+ 仓储
2. 调度引擎（croner、单计时器最小堆、once/interval/cron、错过补偿「评估一次」）
3. 执行绑定（本地无 UI 会话 / 服务器任务 / 通知；危险工具沿用失败关闭）
4. IPC `scheduled:*` + 身份注入
5. 托盘驻留（关闭隐藏、菜单、`app.backgroundScheduling` 开关、Cmd+Q 退出）
6. 渲染层「已安排」页面（列表/对话框/历史）
7. 发布收尾（CHANGELOG/README/手工验收）

**执行方式**：新会话说「继续 Plan 3」；按 subagent-driven-development 流程：新建 worktree（`.worktrees/0.9.3-scheduler`，分支 `feat/0.9.3-scheduler`）→ 安装依赖 → 基线测试 → SDD 工作区 + ledger（含预检与裁决）→ 逐任务实现 + 独立评审 → 最终整分支评审 → 合并回 `main`。

**必须遵守的既定约束**：
- 安全：调度会话无审批通道 → 危险工具失败关闭（`allowDangerous` 仅 UI 风险确认，不改变运行时拒绝）；任务按身份隔离；服务器断线记 `error` 不静默重排
- 流程裁决先例：R1（db `userId` 可选默认、IPC 显式注入）、R2（一次性「评估」语义）、R3（连续子代理取消后可由控制会话直接实现小修复，测试+复审覆盖）、Ruling N（UI 任务可行为规格化）
- 提交规范：中文 conventional commits；每任务提交前全量测试；凭据不入日志/渲染层

## 其他待办（非阻塞，按需）

- 安全遗留小项：服务器事件按首条映射更新/跨身份删除、遗留 `auth:local:switch` 收敛、AccountBadge busy 提示、`countAllMessages` 跨身份计数、少量测试覆盖缺口
- 发布加固：正式签名 + Hardened Runtime（`package.json` 有 `hardenedRuntime` 配置项）、macOS 公证
- 若要扩展安全结构：`run_command` 子命令白名单已实现；可进一步将网络出口单点化
- H10 已知限制：调度/后台任务受危险工具失败关闭限制（只读自动化可跑，写入类需专门设计）
