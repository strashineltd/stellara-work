# Stellara Work 安全审查（综合版）

> 日期：2026-09-13
> 基准：`main` @ `639b2bb`（v0.9.3）
> 来源：本次三路独立审查（进程/IPC、凭据与云同步、文件与网络工具面）＋ 既有 `2026-09-12.md` 审查记录。仅合并与复核，未修改代码。
> 标注：【本次复核】＝本次直接读代码确认；【既有】＝沿用 09-12 记录（未在本次逐项复跑）。

## P0 — 应立即修复

| 编号 | 问题 | 位置 | 验证 |
|---|---|---|---|
| C1 | **子代理危险工具零审批**：`runOneSubagent` 未传 `onApproval`，两种循环仅在存在回调时等待批准 → 父代理一次 `dispatch_subagents` 批准后，build 子代理可直接写文件/执行命令；`fileScopes` 仅为提示不强制 | `electron/main.ts:1897-1926`、`responses-loop.ts:444`、`anthropic-loop.ts:271` | 【本次复核】+【既有 S01】 |
| C2 | **任意文件读写（渲染层被攻破时）**：`projects:create` 接受任意 `workDir` 不经选择器授权，随即通过 `assertWorkDirAllowed` 种子化白名单；`attachments:add` 直接 stat/复制任意绝对路径（无需对话框来源）→ 可读 `/etc/passwd`、`~/.ssh/id_rsa` | `main.ts:663-688`、`main.ts:614`、`attachments.ts:95-114`、`main.ts:1344-1364` | 【本次复核】+【既有 S05】 |
| C3 | **MCP 双重问题**：① `mcp:add`/`mcp:test` 接受渲染层传入的 stdio `command/args` 并直接 spawn（命令执行）；② 执行入口不检查 `enabled` 与工具白名单，被禁用的受限工具仍可被调用 | `main.ts:1073,1091`、`mcp-client.ts:28`、`mcp-manager.ts:135` | ①【本次复核】②【既有 S08】 |

## P1 — 应在近期修复

| 编号 | 问题 | 位置 | 验证 |
|---|---|---|---|
| H1 | **内置浏览器自动批准系统权限**：全仓库未设置 `setPermissionRequestHandler`/`setPermissionCheckHandler`，Electron 默认自动放行 → 任意被导航页面可获摄像头/麦克风/定位/通知 | `electron/browser/service.ts:361-368`（无处理器） | 【本次复核】+【既有 S10】 |
| H2 | **浏览器 SSRF 无请求级拦截**：导航/重定向校验异步执行、`stop()` 晚于请求发出；`browser_tabs create` 只做同步主机名黑名单（不含 `127.0.0.1`/RFC1918 字面量）；页面内 fetch/img 不受限 | `service.ts:380-420,743-751`、`url-policy.ts:2-10` | 【本次复核】+【既有 S04】 |
| H3 | **`web_fetch` IPv6 映射绕过**：URL 规范化后 `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`，`::ffff:` 分支只识别点分 IPv4，兼容地址 `[::7f00:1]` 亦未覆盖 → 可访问 `[::ffff:169.254.169.254]` 云元数据 | `electron/agent/tools/web-fetch.ts:42-56,100-108` | 【本次复核】+【既有 S03】 |
| H4 | **`run_command` 前缀包含绕过**：`resolved.startsWith(path.normalize(cwd))` 使 `../proj-x` 与 `/proj-x` 前缀匹配，可在工作区外执行；Windows `C:foo` 亦漏 | `electron/agent/tools/shell.ts:152,178,209` | 【本次复核】+【既有 S06】 |
| H5 | **`run_command` 白名单 + 环境泄露**：白名单含 `node/npm/npx/python/curl/make…` 与网络工具；子进程继承含 `STELLARA_KEY_*`/`STELLARA_SERVER_*`/云 token 的 `process.env`，`env`/`node -p process.env` 可读出 | `shell.ts:13-47,346`、`config/env.ts:29-47` | 【本次复核】 |
| H6 | **搜索工具经 symlink 越界读取**：`fast-glob` 默认跟随链接且只做词法前缀检查，`search_content`/`search_symbol` 可读工作区外文件（plan 模式亦可见） | `electron/agent/tools/grep.ts:42-47,88`、`search-symbol.ts:37-42,66` | 【本次复核】+【既有 S02】 |
| H7 | **只读 `git_diff` 可执行 textconv 程序**（外部转换器 → 命令执行） | `electron/agent/tools/git.ts:21` | 【既有 S07】 |
| H8 | **API Key 可被重定向外发**：`models:configure` 省略 `apiKey` 时保留旧 key 但允许改 `baseUrl` → 下一次请求把真实 key 发给攻击者域名 | `main.ts:317`、`model-configure.ts:29-47` | 【本次复核】 |
| H9 | **服务器凭据明文传输**：允许任意 `http://` 主机并发送 Basic 认证；非回环应强制 `https` | `config-v2.ts:174-183`、`opencode-client.ts:66-70` | 【本次复核】 |
| H10 | **本地身份未隔离**：切换本地身份不清理云会话（显示账号与 token 主体不一致）；项目/会话/记忆无身份隔离，多用户共库互见 | `electron/main.ts:1117`、`electron/store/db.ts:33` | 【既有 S09/S11】 |

