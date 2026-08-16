<p align="center">
  <img src="assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>A local-first, Codex-style desktop agent</strong> for Windows & macOS.
  <br />
  Bring your own OpenAI-compatible API key — your data stays on your machine.
</p>

<p align="center">
  <a href="https://github.com/strashineltd/stellara-work/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/strashineltd/stellara-work" /></a>
  <img alt="Platform: Windows / macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

**Stellara Work** 是一款**数据本地**的 Codex 风格桌面 Agent：你自备 OpenAI 兼容的 `base_url + API key`，在桌面工作台上与 Agent 协作完成代码任务——读取文件、编辑代码、执行命令，全程可审阅、可批准。**你的密钥、会话、文件与配置永远留在本机**，Stellara Work 不会上传任何数据。

*Stellara Work is a local-first, Codex-style desktop agent. Bring your own OpenAI-compatible API key, and collaborate with the agent on coding tasks — reading files, editing code, running commands — with full review and approval over every action. Your keys, sessions, files, and config stay on your machine. Stellara Work never uploads your data.*

---

## Features · 功能亮点

- **🔒 Local-first privacy · 数据本地，隐私优先** — API keys encrypted with OS keychain (macOS) / DPAPI (Windows); sessions, files and config all stored locally. / API key 由系统钥匙串（macOS）/ DPAPI（Windows）加密，会话、文件、配置全部存于本机。
- **🧠 Bring-your-own-model · 自带模型** — Works with any OpenAI-compatible endpoint. Presets for GLM, DeepSeek, Kimi (Moonshot), MiniMax, plus unlimited custom models. / 兼容任意 OpenAI 协议端点，内置 GLM、DeepSeek、Kimi、MiniMax 预设，支持无限自定义模型。
- **✅ Plan mode with approval gates · 计划模式 + 批准门禁** — Every file write and shell command waits for your explicit approval. / 每次文件写入、命令执行都需你显式批准。
- **💬 Streaming chat · 流式对话** — Live markdown rendering, diff views, and shell output cards. / 实时 Markdown 渲染、diff 视图与命令输出卡片。
- **🗂️ Project workspaces · 项目工作区** — Point the agent at any folder; it reads, edits, and tests against your real code. / 指向任意文件夹，Agent 在真实代码上读写与验证。
- **🧰 Skills & MCP · 技能与 MCP** — Extend the agent with custom skills and Model Context Protocol servers. / 用自定义技能与 MCP 服务器扩展 Agent 能力。
- **🧠 Memory center · 记忆中心** — Persistent, searchable memory across sessions. / 跨会话持久、可搜索的记忆。
- **📎 Attachments · 附件** — Drag & drop files and images into any conversation. / 任意会话中拖拽文件与图片。

---

## Screenshots · 截图

| Home · 首页 | Chat · 对话 | Settings · 设置 |
|:---:|:---:|:---:|
| ![home](assets/screenshots/home.png) | ![chat](assets/screenshots/chat.png) | ![settings](assets/screenshots/settings.png) |

---

## Downloads · 下载

Latest release: **v0.9.0**

| Platform | Installer |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.0-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.0.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> Note: builds are currently unsigned. On macOS, right-click → Open to bypass Gatekeeper; on Windows, click "More info → Run anyway" in SmartScreen.
>
> 提示：当前安装包未签名。macOS 请右键 → 打开；Windows 在 SmartScreen 中选择"更多信息 → 仍要运行"。

---

## Quick Start · 快速开始

### Prerequisites · 环境要求

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (Desktop development with C++) — required only for the first `npm install` of `better-sqlite3`
- macOS / Linux: nothing extra — `better-sqlite3` ships prebuilt binaries

### 1. Install · 安装依赖

```bash
npm install
```

On macOS/Linux you can also use `bash setup.sh` (checks Node, installs deps, runs tests).

### 2. Run · 启动

```bash
npm run dev
```

On first launch, the onboarding flow walks you through choosing a model provider and entering your API key. Your key is stored encrypted and is only ever read by the main process.

首次启动时按引导选择模型并填入 API key 即可。密钥加密存储，仅主进程可读。

### 3. Scripts · 常用脚本

```bash
npm run dev        # dev mode (Vite HMR + Electron)
npm test           # run tests
npm run typecheck  # type check both processes
npm run package:mac  # build macOS dmg/zip (macOS only)
npm run package:win  # cross-build Windows NSIS installer (works on macOS, no wine)
```

---

## Built-in Model Presets · 内置模型预设

| Model | Provider | base_url |
|---|---|---|
| GLM-5.2 | Zhipu BigModel | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| Custom · 自定义 | yours | any OpenAI-compatible endpoint |

---

## Security Model · 安全模型

- `nodeIntegration: false` — the renderer cannot `require('fs')`
- `contextIsolation: true` — renderer JS is isolated from preload
- `sandbox: true` — the renderer runs sandboxed
- API keys live in the main process; the renderer can never read them via IPC
- All dangerous operations (file writes, shell commands) require explicit approval

---

## Architecture · 架构

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

## Documentation · 文档

- [macOS migration guide · macOS 迁移指南](docs/macos-migration.md)
- [Contributing · 贡献指南](CONTRIBUTING.md)
- [Changelog · 变更记录](CHANGELOG.md)

---

## License · 许可证

[MIT](LICENSE) © Stellara Work
