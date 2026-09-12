# Changelog · 变更记录

All notable changes to Stellara Work are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.9.2.1] - 2026-09-10

### Fixed · 修复

- 修复 macOS 安装后提示「已损坏，无法打开」、无法启动的问题

## [0.9.3] - 2026-09-12

### Added · 新增

- **服务器连接**：设置 → 服务器支持添加/编辑/测试/设为默认与加密凭据
- **服务器会话**：顶栏执行端切换，支持创建会话、流式对话、审批、模型与 Agent 切换
- **侧栏服务器分组**：会话按服务器归类，离线显示徽标并支持重连
- AI 浏览器 L3：观察窗实时画面（WebContentsView 嵌入，默认只读 + 接管交互，实时/快照双视图）
- AI 浏览器 C3：浏览记忆 — 会话末将 web_search/browser_* 成果并入记忆提取（新增「网页」记忆类型，记忆中心可筛选）
- AI 浏览器 C2：登录保留站点（允许列表 + 退出清理非列表站点 Cookie，设置面板维护）
- 内置 AI 浏览器 B 组：设置面板（JS 执行开关 + 搜索服务/Key 配置）、清空数据时清理浏览器分区、act 限频（1 秒 1 次）、导航后 SPA 稳定等待、plan 模式支持 web_search
- 内置 AI 浏览器二期：真多 Tab（每 Tab 独立窗口）、观察窗接入聊天区并自动展开、同 Tab 快照实时刷新、Markdown 链接协议硬化
- 内置 AI 浏览器 P0/P1: web_search + browser_* Agent 工具（自动化控制，强审批），观察窗只读

### Changed · 变更

- 顶栏执行端选择器改为「图标 + 名称」简洁样式；全屏时导航箭头平移贴左（带过渡动画）
- 侧边栏账号入口移到「设置」下方，显示头像 + 名称
- 全应用静态文字不再显示文本输入光标（可编辑控件保留）
- 新应用图标：macOS 白色圆角 + 投影，Windows 仅 logo 透明底

### Fixed · 修复

- 离线/已删除服务器的会话回退本地缓存只读展示，不再打开空白；提示区分有无缓存
- 删除服务器时一并清理其本地会话映射与缓存，不再残留「未知服务器」分组
- 修复会话切换卡顿：只读会话不再反复重写缓存，Markdown 渲染 memo 化
- 修复 macOS 全屏后顶栏箭头未左移的问题
- 修复「本地」chip 悬停显示文本输入光标的问题

## [0.9.2] - 2026-08-20

### Added · 新增

- **Responses API**: all built-in model traffic now uses the Responses API with no legacy protocol fallback
- **Anthropic Messages**: custom models can explicitly select Anthropic Messages and use the full Agent tool loop
- **Context Hub**: unified context management with checkpoints, verification evidence, and stale detection
- **Subagent coordinator**: session-scoped subagent management with role-based concurrency (research/build/verify)
- **Responses Agent Loop**: new agent loop using ResponseItem[] and function_call_output
- **Tool execution context**: tools now track session/revision/plan step for audit
- **Model presets**: DeepSeek-V4-Flash, Qwen3.8-Max, and GLM-5.3
- **UI redesign**: calm light/dark workbench, protocol badges, live context revisions, checkpoints, task gate, and subagent roles

### Changed · 变更

- Built-in model calls use `POST {baseUrl}/responses`; custom Anthropic configurations use `POST {baseUrl}/v1/messages`
- Tool results use `function_call_output` instead of `tool_call_id`
- Context events are now tracked with sequence/revision numbers
- Subagent coordination moved from global runner to session-scoped coordinator
- Model settings now show Responses API verification status

### Security · 安全

- External URL allowlist (http/https/mailto) prevents file:// and other protocol abuse
- IPC sender validation on all handlers
- Tool execution context with revision tracking for audit trail
- `store: false` fixed in all requests (no server-side session storage)

### Migration · 迁移

- Existing model configurations are automatically migrated to v2 schema
- GLM-5.2, Kimi-K3, MiniMax-M3 configurations preserved but marked incompatible (no Responses API)
- Custom models require Function Calling verification to be enabled

## [0.9.0] - 2026-08-15

### Added · 新增

- **Home composer attachments**: attach files and images from the home task input (drag & drop or picker); images render inline, files open on click
- **AttachmentPicker component** extracted from InputArea, shared by chat and home input
- **Skills & MCP**: custom skills and Model Context Protocol server support
- **Memory center**: persistent, searchable cross-session memory
- **Project folder mode**: point the agent at an existing folder as its workspace
- **Sidebar file view**: browse workspace files in the sidebar
- **Hover preview**: hover file paths to preview content
- **Context usage tracking** in sessions
- **In-app settings panel** (replaces the separate settings window)
- **Frameless window** on both platforms (no system title bar / traffic lights)

### Changed · 变更

- Settings moved from a separate window to an in-app overlay panel
- Removed system window controls on both platforms; close via Cmd+Q / app menu
- Attachment fields are stripped from LLM request bodies (strict gateway compat)

### Security · 安全

- API keys encrypted with OS keychain (macOS safeStorage) / DPAPI (Windows)
- Renderer remains sandboxed; key material never leaves the main process

### Fixed · 修复

- Window controls duplication on frameless windows
- Attachments leaking into LLM request bodies

---

## [0.8.x] - earlier iterations

- W1: backend agent loop (agent cycle, tools, LLM clients)
- W2: desktop shell + chat UI (streaming chat, plan mode + approval gate, diff/shell cards, command palette)
- W3: local data (onboarding, settings, session persistence & restore, context compression, NSIS packaging)
