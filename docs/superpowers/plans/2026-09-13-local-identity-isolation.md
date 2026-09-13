# 本地身份数据隔离（H10）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `projects` / `sessions` / `memories` 按本地身份隔离，支持默认档与多用户切换，运行中切换需确认。

**Architecture:** db 层统一接受 `userId` 并强制过滤；IPC 层从活动身份注入（不信任渲染层）；`identity:switch` 负责 busy 检测、云会话一致性守卫与广播；渲染层监听 `identity-changed` 清空并重载。

**Tech Stack:** Electron 主进程 + better-sqlite3 + React 19 + Vitest（node/jsdom）。

**Spec:** `docs/superpowers/specs/2026-09-13-local-identity-isolation-design.md`

## Global Constraints

- 不做跨身份共享/导出；配置与浏览器分区不隔离；不强制登录。
- `user_id` 一律由主进程注入；任何 IPC 不接受渲染层传入的 userId。
- 默认档 id 固定为 `'default'`，不写入 `local_users`，不可删除/重命名。
- 迁移幂等（`PRAGMA table_info` 模式），回填规则：有本地用户且存在活动用户 → 归活动用户；否则归 `default`。
- 类型严格（`noUnusedLocals`）、无新依赖、全量 `npm test` 每任务保持绿色。
- 服务器会话合并逻辑不改（过滤发生在 db 层）。

---

### Task 1: db 层 user_id 迁移与过滤

**Files:**
- Modify: `electron/store/db.ts`
- Test: `electron/store/db-identity.test.ts`（新增）

**Interfaces:**
- Consumes: 现有 `_setDbPath`/`initDb` 测试模式。
- Produces:
  - 三表新增 `user_id TEXT NOT NULL DEFAULT 'default'` + `idx_*_user` 索引
  - `migrateIdentityOwnership(defaultUserId: string): number`（回填条数）
  - 所有列表/查询函数增加 `userId` 参数：`listProjects(userId)`、`listSessions(userId)`、`searchSessions(query, userId)`、`listMemories(userId, options?)`、`searchMemories(userId, query, options?)` 等
  - 现有按 id 查询保留，但新增 `assertOwnedBy` 辅助：`getOwnedSession(id, userId)` 不匹配返回 `undefined`

- [ ] **Step 1: Write the failing test**

```ts
// electron/store/db-identity.test.ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { _setDbPath, initDb, createSession, createProject, listSessions, listProjects, migrateIdentityOwnership, getOwnedSession } from './db';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-id-')); _setDbPath(path.join(dir, 't.db')); initDb(); });
afterEach(async () => { _setDbPath(null); await fs.rm(dir, { recursive: true, force: true }); });

describe('identity ownership', () => {
  it('defaults new rows to default and filters by user', () => {
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1 });
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    createSession({ id: 's2', title: 'y', modelId: 'm', userId: 'u2' });
    expect(listProjects('default').map((p) => p.id)).toEqual(['p1']);
    expect(listSessions('u1').map((s) => s.id)).toEqual(['s1']);
    expect(listSessions('u2').map((s) => s.id)).toEqual(['s2']);
    expect(listSessions('u3')).toEqual([]);
  });

  it('rejects cross-user id access', () => {
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    expect(getOwnedSession('s1', 'u1')).toBeTruthy();
    expect(getOwnedSession('s1', 'u2')).toBeUndefined();
  });

  it('backfills legacy rows to the given user, idempotently', () => {
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1 }); // default 档
    const n = migrateIdentityOwnership('u1');
    expect(n).toBeGreaterThan(0);
    expect(listProjects('default')).toEqual([]);
    expect(listProjects('u1').map((p) => p.id)).toEqual(['p1']);
    expect(migrateIdentityOwnership('u1')).toBe(0); // 幂等
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run electron/store/db-identity.test.ts` → FAIL（参数/函数不存在）。

- [ ] **Step 3: Implement migration + signatures**

迁移（沿用 PRAGMA 模式）：

