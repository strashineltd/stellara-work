<p align="center">
  <img src="assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>A local-first, Codex-style desktop agent</strong> for Windows & macOS.<br/>
  Bring your own OpenAI-compatible API key — your data stays on your machine.
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

**Stellara Work** is a **local-first** desktop agent that runs on your machine like a personal Codex. Bring your own OpenAI-compatible API key (`base_url + api_key`) and collaborate with the agent on coding tasks — reading files, editing code, running commands — with full review and approval over every action.

Your API key, sessions, files, and configuration **never leave your machine**. Stellara Work does not upload any data to external servers.

---

## Features

| | Feature | Description |
|---|---|---|
| 🔒 | **Local-first privacy** | API keys encrypted via OS keychain (macOS) / DPAPI (Windows); all data stored locally |
| 🧠 | **Bring your own model** | Works with any OpenAI-compatible endpoint; built-in presets for GLM, DeepSeek, Kimi, MiniMax; unlimited custom models |
| ✅ | **Plan mode with approval gates** | Every file write and shell command waits for your explicit approval |
| 💬 | **Streaming chat** | Real-time markdown rendering, diff views, and shell output cards |
| 🗂️ | **Project workspaces** | Point the agent at any folder; it reads, edits, and tests against your real code |
| 🧰 | **Skills & MCP** | Extend the agent with custom skills and Model Context Protocol servers |
| 🧠 | **Memory center** | Persistent, searchable cross-session memory |
| 📎 | **Attachments** | Drag & drop files and images into any conversation |
| 📂 | **File manager** | Sidebar file tree with new file/folder creation |
| 🎨 | **Design system** | Consistent UI tokens and workbench styling across all views |

---

## Screenshots

| Home | Chat | Settings |
|:---:|:---:|:---:|
| ![home](assets/screenshots/home.png) | ![chat](assets/screenshots/chat.png) | ![settings](assets/screenshots/settings.png) |

---

## Downloads

**Latest release: v0.9.1**

| Platform | Installer |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **Note:** Builds are currently unsigned. On macOS, right-click → Open to bypass Gatekeeper. On Windows, click "More info → Run anyway" in SmartScreen.

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

| Model | Provider | base_url |
|---|---|---|
| GLM-5.2 | Zhipu BigModel | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Custom | yours | any OpenAI-compatible endpoint |

---

## Security Model

- `nodeIntegration: false` — renderer cannot `require('fs')`
- `contextIsolation: true` — renderer JS is isolated from preload
- `sandbox: true` — renderer runs sandboxed
- External URLs restricted to `http/https/mailto` protocols
- IPC sender validation on all handlers
- All dangerous operations (file writes, shell commands) require explicit approval

---

## Architecture

```
electron/                  # Electron main process
├── main.ts                # entry + IPC handlers
├── preload.ts             # contextBridge API
├── agent/                 # agent loop, planning, tools (fs / shell / grep / git)
├── llm/                   # OpenAI-compatible client + SSE streaming
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
