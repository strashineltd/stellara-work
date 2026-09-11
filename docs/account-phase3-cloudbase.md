# 账号体系 Phase 3 · 云账号（腾讯云 CloudBase） · 实施文档

> 代码由 AI 实施完毕。本文档说明**架构决策**、**你需要在控制台做的 3 件事**、以及联调验证步骤。

---

## 一、这一阶段做了什么

在 Phase 1「本地身份」之上，增加**可选的云账号**：

| 能力 | 说明 |
|---|---|
| 邮箱验证码注册 | 填邮箱 + 密码（可选用户名/昵称）→ 收验证码 → 完成注册并自动登录 |
| 邮箱 / 用户名 + 密码登录 | 一个输入框自动判别（含 `@` 视为邮箱） |
| 登出 | 清云会话，**保留绑定关系**，本地数据不受影响 |
| 解绑 | 清云会话 + 删绑定 |
| 会话恢复 | 启动时用加密保存的 refresh_token 静默恢复，失败即降级为未登录 |

入口：**设置 → 账号 → 云账号**。

### 数据边界（重要）

只同步**账号元数据**：`uid / 邮箱 / 用户名 / 昵称 / 手机号`。

**不上云**：工作区、会话、记忆、文件、API Key。local-first 承诺不变。

---

## 二、架构决策（为什么这么做）

### 2.1 为什么 CloudBase 调用放在**主进程**

项目的 `index.html` CSP 是 `connect-src 'self'` —— **渲染进程被完全禁止发起外网请求**。

两个选择：
- 放宽 CSP 让渲染层直连 → 安全倒退，不采用
- 主进程出网，渲染层只经白名单 IPC 调用 → **采用**

附带好处：云会话 token 不必进入渲染进程的 JS 堆或 localStorage。

### 2.2 为什么用 `@cloudbase/js-sdk` 而不是裸 HTTP API

`@cloudbase/js-sdk` v3.x **提供官方 Node 构建**：

```json
"exports": {
  ".": {
    "node": { "import": "./dist/index.node.esm.js", "require": "./dist/index.node.cjs.js" }
  }
}
```

实测在无 `window` / `localStorage` 的纯 Node 环境可正常 `init()`，91 个 auth 方法齐全。

好处：
- 调用签名与**官方文档一致**，不需要猜测 HTTP 端点路径与字段名
- 用户认证（密码哈希 / JWT 签发 / 防暴力破解 / 会话管理）全部由 CloudBase 托管
- 与 `electron` 的 CommonJS 输出天然兼容（Node 走 `.cjs.js` 构建）

### 2.3 凭证边界

| 凭证 | 权限 | 用在哪 |
|---|---|---|
| **Publishable Key** | 匿名用户权限，官方定位「可安全暴露于客户端」 | ✅ 本应用使用 |
| API Key | **管理员权限** | ❌ 绝不使用（服务端专用） |

---

## 三、控制台配置（✅ 已由 AI 通过 CloudBase MCP 自动完成）

环境：`stellara-prod`（EnvId `stellara-prod-d0g594tmi6e977e10`，地域 `ap-shanghai`，体验版）

> **以下 3 项已于 2026-09-10 22:28 通过 CloudBase MCP 自动配置完毕**，
> 保留在此供审阅、复核与重建环境时参考。

### 步骤 1 · 开启「邮箱验证码」登录 ✅

```bash
manageAppAuth action=patchLoginStrategy  patch={"email":true}
```

> 为什么必须走邮箱验证码：CloudBase v2 明确**不允许**直接用「用户名 + 密码」注册
> （防止恶意批量注册无意义用户名）。必须先经邮箱/手机验证码注册，注册过程中再设置用户名与密码，
> 之后才能用「用户名 + 密码」登录。

### 步骤 2 · 配置邮件发件渠道 ✅

⚠️ **只做步骤 1 不够** —— 会返回 `success: true`，但 `loginMethods.email` 仍是 `false`。
必须在 **provider 层**再配一次：

```bash
manageAppAuth action=updateProvider  providerId=email  providerType=EMAIL \
  config={"On":"TRUE","EmailConfig":{"On":"TRUE","SmtpConfig":{}}}
```

当前采用**腾讯云内置邮件通道**，发件人 `cloudbase_noreply@tencent.com`。

| 方案 | 说明 |
|---|---|
| **腾讯云内置邮件**（当前） | 配置最少，送达率稳；按量计费（验证码邮件量极小） |
| 自建 SMTP | 用自己邮箱发信，需填 SMTP 主机 / 端口 / 账号 / 授权码 |

