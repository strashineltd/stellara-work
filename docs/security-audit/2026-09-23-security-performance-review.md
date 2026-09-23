# Stellara Work 安全与性能审查报告

> 日期：2026-09-23  
> 范围：全仓库 Electron 主进程 / preload / agent 工具面 / 调度 / MCP / 凭据 / 网络 / 渲染层性能  
> 方法：静态代码审查 + 本地 typecheck / 测试 / `npm audit` 基线  
> 威胁模型：渲染层被攻破（XSS / 恶意项目内容 / 依赖投毒）后调用 `window.electronAPI.*`；以及本地同机攻击者与不可信工作区

---

## 0. 总体结论

安全底座比 `2026-09-13` 审计时明显更扎实：进程隔离、IPC sender 校验、路径 realpath 围栏、stdio MCP 原生确认、`web_fetch` 连接期 IP Pinning、API Key 与 `baseUrl` 绑定、非回环服务器强制 HTTPS 等关键项均已落地。

**但仍有若干可组合利用的缺口**，主要集中在三条链：

1. **调度任务链**：任意 `workDir` + 前缀匹配的命令白名单 + 无人值守自动批准 → 工作区外读写 / 项目脚本任意代码执行。  
2. **渲染层自批准链**：危险工具审批只走 `approval:respond` IPC，渲染层被攻破即可自批 → `run_command` / `write_file`。  
3. **凭据外泄链**：MCP `headers` 明文入配置并回传渲染层；LLM `baseUrl` 无 SSRF 策略；迁移备份残留明文 Key。

性能上，**流式对话路径是最大瓶颈**（逐 token IPC + 全量 React 重渲染 + 整段 markdown 重解析 + 300ms 全量历史重写 SQLite），长会话和连续工具调用时 UI 卡顿会随历史长度恶化。

本地基线：
- `npm run typecheck` ✅
- `npm test`：2361 passed / **19 failed** / 2 skipped（失败均为 Sidebar / MainView / HomeView / tokens 的 UI 文案与布局断言漂移，与安全无关）
- `npm audit --omit=dev`：**0 vulnerabilities**（此前记录的 `hono`/`qs` 中危已不在生产依赖树中）

---

## 1. 安全发现

### P0 — 应立即修复

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| S1 | **调度任务 `workDir` 未经选择器授权**：`scheduled:create`/`update` 直接落库任意路径；跑一次后 Session 的 workDir 会被 `assertWorkDirAllowed` 二次信任 | `electron/main.ts:1368-1398`、`:1677-1695`、`electron/scheduler/runner.ts:284-323` | 渲染层被攻破后可把 `/Users/x/.ssh` 设为工作区，配合读工具或写策略外泄/篡改任意目录 |
| S2 | **GNU `sed` 可执行任意 shell**（`e` / `s///e`），只拦了 `-i` | `electron/agent/tools/shell.ts:34-43`、`:510-521` | 一次 `run_command` 批准或调度白名单含 `sed` 即可 RCE（Linux/ GNU sed） |
| S3 | **`find -delete` 等写 primary 未拦截** | `electron/agent/tools/shell.ts:38`、`:523-528` | 绕过 `write_file` 范围与审批语义，批量删除工作区文件 |
| S4 | **危险工具审批完全在渲染层**：`approval:respond` 可被同一被攻破的 renderer 自批 | `electron/preload.ts:144-146`、`electron/main.ts:613-626` | 自动同意 `run_command` / `write_file` / `browser_exec_js` |

