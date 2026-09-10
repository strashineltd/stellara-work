# Changelog · 变更记录

All notable changes to Stellara Work are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.9.2.1] - 2026-09-10

### Fixed · 修复

- **macOS 安装后提示「已损坏，无法打开」**：构建启用 ad-hoc bundle 签名（`mac.identity: "-"`），生成完整的 `_CodeSignature/CodeResources` 资源封印，`codesign --verify --deep --strict` 通过。此前签名被完全禁用，主二进制仅有 linker 裸签名、bundle 缺资源封印，被 Gatekeeper 判定为损坏。

## [Unreleased]

### Added · 新增

- AI 浏览器 L3：观察窗实时画面（WebContentsView 嵌入，默认只读 + 接管交互，实时/快照双视图）
- AI 浏览器 C3：浏览记忆 — 会话末将 web_search/browser_* 成果并入记忆提取（新增「网页」记忆类型，记忆中心可筛选）
- AI 浏览器 C2：登录保留站点（允许列表 + 退出清理非列表站点 Cookie，设置面板维护）
- 内置 AI 浏览器 B 组：设置面板（JS 执行开关 + 搜索服务/Key 配置）、清空数据时清理浏览器分区、act 限频（1 秒 1 次）、导航后 SPA 稳定等待、plan 模式支持 web_search
- 内置 AI 浏览器二期：真多 Tab（每 Tab 独立窗口）、观察窗接入聊天区并自动展开、同 Tab 快照实时刷新、Markdown 链接协议硬化
- 内置 AI 浏览器 P0/P1: web_search + browser_* Agent 工具（自动化控制，强审批），观察窗只读

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
