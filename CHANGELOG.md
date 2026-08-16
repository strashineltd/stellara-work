# Changelog · 变更记录

All notable changes to Stellara Work are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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