### P1 — 应近期修复

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| S5 | **调度 `allowedCommands` 为 token 前缀匹配**，`npm run`/`make`/`cargo run` 等会执行项目代码且无人审批 | `electron/scheduler/policy.ts:45-61`、`electron/main.ts:2258-2261` | 恶意仓库脚本在定时任务中无人值守执行 |
| S6 | **`run_command` 省略 `cwd` 时跳过 `fileScopes`** | `electron/scheduler/policy.ts:164-170`、`electron/agent/subagent-guard.ts:49-51` | 声明「仅 `src/**`」的写策略可被默认 cwd 脚本写穿 |
| S7 | **白名单含系统变更工具**：`defaults write`、`diskutil`、`brew`、`git clean -fdx`、`plutil` 写 | `electron/agent/tools/shell.ts:47-50`、`:66-71` | 一次批准即可改系统偏好 / 卸载卷 / 装软件 / 清空未跟踪文件 |
| S8 | **MCP `headers`（含 Authorization）明文存 `config.json` 并经 `mcp:list` 回传渲染层** | `shared/ipc.ts:789-800`、`electron/mcp/mcp-manager.ts:79-81`、`electron/main.ts:1259-1261` | 第三方 token 被渲染层/备份外泄；与模型 Key「不出主进程」边界不一致 |
| S9 | **MCP HTTP 可 `approval:'never'` 且添加时无原生确认**；非回环可走明文 HTTP + 自定义头 | `electron/mcp/mcp-manager.ts:84-100`、`:193-202`、`electron/security/net-policy.ts:278-309` | 静默远程工具执行 / LAN 明文传凭证 |
| S10 | **LLM `baseUrl` 无 SSRF/协议策略**，`models:test` 与对话用裸 `fetch` 并附带 Bearer Key | `electron/llm/responses.ts:156-164`、`electron/llm/anthropic.ts:240+` | 可把 API Key POST 到 `169.254.169.254` 或内网/攻击者端点 |
| S11 | **`tools:invoke`（dev）绕过全部审批**；preload 始终暴露 | `electron/main.ts:629-637`、`electron/preload.ts:153-156` | `NODE_ENV=development` 下可直调危险工具 |
| S12 | **迁移留下明文密钥副本**：`~/.stellara` 整目录保留；`config.json.bak` 含旧 `apiKey` | `electron/config/data-dir.ts:27-55`、`electron/config/config-v2.ts:345-352` | 升级后仍可从备份目录读出全部历史 Key |
| S13 | **浏览器导航策略同步门放过 `127.0.0.1`/RFC1918/`169.254.*` 字面量**；审批 hook 未接线时 fail-open | `electron/browser/url-policy.ts:2-10`、`electron/browser/service.ts:343-345` | SSRF 字面量绕过 + 未来接线遗漏时静默放行 |
| S14 | **README「数据永不离开本机」与 CloudBase 云账号不符** | `README.md:26`、`electron/cloud/cloudbase-client.ts` | 合规/信任表述风险 |

### P2 — 加固项

| # | 问题 | 位置 |
|---|---|---|
| S15 | 工作区 `skills/**` 可注入操作策略（提示/策略注入，与自动批准组合危险） | `electron/agent/skills.ts` |
| S16 | 路径校验→写入存在 TOCTOU（无 `O_NOFOLLOW` 重验） | `electron/fs/path-security.ts:96-149`、`electron/agent/tools/fs.ts` |
| S17 | `forceApprovalMode` 后调度策略仍可自动批准（熔断失效） | `responses-loop.ts` / `anthropic-loop.ts` + `main.ts:2258` |
| S18 | `defaultSession` 只做权限加固、未做请求级 SSRF 过滤 | `electron/main.ts:2037-2040` |
| S19 | LLM 错误原文、renderer `console-message` 未脱敏入日志；`redact.ts` 漏 `tvly-`/`brv-`/JSON `apiKey` | `llm/responses.ts`、`main.ts:309-312`、`security/redact.ts` |
| S20 | `listKeys()` 批量返回明文 Key 的 API 形状危险 | `electron/config/secrets.ts:265-277` |
| S21 | markdown `img` 允许任意 `https:` 远程图（IP 泄漏 / 追踪信标） | `src/components/MarkdownView.tsx`、`index.html` CSP |
| S22 | `fs:openPath`/附件打开可启动 `.js`/`.command` 等系统关联程序 | `main.ts:724-738`、`attachments.ts` |
| S23 | 浏览器 live view `setViewport` 可覆盖审批 UI（clickjacking） | `main.ts:1645-1651` |
| S24 | 未启用 Electron Fuses（`RunAsNode`、ASAR integrity 等） | `package.json` build |
| S25 | safeStorage 不可用时静默明文落盘；`listKeys` 解密无 try/catch | `main.ts:2075+`、`secrets.ts` |
| S26 | 搜索提供方 `fetch` 未走 `safeFetch`（DNS rebinding 残留） | `electron/browser/search-providers.ts` |
| S27 | 消息历史可被渲染层 `saveMessages` 伪造 | `main.ts:957-967` |
| S28 | `scheduled_runs(task_id)` 缺索引；多表无保留策略 | `electron/store/db.ts` |

