<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>本地优先的 Codex 风格桌面 Agent</strong>，支持 Windows 与 macOS。<br/>
  自带 OpenAI 兼容 API 密钥——所有数据仅留在本机。
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-TW.md">繁體中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** 是一款**本地优先**的桌面 Agent，运行方式类似个人 Codex。自备 OpenAI 兼容的 API 密钥（`base_url + api_key`），在桌面工作台上与 Agent 协作完成编码任务——读取文件、编辑代码、执行命令——全程可审阅、可批准。

API 密钥、会话、文件与配置**永远不会离开本机**。Stellara Work 不会向外部服务器上传任何数据。

---

## 功能亮点

| | 功能 | 说明 |
|---|---|---|
| 🔒 | **本地隐私优先** | API 密钥由系统钥匙串（macOS）/ DPAPI（Windows）加密；所有数据存于本机 |
| 🧠 | **自带模型** | 兼容任意 OpenAI 协议端点；内置 GLM、DeepSeek、Kimi、MiniMax 预设；支持无限自定义模型 |
| ✅ | **计划模式 + 批准门禁** | 每次文件写入、命令执行都需你显式批准 |
| 💬 | **流式对话** | 实时 Markdown 渲染、diff 视图与命令输出卡片 |
| 🗂️ | **项目工作区** | 指向任意文件夹，Agent 在真实代码上读写与验证 |
| 🧰 | **技能与 MCP** | 用自定义技能与 MCP 服务器扩展 Agent 能力 |
| 🧠 | **记忆中心** | 跨会话持久、可搜索的记忆 |
| 📎 | **附件** | 在任意会话中拖拽文件与图片 |
| 📂 | **文件管理器** | 侧栏文件树，支持新建文件/文件夹 |
| 🎨 | **设计系统** | 统一的 UI 样式变量与工作台设计 |

---

## 截图

| 首页 | 对话 | 设置 |
|:---:|:---:|:---:|
| ![首页](../../assets/screenshots/home.png) | ![对话](../../assets/screenshots/chat.png) | ![设置](../../assets/screenshots/settings.png) |

---

## 下载

**最新版本：v0.9.1**

| 平台 | 安装包 |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **注意：** 当前安装包未签名。macOS 请右键 → 打开；Windows 在 SmartScreen 中选择"更多信息 → 仍要运行"。

---

## 快速开始

### 环境要求

- Node.js 20+
- Windows：Python 3.x + Visual Studio Build Tools（桌面开发 C++）——仅首次 `npm install` 时需要
- macOS / Linux：无需额外安装

### 1. 安装依赖

```bash
npm install
```

macOS/Linux 可用 `bash setup.sh`（检查 Node、安装依赖、运行测试）。

### 2. 启动

```bash
npm run dev
```

首次启动时按引导选择模型并填入 API key。密钥加密存储，仅主进程可读。

### 3. 常用脚本

```bash
npm run dev          # 开发模式（Vite HMR + Electron）
npm test             # 运行测试
npm run typecheck    # 类型检查两个进程
npm run package:mac  # 构建 macOS dmg/zip（仅 macOS）
npm run package:win  # 构建 Windows NSIS 安装包
```

---

## 内置模型预设

| 模型 | 提供商 | base_url |
|---|---|---|
| GLM-5.2 | 智谱大模型 | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| 自定义 | 你的 | 任意 OpenAI 兼容端点 |

---

## 安全模型

- `nodeIntegration: false` — 渲染进程无法 `require('fs')`
- `contextIsolation: true` — 渲染进程 JS 与 preload 隔离
- `sandbox: true` — 渲染进程沙箱化运行
- 外部 URL 限制为 `http/https/mailto` 协议
- 所有 IPC handler 验证 sender 来源
- 所有危险操作（文件写入、命令执行）需显式批准

---

## 架构

```
electron/                  # Electron 主进程
├── main.ts                # 入口 + IPC handlers
├── preload.ts             # contextBridge API
├── agent/                 # Agent 循环、规划、工具（fs / shell / grep / git）
├── llm/                   # OpenAI 兼容客户端 + SSE 流式
├── memory/                # 持久化记忆存储
└── config/                # 加密密钥存储（safeStorage）
src/                       # React 渲染进程
├── components/            # 聊天、计划卡片、设置、引导、首页
├── styles/                # 设计变量 + 工作台 CSS
└── lib/                   # 渲染进程工具
shared/                    # 双向进程共享的 IPC 契约
```

技术栈：Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## 文档

- [macOS 迁移指南](../macos-migration.md)
- [贡献指南](../../CONTRIBUTING.md)
- [变更记录](../../CHANGELOG.md)

---

## 许可证

[MIT](../../LICENSE) © Stellara Work