## P2 — 加固项

| 编号 | 问题 | 位置 |
|---|---|---|
| M1 | `.env` 写入转义缺陷：`\n` 未转义可注入额外行；`\"` 写后有读无解；键名后缀未校验（`^[A-Za-z0-9._-]+$`） | `secrets.ts:84-92,55-59` |
| M2 | `migrateLegacyKeys` 只迁移 `STELLARA_KEY_*`，漏服务器密码/云 token；`resetEnvCache` 同样漏前缀 | `secrets.ts:233-244`、`env.ts:20-27` |
| M3 | Linux `safeStorage` 的 `basic_text` 后端未识别（等同明文） | `main.ts:2061` |
| M4 | `.env` 非原子写、重写不修正权限；SQLite 目录/库/ WAL 默认权限存 PII | `secrets.ts:91`、`db.ts:27-29`、`cloud-links.ts:69-87` |
| M5 | 日志/诊断泄露 PII：登录邮箱/uid 入日志；`settings:collectDiagnostics` 回传 2KB 日志尾 | `cloud-auth-manager.ts:214,276,304,371`、`main.ts:960-966` |
| M6 | 云错误原文透传渲染层（可能含端点/参数） | `cloudbase-client.ts:285-290` |
| M7 | 开发模式导航白名单前缀匹配（`localhost:5173.evil.com` 可入） | `main.ts:2293` |
| M8 | 页面内导航被 `openExternal` 外部化（页面可刷系统浏览器/mailto） | `main.ts:2291-2300` |
| M9 | IPC 守卫未校验 `event.senderFrame`（当前无子框架 preload，风险低） | `ipc-guard.ts:12-19` |
| M10 | `browser_screenshot`/`memory_save` 未列入敏感工具；plan 模式可截图登录页 | `responses-loop.ts:87`、`tools/index.ts:52-53` |
| M11 | `web_fetch` `maxBytes` 未设上限；文件校验与写入间 TOCTOU | `web-fetch.ts:133`、`path-security.ts:96-150` |
| M12 | 生产菜单暴露 reload/devtools；macOS 为 ad-hoc 签名且未开启 Hardened Runtime（发布加固） | `menu.ts:61-62`、`package.json:120-121` |

## 依赖审计

- 【既有】锁文件审计报告 10 个受影响依赖包（5 高 / 4 中 / 1 低，含间接与开发依赖）；未在本次复跑 `npm audit`，建议发布前执行一次并评估。

## 已核查、未发现问题的方面

- 主窗口 `sandbox/contextIsolation/nodeIntegration/webSecurity` 配置正确；无 `webviewTag`/禁用安全策略。
- 所有 `ipcMain.*` 均经 trusted-sender 包装；preload 仅暴露白名单通道，无 Node 泄漏。
- 无 `dangerouslySetInnerHTML`/`eval`/`new Function`；Markdown 链接限 http/https/mailto 且 `noopener`。
- IPC 响应不含凭据（只有 `hasPassword`/`hasKey`），SQL 全参数化，密钥文件/配置原子写与 0600。
- 附件/文件读写主路径具备 realpath + symlink 校验（除上述 P1/P2 缺口外）；浏览器下载被阻断、`window.open` 拒绝。