### 已做得好的方面（保持）

- 主窗口与浏览器 `WebContentsView`：`sandbox + contextIsolation + nodeIntegration:false + webSecurity`  
- preload 仅 contextBridge 白名单，无 raw `ipcRenderer` / Node 泄漏  
- 全量 IPC `isTrustedIpcSender` + 主框架校验  
- 路径围栏统一 realpath + symlink 拒绝；workdir 授权不可由渲染层自封  
- stdio MCP 原生确认 fail-closed；HTTP 传输剥离 spawn 字段  
- `web_fetch` 连接期 IP Pinning（undici lookup）+ 重定向逐跳校验  
- 模型 API Key / 服务器密码 / 云 token 不回传渲染层；改 `baseUrl` 需重输 Key  
- 非回环 opencode 服务器强制 HTTPS  
- `spawn(..., shell:false)`，无管道/重定向；git 禁 textconv/ext-diff/pager  
- Markdown 无 `dangerouslySetInnerHTML`；链接协议白名单  
- `npm audit --omit=dev` 当前 0 漏洞  

---

## 2. 性能发现

### 高优先级（直接影响使用手感）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P1 | **逐 token 流式重渲染风暴** | `session-runner.ts:56-60` → `MainView.tsx:671-682` → `chat-utils.ts:103-128` → `MarkdownView.tsx` | 每个 delta：IPC + `[...prev]` + 整表 map + 当前气泡 **整段 markdown 重解析**（随消息长度近似 O(n²)） |
| P2 | **流式期间 300ms 全量重写消息表** | `MainView.tsx:427-438`、`db.ts:561-595` | `DELETE` + 全量 INSERT，better-sqlite3 同步卡主进程；每次还 `sessions.list()` 刷侧栏 |
| P3 | **启动阻塞**：whenReady 串行迁移/建库/接线后才 `createWindow` | `main.ts:2036-2412` | 冷启动体感像卡死 |
| P4 | **DiffCard 默认展开 + 全量 CodeMirror 语言包** | `DiffCard.tsx:1-12,52` | 连续改 N 个文件 = N 个 MergeView 立刻挂载 |
| P5 | **ContextHub 每次 `chat:start` 全量回放** | `context-hub.ts:200-282`、`db.ts:853-937` | 长会话首 token 延迟随历史线性增长 |
| P6 | **preload 流队列无上限 + 每流双 listener** | `preload.ts:50-98` | 慢消费者内存膨胀 |

### 中优先级

| # | 问题 | 位置 |
|---|---|---|
| P7 | 聊天列表无虚拟化；`ChatStream`/行组件未 memo；流式时强制 `scrollTop` | `ChatStream.tsx`、`MainView.tsx:470-475` |
| P8 | 会话搜索 `LIKE '%…%'` 全表扫 + 二次全量 `listSessions` | `db.ts:347-362` |
| P9 | 目录树顺序 `lstat`/无缓存/深度 4 急切构建 | `electron/fs/tree.ts` |
| P10 | 文件树每节点多 hook + expanded Set 变更全树重渲 | `FileTreeNode.tsx` |
| P11 | 记忆注入每轮 4 查 + N 次 `bumpAccess`；会话后全量抽记忆 | `memory-injector.ts`、`main.ts:1964+` |
| P12 | tiktoken WASM + 每次预算检查 stringify | `token-estimator.ts` |
| P13 | `MainView` 无依赖数组的 `menu-action` 监听每 token 重挂；自动改名 effect 跟 `entries` | `MainView.tsx:483-533` |
| P14 | `settings-changed` 过宽触发全量 App 状态重载 | `App.tsx:61-77` |
| P15 | 无 `manualChunks`；CodeMirror / Settings / Browser 未分包 | `vite.config.ts` |

