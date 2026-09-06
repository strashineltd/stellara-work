# Changelog · 变更记录

All notable changes to Stellara Work are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added · 新增

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