## 修复记录（2026-09-13）

基准 `main` @ `4b71d0b`，全量 **1771 passed / 2 skipped**，typecheck 通过。每项均含 TDD 测试并经独立复审（部分多轮探针复核）。

| 项 | 状态 | 提交 |
|---|---|---|
| C1 子代理零审批（失败关闭 + 审批转发父会话） | ✅ 已修 | `46b4d50` |
| C2 工作目录/附件需选择器授权 | ✅ 已修 | `fedd4ff`，绕过修复 `0a0ebc0` |
| C3 MCP 命令需确认 + 启用/工具白名单强制 | ✅ 已修 | `2b6df13`，传输翻转修复 `0a0ebc0` |
| H1 浏览器拒绝系统权限（默认会话 + 全部分区） | ✅ 已修 | `c8ef518` |
| H2 浏览器请求级私网/SSRF 拦截（含 tabs create 与重定向） | ✅ 已修 | `c8ef518` |
| H3 web_fetch IPv6 映射绕过（统一 SSRF helper） | ✅ 已修 | `d63c14e` |
| H4 run_command 路径包含（realpath + 旗标/`@`/无 scheme/配置注入） | ✅ 已修 | `d63c14e`、`263aa66`、`7954dd2`、`0fc8860`、`4b71d0b` |
| H5 子进程环境清洗（去 STELLARA_*/token + git env） | ✅ 已修 | `d63c14e`、`263aa66` |
| H6 搜索工具禁用符号链接跟随 + realpath 校验 | ✅ 已修 | `fdbdc78`、`263aa66` |
| H7 git 工具禁用 textconv/ext-diff/pager/fsmonitor | ✅ 已修 | `fdbdc78` |
| H8 API Key 与 baseUrl 绑定（改地址需重输 Key） | ✅ 已修 | `8c972c6` |
| H9 服务器凭据限 https（回环除外，含存量条目校验） | ✅ 已修 | `8c972c6`、`263aa66` |
| H10 身份切换清理不匹配云会话（一致性守卫） | ✅ 已修 | `8c972c6` |

### 修复后保留的残余风险

1. **run_command 仍属分层防御而非结构性安全**：多轮探针式围堵（dot-command 缩写、`-K` 数字簇、`@` 路径、GIT_SSH 环境等）已封（`4b71d0b`），但同类启发式风险会反复出现。**建议后续结构性改造**：子命令白名单（或移除解释器/网络工具）、网络出口单点化（统一经受控 fetch 代理）。
2. **DNS rebinding / TOCTOU**：浏览器、web_fetch、run_command 的校验与实际连接间存在重解析窗口；curl `-L/--resolve` 未逐跳校验。
3. **存量数据**：升级前持久化的 stdio MCP 配置不会再次弹确认；pre-fix 的任意 workDir 行仍被信任（低）。
4. **H10 数据隔离未完成**：本地身份之间项目/会话/记忆仍未按 user_id 隔离（需 schema 迁移与独立计划）。
5. **Service Worker 发起的请求拦截未在真实 Electron 中验证**。
6. **P2（M1–M12）尚未修复**：`.env` 转义/原子性、迁移前缀、Linux `basic_text`、文件权限、日志 PII、dev 导航前缀匹配、`senderFrame` 校验、敏感工具归类、`web_fetch` maxBytes、生产菜单 devtools、macOS Hardened Runtime 等。
7. **依赖审计**：既有报告 10 个受影响包（5 高）未在本次复跑；发布前建议执行 `npm audit` 并评估。

> 修复过程中的行为变化（需知悉）：run_command 的未知旗标/疑似路径参数改为失败关闭，可能误拒少数合法形式（如部分 `@`/含 `/` 的旗标值）；搜索工具不再跟随符号链接（工作区内的链接也不返回）；非回环 http 服务器地址会被拒绝。以上均为安全优先的取舍，已由测试固化。


### P2 修复记录（2026-09-13 续）

基准 `main` @ `f5b84bf`，全量 **1848 passed / 2 skipped**，typecheck 与 build 通过。