```ts
const identityTables = ['projects', 'sessions', 'memories'] as const;
for (const table of identityTables) {
  const cols = _db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'user_id')) {
    _db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  }
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table}(user_id, updated_at DESC)`);
}
```

`migrateIdentityOwnership(userId)`：`user_id = 'default'` 的行更新为目标 id（用 `UPDATE ... WHERE user_id = 'default'`，返回 `changes` 总和；目标为 `'default'` 时直接返回 0）。`getOwnedSession(id, userId)` = `getSession(id)` 且 `row.userId === userId` 才返回。`Session`/`Project` 记录类型增加 `userId: string`。

- [ ] **Step 4: Run test + full store suite + typecheck** — `npx vitest run electron/store && npm run typecheck` → PASS。
- [ ] **Step 5: Commit** — `feat(identity): 三表 user_id 迁移与按身份过滤`

---

### Task 2: 活动身份与默认档

**Files:**
- Modify: `electron/auth/local-auth-manager.ts`
- Modify: `electron/main.ts`（用户列表 IPC 附带默认档）
- Test: `electron/auth/local-auth-manager.test.ts`（新增/补充）

**Interfaces:**
- Produces:
  - `getActiveUserId(db: ...): string`（未登录 → `'default'`）
  - `DEFAULT_USER_ID = 'default'`；`listIdentities()` 返回 `[{ id: 'default', name: '本地默认' }, ...users]`
  - `setActiveUserId(id: string): void`（仅接受 `'default'` 或已存在用户）

- [ ] **Step 1: Failing test**

```ts
it('returns the default identity when no local user is active', () => {
  expect(getActiveUserId()).toBe('default');
});
it('lists the default profile first and rejects unknown switches', () => {
  expect(listIdentities()[0]).toMatchObject({ id: 'default', name: '本地默认' });
  expect(() => setActiveUserId('nope')).toThrow(/不存在/);
});
```

- [ ] **Step 2: Run → FAIL。**
- [ ] **Step 3: Implement**（沿用现有 local-auth-manager 状态；`setActiveUserId('default')` 清空活动用户）。
- [ ] **Step 4: `npx vitest run electron/auth && npm run typecheck` → PASS。**
- [ ] **Step 5: Commit** — `feat(identity): 活动身份与默认档`

---

### Task 3: IPC 身份注入与跨身份访问校验

**Files:**
- Modify: `electron/main.ts`（projects/sessions/memory handlers）
- Test: `electron/store/db-identity.test.ts` 补充 + `shared/ipc.identity.test.ts`（契约）

**Interfaces:**
- Consumes: T1 的 `userId` 参数、T2 的 `getActiveUserId`。
- Produces: 所有相关 IPC 使用 `getActiveUserId()`；按 id 操作（`sessions:get/delete/rename/move/saveMessages/appendMessage`、`memory:*`、`projects:*`）先校验归属，失败抛 `无权限访问该数据`。

- [ ] **Step 1: Failing tests**

db 侧：跨身份 `deleteSession(id)` 经 IPC 校验不可越权（用提取出的纯函数 `assertSessionOwned(id, userId)` 测试）；契约侧：`shared/ipc.ts` 无任何 userId 入参。

```ts
it('authorization helper rejects foreign sessions', () => {
  createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
  expect(() => assertSessionOwned('s1', 'u2')).toThrow(/无权限/);
  expect(() => assertSessionOwned('s1', 'u1')).not.toThrow();
});
```

- [ ] **Step 2: Run → FAIL。**
- [ ] **Step 3: Implement**：在 db.ts 导出 `assertSessionOwned/assertProjectOwned/assertMemoryOwned`；main.ts handlers 调用并传 userId（列表/搜索/保存 message 均带 userId）。
- [ ] **Step 4: 聚焦测试 + typecheck → PASS；跑 `npm test` 确认现有会话/记忆测试按默认档路径更新（测试夹具补 `userId: 'default'`）。**
- [ ] **Step 5: Commit** — `feat(identity): IPC 身份注入与跨身份访问校验`

---

### Task 4: identity:switch（busy/force/云守卫/广播）

**Files:**
- Modify: `shared/ipc.ts`、`electron/preload.ts`、`electron/main.ts`、`src/dev-preview.ts`
- Test: `electron/identity-switch.test.ts`（新增，提取可测的 `switchIdentity` 函数）

**Interfaces:**
- Produces:
  - IPC `identity:switch(userId: string, force?: boolean): Promise<{ ok: true } | { ok: false; busy: true; count: number }>`
  - `identity:list()` → 身份列表（含默认档）
  - 广播 `identity-changed`（payload: `{ userId }`）
  - 切换成功后执行云会话一致性守卫（复用现有 H10 逻辑），再广播

- [ ] **Step 1: Failing test**

```ts
it('refuses switching while streams are active unless forced', async () => {
  const deps = { activeStreamCount: () => 2, setActive: vi.fn(), guardCloud: vi.fn(), broadcast: vi.fn() };
  await expect(switchIdentity(deps, 'u1', false)).resolves.toEqual({ ok: false, busy: true, count: 2 });
  expect(deps.setActive).not.toHaveBeenCalled();
  await expect(switchIdentity(deps, 'u1', true)).resolves.toEqual({ ok: true });
  expect(deps.setActive).toHaveBeenCalledWith('u1');
  expect(deps.guardCloud).toHaveBeenCalled();
  expect(deps.broadcast).toHaveBeenCalledWith('u1');
});
it('rejects unknown identities', async () => {
  const deps = { activeStreamCount: () => 0, setActive: () => { throw new Error('用户不存在'); }, guardCloud: vi.fn(), broadcast: vi.fn() };
  await expect(switchIdentity(deps, 'nope', true)).rejects.toThrow(/不存在/);
});
```

- [ ] **Step 2: Run → FAIL。**
- [ ] **Step 3: Implement + wire IPC**（main.ts 从 `chatStreams` 活动集合取 count；preload/dev-preview 同步）。
- [ ] **Step 4: 聚焦测试 + typecheck + 全量 `npm test` → PASS。**
- [ ] **Step 5: Commit** — `feat(identity): 身份切换 IPC（busy/force/云守卫/广播）`

---

### Task 5: 渲染层切换与重载

**Files:**
- Modify: `src/App.tsx`、`src/components/settings/SettingsAccountPanel.tsx`、`src/components/Sidebar.tsx`（可选显示）
- Test: `src/App.test.tsx` / `SettingsAccountPanel.test.tsx`（补充）

**Interfaces:**
- App：`activeUser` state；`window.electronAPI.identity.onChanged(cb)` 订阅；收到后清空 `activeSessionId/sessions/projects` 并重载 `sessions.list()/projects.list()`。
- 账号面板：身份列表单选；切换遇 `busy` 弹确认（「切换将中断 N 个运行中的任务」）后带 `force` 重试。

- [ ] **Step 1: Failing tests**：`identity-changed` 触发后列表重载且活动会话清空；busy 时确认弹窗出现、取消不切换、确认调用 force。
- [ ] **Step 2: Run → FAIL。**
- [ ] **Step 3: Implement。**
- [ ] **Step 4: 聚焦测试 + typecheck + 全量 `npm test` → PASS。**
- [ ] **Step 5: Commit** — `feat(identity): 渲染层身份切换与数据重载`

---

### Task 6: 回归、迁移验收与文档

**Files:**
- Modify: `CHANGELOG.md`（Unreleased 增加身份隔离条目）
- Test: 全量回归 + 手工迁移验收

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build` 全绿。
- [ ] **Step 2:** 手工验收（记录结果）：已有数据启动后归默认档可见；创建本地用户 A/B 后各自只见自己的项目/会话/记忆；运行中切换弹确认；强制切换后列表刷新、运行中流后台结束；删除/重命名他人数据被拒。
- [ ] **Step 3: Commit** — `docs(identity): 身份隔离变更记录与验收`

---

## Self-Review

- **Spec coverage**：三表迁移与回填（T1）、默认档与活动身份（T2）、IPC 身份注入与校验（T3）、切换语义 busy/force/云守卫/广播（T4）、渲染层重载与确认（T5）、回归与验收（T6）——覆盖规格 3/4/5/6 节。
- **Placeholder scan**：无 TBD/TODO；每任务含测试代码或明确的测试断言清单。
- **Type consistency**：`DEFAULT_USER_ID`、`getActiveUserId`、`setActiveUserId`、`migrateIdentityOwnership`、`assertSessionOwned/assertProjectOwned/assertMemoryOwned`、`switchIdentity(deps,...)`、`identity:switch` 返回联合类型在各任务间一致。
- **已知风险**：现有测试夹具需要补 `userId: 'default'`（T3 内处理）；服务器会话表经由 sessions 归属自然隔离。