### 步骤 3 · 取得 Publishable Key 并写入 `.env` ✅

Key 由 `manageAppAuth action=ensurePublishableKey` 创建（`created: true`，长期有效），
已写入**应用数据目录**下的 `.env`：

```
STELLARA_CLOUDBASE_PUBLISHABLE_KEY=<Publishable Key>
```

macOS 路径：`~/Library/Application Support/stellara-work/.env`（权限 0600，不进 git）

> ⚠️ 只能填 Publishable Key（官方定位为可安全暴露于客户端）。
> 绝不要填 API Key —— 那是管理员权限的服务端凭证。

**未配置时**：应用完全正常，只是「设置 → 账号 → 云账号」显示「尚未配置云端环境」。

### 连通性已验证 ✅

```
环境: stellara-prod-d0g594tmi6e977e10
Key 已加载: true | 长度 1186
✅ 真实 API 调用成功，耗时 202 ms   (auth.isUsernameRegistered)
```

证实链路：Publishable Key 有效 → SDK Node 构建可用 → 网络可达 → 鉴权通过。

---

## 四、改动清单

### 新增文件（5 个功能文件 + 1 个测试 + 本文档）

| 文件 | 作用 |
|---|---|
| `electron/cloud/cloudbase-client.ts` | CloudBase SDK 单例封装 + Publishable Key 解析 + 错误 → 中文映射 |
| `electron/store/cloud-links.ts` | `cloud_links` 绑定表（本地身份 ↔ 云账号，1:1） |
| `electron/auth/cloud-auth-manager.ts` | 注册 / 登录 / 登出 / 解绑 / 会话恢复 / token 持久化 |
| `src/components/settings/SettingsCloudAccountSection.tsx` | 云账号 UI |
| `src/styles/cloud-account.css` | 上述组件的样式 |
| `electron/store/cloud-links.test.ts` | 绑定表单元测试 |

### 修改现有文件（7 个）

| 文件 | 改动 |
|---|---|
| `shared/ipc.ts` | `CloudAccount` / `CloudAuthState` / `CloudResult` / `CloudFailure` / `CloudPendingSignUp` / `CloudSignUpArgs` + `ElectronAPI.auth.cloud` |
| `electron/config/secrets.ts` | 新增通用密钥位 `getCloudSecret` / `setCloudSecret` / `deleteCloudSecret`（复用同一 safeStorage cipher） |
| `electron/preload.ts` | 暴露 `auth.cloud.*`（7 个方法） |
| `electron/main.ts` | `initCloudLinks()` + 启动时 `restoreSession()` + 7 个 IPC handler |
| `src/components/settings/SettingsAccountPanel.tsx` | 「即将推出」占位替换为真实组件 |
| `src/main.tsx` | 引入 `cloud-account.css` |
| `src/dev-preview.ts` | 补 `auth.cloud` 桩（可交互预览态） |
| `package.json` | 新增依赖 `@cloudbase/js-sdk@^3.9.3` |
| `.env.example` | 补充 CloudBase 配置说明 |

### 关键实现细节

1. **`verifyOtp` 是函数，不能跨 IPC**
   SDK 的 `signUp()` 返回 `data.verifyOtp` 回调。主进程把它暂存在内存 `Map` 里，
   以 `pendingId`（UUID）引用，有效期 9 分钟。渲染层只传 `pendingId` + 验证码。

2. **`app.auth` 是「可调用对象」**
   既能 `app.auth()`（v1 兼容）也能 `app.auth.signUp()`。类型上用 `CloudBaseApp['auth']` 推断。

3. **云 token 存储**
   `access_token` / `refresh_token` 经 `setCloudSecret()` 写入，走与模型 key 相同的
   `safeStorage`（Windows DPAPI / macOS Keychain）加密通道，命名空间 `STELLARA_CLOUD_`。
   与模型密钥的 `STELLARA_KEY_` 分开，`listKeys()` 不会误读。

4. **登出 vs 解绑**
   - 登出：只清 token，保留 `cloud_links` 记录 → UI 显示「已登出」，可重新登录
   - 解绑：清 token + 删记录 → 回到「登录 / 注册」表单

5. **启动会话恢复不阻塞**
   `restoreSession()` 以 `void (async () => ...)()` 触发，涉及网络，失败静默降级为未登录。

---

## 五、验证

