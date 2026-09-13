# 本地身份数据隔离（H10）设计规格

> 日期：2026-09-13
> 状态：设计已确认，待写实施计划
> 前置：`main` @ `b348839`（安全修复后基线，1937 passed / 2 skipped）
> 来源：`docs/security-audit/2026-09-13-consolidated.md` H10（本地身份未隔离）

## 1. 背景

账号体系（0.9.3.1）已支持本地多用户与云同步，但项目的 `projects` / `sessions` / `memories` 三表没有身份归属：任何本地用户都能看到彼此的会话与记忆；云会话一致性守卫（H10 修复）只解决了显式账号不一致，未解决数据隔离。本设计为三表引入 `user_id` 归属与切换语义。

## 2. 已确认决策

- **默认档案 + 多用户**：未登录时使用固定的「本地默认」档案（id = `default`）；登录后各用户独立数据；切回默认档仍可见原数据。
- **隔离粒度**：仅 `projects` / `sessions` / `memories` 三表按 `user_id` 隔离；附件、上下文库、浏览器分区、工作目录跟随会话归属，不单独迁移。
- **切换语义**：立即切换并重载数据；若有任务执行中，先弹确认「切换将中断当前任务」，确认后 `force` 切换；已启动的流随旧会话在后端结束，不再展示。
- **迁移归属**：启动迁移时，若已有本地用户则现有数据归**当前活动用户**；否则归 `default`。

## 3. 数据模型与迁移（`electron/store/db.ts`）

```sql
ALTER TABLE projects ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE memories ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, updated_at DESC);
```

- 迁移采用现有 `PRAGMA table_info` 幂等模式；`ALTER` 后执行一次回填：
  `UPDATE <table> SET user_id = ? WHERE user_id IS NULL OR user_id = 'default'`（仅当存在本地用户且其 id ≠ `default` 时，绑定当前活动用户 id 执行；否则保持 `default`）。
- 新写入路径一律显式带 `user_id`；旧数据的 `default` 值不再被当作「未归属」。
- 会话行仍保留 `server_id`/`remote_session_id`（服务器会话映射）与 `work_dir`，均随会话归属。

## 4. 主进程接口

- **活动身份**：新增只读访问器（`electron/auth/local-auth-manager.ts` 或等价模块）`getActiveUserId(): string`，未登录返回 `'default'`。
- **db 层**：所有列表/查询写入函数增加 `userId` 参数（`listProjects/listSessions/getSession/getMessages/listMemories/searchMemories/searchSessions` 等）；查询统一追加 `AND user_id = ?`。跨表写入（如 `moveSession`、`deleteProject` 级联）以所属会话/项目的 `user_id` 为准。
- **IPC 注入**：`projects:*` / `sessions:*` / `memory:*` handler 从 `getActiveUserId()` 取身份，**不读取渲染层传入的 userId**；对按 id 访问的请求（`sessions:get/delete/rename`、`memory:update/delete`、`projects:updateFile/rename/delete`）先按 id + 当前身份校验，不匹配返回 `无权限访问该数据`。
- **切换**：新增 `identity:switch(userId: string, force?: boolean)`：
  - 运行中流检测（`chatStreams` 活动集合）：有运行中任务且未 `force` → 返回 `{ ok: false, busy: true, count }`；
  - `force` 或空闲 → 更新活动身份，执行云会话一致性守卫（复用 H10 修复：不匹配则清理云会话），广播 `identity-changed`；
  - 未知 userId → 拒绝。
- **默认档**：`default` 作为虚拟档案不必写入 `local_users`；用户列表 IPC 返回时附带「本地默认」条目（`id: 'default'`，不可删除/重命名）。

## 5. 渲染层

- App 状态新增 `activeUser`（来自身份 IPC + `identity-changed` 广播）；设置 → 账号面板提供切换入口。
- 收到 `identity-changed`：清空 `activeSessionId`/`entries`/`attachments`/工作区/上下文状态，重载 `projects/sessions`（`memory` 页面自身按刷新加载）。
- 切换确认：有运行中任务时先弹确认（复用现有 confirm 模式），确认后带 `force: true` 重试。
- 侧栏与列表自然只显示当前身份数据（主进程已过滤，渲染层不做二次过滤）。

## 6. 测试

- db：迁移加列与回填（有/无本地用户两种）；列表/查询按 user 过滤；跨身份 `get/delete/rename` 拒绝；级联删除不越权。
- 主进程：`identity:switch` 空闲切换、busy 返回、force 切换、未知 id 拒绝、云会话守卫触发。
- 渲染层：`identity-changed` 后状态重置与列表重载；切换确认流程；账号面板入口。
- 回归：现有全量测试保持通过（含服务器会话、安全修复测试）。

## 7. 文件触达清单

- 修改：`electron/store/db.ts`、`electron/store/db.test.ts`、`electron/auth/local-auth-manager.ts`（活动身份）、`electron/main.ts`（IPC 注入与 `identity:switch`、广播）、`electron/preload.ts`、`shared/ipc.ts`（身份与切换契约）、`src/App.tsx`、`src/components/Sidebar.tsx`（可选显示当前身份）、`src/components/settings/SettingsAccountPanel.tsx`（切换入口 + 确认）、`src/dev-preview.ts`。
- 无新增依赖。

## 8. 非目标

- 跨身份共享 / 导出 / 合并；配置（工作目录默认值、MCP、模型）隔离；浏览器 Cookie 分区隔离；强制登录；数据加密升级。
- 不改变服务器会话合并逻辑（按 user 过滤在 db 层完成）。