### 性能上做得好的

- Scheduler 用定时堆而非轮询；托盘驻留避免进程反复拉起  
- `MarkdownView` 已 `memo`，历史气泡在 copy-on-write 下可跳过重解析  
- SQLite：WAL + FK + 主要索引 + memories FTS5；`saveMessages` 有事务  
- 避免 highlight.js；token 估算有 WeakMap 缓存  

---

## 3. 建议修复顺序

### 安全（先堵可组合利用链）

1. **S1**：`scheduled:create/update` 强制 `assertWorkDirGranted`（或只允许已授权 Project 的 workDir）；禁止 Session workDir 反哺永久授权。  
2. **S2–S3**：从 `run_command` 移除 `sed`；`find` 仅允许 `-name/-type/-print/-maxdepth` 等只读 primary。  
3. **S4**：危险工具改为 **主进程原生对话框** 批准（对齐 `mcp-confirm`）；渲染层只作提示。  
4. **S5–S7**：调度命令改为 **完整 argv 精确匹配**；区分「只读」与「执行项目代码」；移除/收紧 `defaults`/`diskutil`/`brew`/`git clean`。  
5. **S8–S10**：MCP headers 入密钥库、IPC 只回 `hasAuth`；MCP 添加一律原生确认 + 非回环强制 HTTPS；LLM 走 `checkUrlDestination` + `safeFetch`。  
6. **S11–S12**：删除或锁定 `tools:invoke`；迁移后粉碎/脱敏 `~/.stellara` 与 `config.json.bak` 中的密钥。  
7. **S13–S14**：浏览器 URL 同步门补齐私网字面量；审批 hook fail-closed；修正 README 隐私表述。

### 性能（先稳住流式体验）

1. **P1+P2**：主进程侧合并 content/reasoning delta（30–50ms 或 ≥64 字符刷一次）；流式中只增量写消息，done/abort 再全量对账；去掉每次 save 后的 `sessions.list()`。  
2. **P3**：`createWindow` 提前，DB/调度/服务器初始化后台化并用 ready 门闸。  
3. **P4**：DiffCard 默认折叠 + CodeMirror 动态 `import()`。  
4. **P5**：ContextHub 走 checkpoint 快照，只回放增量。  
5. **P6–P7**：preload 合并/限流队列；聊天列表 memo + 虚拟化。  
6. 其后处理搜索 FTS、文件树懒加载/缓存、记忆批处理、bundle 分包。

---

## 4. 与既有审计文档的关系

- `2026-09-12` / `2026-09-13` 的 C1–C3、H1–H10、M1–M12 与 run_command 结构性收敛 **在当前代码中仍可见对应修复**（路径围栏、MCP 确认、IPv6 SSRF、env 清洗、API Key 绑定 baseUrl 等）。  
- `2026-09-14-pending-tasks` 中：web_fetch IP Pinning **已落地**（`pinned-fetch.ts`）；`sed -i` 已拦但 **`e` 命令仍是洞（S2）**；macOS `hardenedRuntime` + entitlements **已配置**，公证流仍待发布侧完成。  
- 本轮新增重点：**调度 workDir 逃逸（S1）**、**渲染层自批准（S4）**、**MCP headers 外泄（S8）**、**LLM baseUrl SSRF（S10）**，以及完整性能清单。

> 本报告未做破坏性验证，也未对真实云/内网/用户文件发起攻击。Windows junction、真实浏览器网络竞态、GNU sed 行为需在对应平台复测。