```bash
cd "/Users/lhy/Stellara Work"

# 1. 类型检查（渲染层 + 主进程）
npm run typecheck

# 2. 全量测试
npm run test

# 3. 起应用做手工验收
npm run dev
```

### 手工验收清单

**未配置时（先不填 `.env`）**

1. 设置 → 账号 → 云账号 显示「尚未配置云端环境」，其余功能一切正常

**配置后**

2. 云账号区显示「登录 / 注册」两个 tab
3. 注册：填邮箱 + 密码 +（可选）用户名昵称 → 点「获取验证码」→ 提示已发送
4. 到邮箱取 6 位验证码 → 填入 → 点「完成注册」→ 显示已登录 + 云端 uid
5. 重启应用 → 云账号区仍显示「已登录」（会话恢复生效）
6. 点「登出」→ 显示「已登出」，绑定关系仍在
7. 用同一账号「登录」→ 再次成功
8. 点「解绑」→ 回到登录/注册表单
9. 本地身份与云账号的绑定：换一个本地身份后，云账号区显示未绑定（各自独立）

---

## 六、排错

| 现象 | 原因 / 处理 |
|---|---|
| 「尚未配置云端环境」 | `.env` 里没填 `STELLARA_CLOUDBASE_PUBLISHABLE_KEY`，或填了空值。改完需重启应用 |
| 「验证码已发送」但收不到 | 先在控制台发测试邮件。也检查垃圾邮件箱；QQ 邮箱偶有送达延迟 |
| **验证码被拒 / 「失效」** | **最常见是超时**：验证码 **10 分钟**有效，从收信到输入很容易超。界面现在有 `剩余有效期 mm:ss` 倒计时，归零后按钮直接禁用。其次检查是否输入了上一次的旧码 |
| 「注册会话已失效」 | 主进程侧会话暂存在内存，**发码后重启应用**会丢失。重新点「获取验证码」即可。（切换设置页签不再丢，已用模块级缓存修复） |
| 报 `failed_precondition` | 邮箱已被注册。直接切到「登录」tab |
| 报 `unauthenticated` | 登录态失效，重新登录 |
| 报「网络连接失败」 | 主进程无法出网（代理 / 防火墙）。域名为 `{envId}.ap-shanghai.tcb-api.tencentcloudapi.com` |
| 用户名格式报错 | 规则：5-24 位，字母或数字开头，仅可含 `- _ . : + @`，不支持中文 |
| 报用户名已占用 | 换一个 |

### 6.1 排障方法论（本次实战总结）

**日志位置**：`~/Library/Logs/stellara-work/main.log`（主进程 electron-log）

**关键日志锚点**：

```
云注册验证码已发送: <email>（pendingId=<uuid>）     ← 发码成功
verifySignUp 找不到注册会话: pendingId=...          ← 会话丢失
verifySignUp 校验被拒绝: {...SDK 原始错误...}       ← SDK 拒绝了验证码
cloudAuth 操作失败 <err>                            ← 其他异常
```

**推断技巧**：先确认日志级别确实会记录 warn（翻历史找一条 `[warn]`），
再根据"该记却没记"反推代码走了哪个分支 —— 没有日志本身就是强证据。

**端到端实测手法**（不污染真实邮箱）：
用一次性邮箱服务（如 `api.mail.tm`）建临时收件箱 → 调 `signUp` → 轮询收信提取验证码 → `verifyOtp`，
可在 30 秒内验证「发信通道 + 验证码解析 + 校验」整条链路。

> ⚠️ 探测脚本必须放在**项目 node_modules 所在目录内**（放 `/tmp` 会 `ERR_MODULE_NOT_FOUND`），
> 且末尾要显式 `process.exit(0)`（js-sdk 会保持活跃句柄，否则 node 不退出）。

---

## 七、关于依赖安装的一个既有问题

`npm install` 在本项目会因**既有**的 peer 冲突失败：

```
根项目 devDependencies.typescript = ^7.0.2（实际装的是 7.0.2）
@typescript-eslint/eslint-plugin@8.65.0 要求 peer typescript ">=4.8.4 <6.1.0"
```

这与 Phase 3 无关，任何新装依赖都会触发。本次安装使用了：

```bash
npm install @cloudbase/js-sdk --save --legacy-peer-deps
```

**建议**（后续单独处理，不属本阶段）：把 `typescript` 降到 `~5.9` 或升级
`@typescript-eslint` 到支持 TS 7 的版本，二选一即可消除该冲突。
