# Stellara Work · 项目长期记忆

> 跨会话复用的项目约定与关键事实。日常进展记在同目录 `YYYY-MM-DD.md`。

## 项目性质

Electron + React 19 本地优先（local-first）桌面 AI 代理。核心承诺：**数据不上云**。
- 主进程：`electron/`（tsc → CommonJS）
- 渲染层：`src/`（Vite + React 19）
- 共享契约：`shared/ipc.ts`（主 ↔ 渲染的唯一类型真相源）

## 架构铁律

1. **渲染层不能直连外网**：`index.html` CSP = `connect-src 'self'`。所有外部网络请求必须在主进程发出。
2. **渲染层不能碰 fs / shell / 密钥**：一切经白名单 IPC（`contextBridge` + `contextIsolation`）。
3. **API key 永不出主进程**：`electron/config/secrets.ts` 管理，`getKey` 只读同步、`listKeys` 仅在主进程内部用。
4. 涉密存储统一走 `secrets.ts` 的 cipher（Electron `safeStorage`；测试注入 fake cipher）。
   - 模型密钥命名空间：`STELLARA_KEY_<modelId>`
   - 通用密钥位：`STELLARA_CLOUD_<name>`（`get/set/deleteCloudSecret`）
   - 配置在应用数据目录 `.env`（0600，不进 git）

## 加接口时的连锁影响面（必查 4 处）

给 `ElectronAPI` 加命名空间/方法时，以下都要同步，否则 typecheck 挂：

1. `shared/ipc.ts` — 类型定义
2. `electron/preload.ts` — 真实暴露
3. `electron/main.ts` — IPC handler 注册
4. **`src/dev-preview.ts`** — `?ui-preview` 浏览器预览桩（最容易漏）

## 开发与验证

```bash
npm run typecheck    # tsconfig.json（渲染层）+ electron/tsconfig.json 两侧
npm run dev          # Vite + Electron 一起起
npm run dev:renderer # 只起 Vite
npm run test         # ⚠️ 见下方"测试陷阱"
```

### ⚠️ 测试陷阱：`.worktrees/` 污染

`vitest.config.ts` 的 `include: ['**/*.test.ts(x)']` **没有排除 `.worktrees/`**，
所以 `npm run test` 会连带跑其它分支 worktree 的测试，产生大量假失败
（常见 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` —— WorkBuddy 沙箱的批量删除守卫）。

**规避**：限定范围跑
```bash
npx vitest run src electron shared scripts
```
根治（未做）：`vitest.config.ts` 加 `exclude: ['**/node_modules/**', '**/.worktrees/**']`

### 浏览器预览模式（不用开 Electron 就能验 UI）

`http://localhost:5173/?ui-preview` → `src/main.tsx` 检测到该参数且无 `electronAPI` 时，
调用 `src/dev-preview.ts` 装一整套 API 桩。改 UI 时迭代极快。

## ⚠️ 依赖安装的 peer 冲突（既存问题）

```
devDependencies.typescript = ^7.0.2（实际 7.0.2）
@typescript-eslint/eslint-plugin@8.65.0 要求 peer typescript ">=4.8.4 <6.1.0"
```

任何 `npm install` 都会 `ERESOLVE` 失败。**临时绕过**：`npm install <pkg> --legacy-peer-deps`。
**根治**（未做）：typescript 降到 `~5.9`，或升级 typescript-eslint 到支持 TS 7。

## 设计系统

- Token 全在 `src/styles/grounded-tokens.css`（`--color-*` / `--space-*` / `--fs-*` / `--radius-*` / `--motion-*` / `--ease-*`）
- 新组件样式**禁止写裸值**，一律引用 token
- 复用既有类：`settings-panel-root` / `settings-section__title` / `settings-group` / `settings-item` /
  `btn btn-primary|btn-secondary` / `error-banner` / `account-input` 等（见 `workbench.css`）
- 新增样式单独建 CSS 文件，在 `src/main.tsx` 引入（不改 `workbench.css`）
- 可用图标见 `src/components/Icon.tsx` 的 `IconName` 联合类型（用前先确认是否存在）

## 账号体系（2026-09-10 实施）

- **Phase 1 本地身份**：`local_users` + `active_local_user` 表；`localAuth`；侧边栏 `AccountBadge`；设置「账号」页
- **Phase 3 云账号**：腾讯云 CloudBase
  - **EnvId `stellara-prod-d0g594tmi6e977e10`**（别名 `stellara-prod`，地域 `ap-shanghai`，体验版）
    - ⚠️ 注意：`d0gd9f8497a1106c` 是早期从控制台 URL 误读的**错误值**，已在 2026-09-10 修正
    - 权威来源：`npx -p @cloudbase/cli tcb env list`，或 publishable key 的 JWT `project_id`
  - 主进程用 `@cloudbase/js-sdk` v3.9.3 的**官方 Node 构建**
  - 注册必须走**邮箱验证码**（CloudBase v2 不允许用户名+密码直接注册）
  - ⚠️ **注册是两阶段的**（2026-09-11 查清）：`auth.signUp({email})` 只发验证码、不校验 username；
    真正的 `authApi.signUp`（带 username）由 SDK 在 `signUp().verifyOtp({token})` 闭包里补发。
    → 任何字段级校验错误都只在「提交验证码」那一步抛出，排查时别被验证码带偏。
    服务端用户名正则 `^$|^[a-z][0-9a-z_-]{5,24}$`：留空放行 / 6-25 位 / 首字符必须小写字母 / 仅 a-z 0-9 _ -
  - ⚠️ **SDK 返回的 user 是 Supabase 形状**（2026-09-11 踩坑）：顶层只有 `id`/`email`/`phone`，
    **没有** `uid`/`username`/`name`/`phoneNumber`；`username`/`name`/`nickName` 都在 `user_metadata` 下。
    统一走 `electron/auth/cloud-user.ts` 的 `toCloudAccount()` 归一化，
    别再直接读 user 字段，也别用 `as never` 强转（会把这类错位藏起来）
  - 会话恢复/注册/登录取账号一律用 `cloud-auth-manager.ts` 的 `resolveAccount()`
    （三层兜底：`data.user` → `data.session.user` → `getUser()`）
  - 只用 **Publishable Key**（`.env` 的 `STELLARA_CLOUDBASE_PUBLISHABLE_KEY`）
  - 发件渠道：**腾讯云内置邮件**（`EmailConfig.On=TRUE`，发件人 `cloudbase_noreply@tencent.com`）
  - 绑定表 `cloud_links`（本地身份 ↔ 云账号 1:1）
  - 数据边界：**只同步账号元数据**，工作区/会话/记忆永不上云
- 文档：`docs/account-phase1-integration.md`、`docs/account-phase3-cloudbase.md`

## 其它

- **CloudBase MCP 已配置**：`~/.workbuddy/mcp.json` 里的 `cloudbase` server（`npx -y @cloudbase/cloudbase-mcp@latest`）。
  重启 WorkBuddy 后生效（需在连接器管理页点「信任」）。凭证与 `tcb` CLI 共享。
  **本会话内的绕过方式**见 `2026-09-10.md`（mcporter 内联 stdio + tcb 设备码登录）。
- 应用数据目录：`electron/config/data-dir.ts`（macOS `~/Library/Application Support/stellara-work/`）
- 数据库表初始化用**独立幂等函数**模式（`initContextTables` / `initLocalUsers` / `initCloudLinks`），
  不侵入 `db.ts` 的主 schema；建表函数自带 `getDb()`
- 工具执行/审批/上下文等设计意图见 `docs/` 下 33 篇文档
