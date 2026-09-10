<p align="center">
  <img src="assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>A local-first, Codex-style desktop agent</strong> for Windows & macOS.<br/>
  Bring your own Responses API or Anthropic Messages API key — your workspaces stay local.
</p>

<p align="center">
  <a href="https://github.com/strashineltd/stellara-work/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/strashineltd/stellara-work" /></a>
  <img alt="Platform: Windows / macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" />
</p>

<p align="center">
  <a href="docs/i18n/README_zh-CN.md">简体中文</a> · <a href="docs/i18n/README_zh-TW.md">繁體中文</a> · <a href="docs/i18n/README_ru.md">Русский</a> · <a href="docs/i18n/README_fr.md">Français</a> · <a href="docs/i18n/README_de.md">Deutsch</a> · <a href="docs/i18n/README_es.md">Español</a> · <a href="docs/i18n/README_pt-BR.md">Português</a> · <a href="docs/i18n/README_ja.md">日本語</a> · <a href="docs/i18n/README_ko.md">한국어</a> · <a href="docs/i18n/README_ar.md">العربية</a>
</p>

---

**Stellara Work** is a **local-first** desktop agent that runs on your machine like a personal Codex. Bring your own API key and collaborate with the agent on coding tasks — reading files, editing code, running commands — with full review and approval over every action.

Your API key, sessions, files, and configuration **never leave your machine**. Stellara Work does not upload any data to external servers.

---

## Features

| | Feature | Description |
|---|---|---|
| 🔒 | **Local-first privacy** | API keys encrypted via OS keychain (macOS) / DPAPI (Windows); all data stored locally |
| 🧠 | **Responses API** | Native support for OpenAI Responses API; built-in presets for DeepSeek, Qwen; unlimited custom models |
| ✅ | **Plan mode with approval gates** | Every file write and shell command waits for your explicit approval |
| 💬 | **Streaming chat** | Real-time markdown rendering, diff views, and shell output cards |
| 🗂️ | **Project workspaces** | Point the agent at any folder; it reads, edits, and tests against your real code |
| 🧰 | **Skills & MCP** | Extend the agent with custom skills and Model Context Protocol servers |
| 🧠 | **Memory center** | Persistent, searchable cross-session memory |
| 📎 | **Attachments** | Drag & drop files and images into any conversation |
| 📂 | **File manager** | Sidebar file tree with new file/folder creation |
| 🎨 | **Design system** | Consistent UI tokens and workbench styling across all views |
| 🔄 | **Context Hub** | Unified context management with checkpoints, verification evidence, and stale detection |
| 👥 | **Subagent coordinator** | Session-scoped subagent management with role-based concurrency and conflict detection |

---

## Screenshots

| Home | Chat | Settings |
|:---:|:---:|:---:|
| ![home](assets/screenshots/home.png) | ![chat](assets/screenshots/chat.png) | ![settings](assets/screenshots/settings.png) |

---

## Downloads

**Latest release: v0.9.2.1**

| Platform | Installer |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.2.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| macOS (Intel) | [Stellara Work-0.9.2.1-x64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.2.1-x64.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Note (macOS):** builds are ad-hoc signed but not notarized (no Apple Developer certificate). If macOS blocks the first launch — 「无法验证开发者 / Apple 无法检查其是否包含恶意软件」— use one of:
> 1. **右键 App → 打开** → 再次确认「打开」（macOS 14 及更早）
> 2. **系统设置 → 隐私与安全性 → 仍要打开**（macOS 15 Sequoia 及更新版本）
> 3. 终端执行：`xattr -dr com.apple.quarantine "/Applications/Stellara Work.app"`
>
> **Note (Windows):** click "More info → Run anyway" in SmartScreen.

---

## Quick Start

### Prerequisites

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (Desktop development with C++) — required only for the first `npm install` of `better-sqlite3`
- macOS / Linux: nothing extra — `better-sqlite3` ships prebuilt binaries

### 1. Install dependencies

```bash
npm install
```

On macOS/Linux you can also use `bash setup.sh` (checks Node, installs deps, runs tests).

### 2. Run

```bash
npm run dev
```

On first launch, the onboarding flow walks you through choosing a model provider and entering your API key. Your key is stored encrypted and is only read by the main process.

### 3. Scripts

```bash
npm run dev          # dev mode (Vite HMR + Electron)
npm test             # run tests
npm run typecheck    # type check both processes
npm run package:mac  # build macOS dmg/zip (macOS only)
npm run package:win  # build Windows NSIS installer
```

---

## Built-in Model Presets

| Model | Provider | Responses API | Status |
|---|---|---|---|
| DeepSeek-V4-Pro | DeepSeek | ✅ Verified | Available |
| DeepSeek-V4-Flash | DeepSeek | ✅ Verified | Available |
| Qwen3.8-Max | Alibaba Cloud | ⏳ Pending | Pending verification |
| GLM-5.3 | Zhipu BigModel | ⏳ Pending | Pending verification |
| Custom | yours | Responses API or Anthropic Messages | Requires connection verification |

> **Note:** GLM-5.2, Kimi-K3, and MiniMax-M3 configurations are preserved but marked as incompatible (no Responses API support). Custom endpoints must pass Function Calling verification to be enabled.

---

## Security Model

- `nodeIntegration: false` — renderer cannot `require('fs')`
- `contextIsolation: true` — renderer JS is isolated from preload
- `sandbox: true` — renderer runs sandboxed
- External URLs restricted to `http/https/mailto` protocols
- IPC sender validation on all handlers
- All dangerous operations (file writes, shell commands) require explicit approval
- `store: false` fixed in all requests (no server-side session storage)
- Tool execution context with revision tracking for audit

---

## Architecture

```
electron/                  # Electron main process
├── main.ts                # entry + IPC handlers
├── preload.ts             # contextBridge API
├── agent/                 # Responses API agent loop, planning, tools
├── context/               # Context Hub (unified state management)
├── llm/                   # Responses API client + SSE streaming
├── memory/                # persistent memory store
└── config/                # encrypted key storage (safeStorage)
src/                       # React renderer
├── components/            # chat, plan cards, settings, onboarding, home
├── styles/                # design tokens + workbench CSS
└── lib/                   # renderer utilities
shared/                    # IPC contract shared by both processes
```

Stack: Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## Documentation

- [macOS migration guide](docs/macos-migration.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

---

## License

[MIT](LICENSE) © Stellara Work