| 项 | 状态 | 提交 |
|---|---|---|
| M1 `.env` 无损编码（换行/引号/反斜杠/键后缀校验） | ✅ | `73b30d2`、`f5b84bf` |
| M2 迁移与 env 缓存覆盖全部 `STELLARA_*`/密钥型键 | ✅ | `73b30d2`、`f5b84bf` |
| M3 Linux `basic_text` 视为未加密 | ✅ | `73b30d2` |
| M4 `.env` 原子写 + 0600；DB 目录/文件权限 | ✅ | `73b30d2` |
| M5 日志/诊断 PII 脱敏（先脱敏后切片 + uid/手机号） | ✅ | `73b30d2`、`f5b84bf` |
| M6 云错误对渲染层泛化，详情仅本地日志 | ✅ | `73b30d2`、`f5b84bf` |
| M7 开发导航同源校验 | ✅ | `c49c9a4` |
| M8 页面导航仅主窗口外部化 | ✅ | `c49c9a4` |
| M9 IPC 拒绝子框架 senderFrame | ✅ | `c49c9a4` |
| M10 截图/记忆/计划模式敏感工具审批 | ✅ | `c49c9a4` |
| M11 `web_fetch` maxBytes 上限 | ✅ | `c49c9a4` |
| M12 生产菜单隐藏开发者项（含 Win/Linux 默认菜单关闭） | ✅ | `346c31f`、`f5b84bf` |
| 依赖 `fast-uri` 3.1.5 → 3.1.7（消除 fast-uri/ajv 高危） | ✅ | `f5b84bf` |

**P2 后剩余**：
- 生产依赖审计剩 2 个中危：`hono`、`qs`（均可修，未做以避免越界改动）。
- 历史明文 `.env` 中的字面换行值读取歧义（极罕见）；新写入已用 `\u000a`/`\u000d` 明确编码。
- `run_command` 结构性改造（子命令白名单/网络出口单点化）仍为推荐后续项。
- macOS Hardened Runtime 未启用（需正式签名与 entitlements，属发布流程决策）。

## 后续修复建议

1. **结构性改造（推荐优先）**：run_command 子命令白名单或移除解释器/网络工具、网络出口单点化——避免同类启发式绕过反复出现。
2. **依赖**：处理生产剩余 `hono`/`qs` 中危；发布前复跑 `npm audit`。
3. **发布加固**：正式签名 + Hardened Runtime + entitlements。

### run_command 结构性改造（2026-09-13 终）

提交 `342454d`、`d7792b0`（基准 @ `d7792b0`，全量 **1937 passed / 2 skipped**）。策略：

- 移除解释器/裸网络工具/间接执行器：`node/python/sh/bash/zsh/ruby/perl/bun/deno/npx`、`curl/wget/nc/ncat/ssh/scp/rsync/ftp/telnet`、`sqlite3`、`corepack/rustup/open/xargs`
- 有子命令白名单的工具（git/npm/pnpm/yarn/pip/cargo/go/xcodebuild/gradle/mvn/swift）**首参数必须是子命令**；安全形式仅限单参数 `--version/-V/-h/--help`
- `find -exec*`、`git --config/-u/--upload-pack/--receive-pack`、非 http(s) 远端（`git@host:`/`ssh:`/`git:`/`file:`）拒绝；`.git/` 目录禁止写入
- 保留:路径包含、env 清洗、URL/SSRF、GIT_* 环境禁用、无 shell spawn

**残余风险（已记录）**：项目构建脚本（`npm run`/`make`/cargo run 等）仍会执行项目代码（审批门控）；`git remote add` + 按名 fetch 绕过远端 URL 策略；`java -jar`/`javac`、`sed -i`/`find -delete` 等仍可写工作区内文件；git hooks 可由项目脚本写入。

**有意行为变化（可能的兼容性影响，需产品确认）**：`git -C`、`npm --prefix`、`git push -u`、colon refspec、`-v` 以及「旗标在前」的调用形式现在会被拒绝（安全优先，失败关闭）。

> 本报告未进行任何破坏性验证，也未对真实云/内网/用户文件发起攻击；Windows junction、真实浏览器网络竞态需在对应环境复测。
