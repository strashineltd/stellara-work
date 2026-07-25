# Stellara Work

> 数据本地的 Codex 风格 Windows 桌面 Agent · **v0.9 内测版**

GLM-5.2 / DeepSeek-v4-Pro / Kimi-K3 / MiniMax-M3 + 自定义模型（OpenAI 兼容协议）

**完整规划**：见 [`plan.md`](./plan.md)

---

## 当前进度

- ✅ **W1** - 后端核心闭环（本仓库当前状态）
- ⏳ W2 - 桌面壳 + 聊天 UI
- ⏳ W3 - 数据本地 + 体验收尾

---

## 技术栈

- **桌面壳**：Electron 32+（Node.js + Chromium）
- **前端**：React 18 + TypeScript + Vite
- **后端**：Node.js + TypeScript（主进程）
- **LLM 客户端**：fetch + eventsource-parser（OpenAI 兼容）
- **存储**：better-sqlite3
- **配置**：dotenv + JSON
- **打包**：electron-builder + NSIS

---

## 快速开始

### 1. 装依赖

```powershell
# Windows PowerShell
npm install
```

> ⚠️ 首次 `npm install` 会编译 `better-sqlite3`（原生模块），需要：
> - Node.js 20+（已验证 v24.14.1）
> - Python 3.x
> - Visual Studio Build Tools（"使用 C++ 的桌面开发"工作负载）

### 2. 配置模型

**首次启动引导**（UI 推荐）：直接 `npm run dev`，在 onboarding 流程里选模型 + 填 API key。

**手动配置**（开发期）：

1. 创建 `~/.stellara/.env`：
   ```env
   # Stellara Work API keys
   OPENAI_API_KEY=sk-xxx
   ```

2. 创建 `~/.stellara/config.json`：
   ```json
   {
     "id": "deepseek-v4-pro",
     "label": "DeepSeek-v4-Pro",
     "baseUrl": "https://api.deepseek.com",
     "model": "deepseek-v4-pro",
     "apiKey": "sk-xxx",
     "isCustom": false
   }
   ```

### 3. 跑起来

```powershell
# 开发模式（Vite HMR + Electron）
npm run dev

# W1 验收脚本（不打开 Electron，跑通后端 agent 循环）
npm run verify:w1

# 跑测试
npm test
```

---

## 目录结构

```
stellara-work/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 入口 + IPC handlers
│   ├── preload.ts               # contextBridge 暴露
│   ├── agent/                   # Agent 循环 + Tools
│   │   ├── loop.ts
│   │   ├── plan.ts
│   │   └── tools/
│   │       ├── fs.ts            # read / write / edit
│   │       ├── shell.ts         # run_command
│   │       └── search.ts        # search_files
│   ├── llm/                     # LLM 客户端
│   │   ├── openai-compat.ts     # OpenAI 兼容协议 + SSE
│   │   ├── endpoint.ts          # base_url 拼接
│   │   └── presets.ts           # 4 内置 + 1 自定义
│   └── config/                  # .env / config.json 加载
├── src/                         # React 渲染进程
│   ├── App.tsx
│   ├── main.tsx
│   └── styles/
├── shared/                      # 主/渲染进程共享类型
│   └── ipc.ts                   # IPC 接口定义
├── scripts/
│   └── verify-w1.ts             # W1 验收脚本
├── assets/
│   ├── icon.jpg                 # 产品图标
│   └── build-icons.ps1          # 多尺寸图标生成
├── plan.md                      # 完整规划文档
└── package.json
```

---

## 内置模型预设

| 模型 | 厂商 | base_url |
|------|------|----------|
| **GLM-5.2** | 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` |
| **DeepSeek-v4-Pro** | DeepSeek | `https://api.deepseek.com` |
| **Kimi-K3** | 月之暗面 Moonshot | `https://api.moonshot.cn` |
| **MiniMax-M3** | MiniMax | `https://api.minimaxi.com/v1` |
| **自定义** | 用户填 | 任意 OpenAI 兼容 base_url |

---

## 安全模型

- `nodeIntegration: false` - 渲染进程不能 `require('fs')`
- `contextIsolation: true` - 渲染进程 JS 与 preload 隔离
- `sandbox: true` - 渲染进程跑沙箱
- API key 永远在主进程，渲染进程通过 IPC 调用拿不到 key
- 所有危险操作（写文件、shell）走批准流程

---

## License

UNLICENSED · 个人项目

## W1 verify at 2026-07-25T03:56:15.738Z

## W1 verify at 2026-07-25T03:56:15.739Z

## W1 verify at 2026-07-25T03:56:12.819Z

## W1 verify at 2026-07-25T03:56:20.824Z

## W1 verify at 2026-07-25T03:56:20.746Z

## W1 verify at 2026-07-25T03:56:32.470Z

## W1 verify at 2026-07-25T03:56:32.417Z

## W1 verify at 2026-07-25T03:56:38.905Z
## W1 verify at 2026-07-25T03:55:27.443Z
## W1 verify at 2026-07-25T03:56:42.452Z
## W1 verify at 2026-07-25T03:56:42.504Z
## W1 verify at 2026-07-25T03:56:40.739Z
## W1 verify at 2026-07-25T03:56:42.992Z

## W1 verify at 2026-07-25T03:56:41.638Z

## W1 verify at 2026-07-25T03:56:40.286Z

## W1 verify at 2026-07-25T03:56:47.379Z

## W1 verify at 2026-07-25T03:56:46.321Z

## W1 verify at 2026-07-25T03:56:54.317Z

## W1 verify at 2026-07-25T03:56:51.218Z

## W1 verify at 2026-07-25T03:56:59.461Z

## W1 verify at 2026-07-25T03:56:56.774Z

## W1 verify at 2026-07-25T03:57:15.557Z
## W1 verify at 2026-07-25T03:56:05.842Z

## W1 verify at 2026-07-25T03:57:10.201Z

## W1 verify at 2026-07-25T03:57:19.900Z
## W1 verify at 2026-07-25T03:56:08.461Z

## W1 verify at 2026-07-25T03:57:14.827Z

## W1 verify at 2026-07-25T03:57:24.629Z

## W1 verify at 2026-07-25T03:57:43.320Z

## W1 verify at 2026-07-25T03:57:41.699Z

## W1 verify at 2026-07-25T03:57:40.583Z

## W1 verify at 2026-07-25T03:57:46.085Z

## W1 verify at 2026-07-25T03:57:53.724Z

## W1 verify at 2026-07-25T03:57:52.219Z
## W1 verify at 2026-07-25T03:57:56.848Z
## W1 verify at 2026-07-25T03:57:59.656Z

## W1 verify at 2026-07-25T03:57:59.710Z

## W1 verify at 2026-07-25T03:57:59.641Z
## W1 verify at 2026-07-25T03:57:56.430Z

## W1 verify at 2026-07-25T03:57:57.879Z

## W1 verify at 2026-07-25T03:57:56.933Z

## W1 verify at 2026-07-25T03:58:26.725Z

## W1 verify at 2026-07-25T03:58:26.737Z

## W1 verify at 2026-07-25T03:58:27.378Z

## W1 verify at 2026-07-25T03:58:37.691Z

## W1 verify at 2026-07-25T03:58:36.480Z

## W1 verify at 2026-07-25T03:58:25.176Z

## W1 verify at 2026-07-25T03:58:41.955Z

## W1 verify at 2026-07-25T03:58:44.644Z

## W1 verify at 2026-07-25T03:58:49.537Z

## W1 verify at 2026-07-25T03:58:45.319Z

## W1 verify at 2026-07-25T03:58:52.419Z
## W1 verify at 2026-07-25T03:59:11.869Z

## W1 verify at 2026-07-25T03:59:03.522Z

## W1 verify at 2026-07-25T03:59:14.828Z

## W1 verify at 2026-07-25T03:59:14.802Z

## W1 verify at 2026-07-25T03:59:21.299Z

## W1 verify at 2026-07-25T03:59:20.838Z

## W1 verify at 2026-07-25T03:59:20.365Z

## W1 verify at 2026-07-25T03:59:18.208Z
## W1 verify at 2026-07-25T03:59:23.619Z

## W1 verify at 2026-07-25T03:58:52.344Z

## W1 verify at 2026-07-25T03:59:25.834Z
## W1 verify at 2026-07-25T03:59:24.059Z

## W1 verify at 2026-07-25T03:59:24.001Z
## W1 verify at 2026-07-25T03:59:31.598Z

## W1 verify at 2026-07-25T03:59:29.544Z

## W1 verify at 2026-07-25T03:59:29.260Z

## W1 verify at 2026-07-25T03:59:36.720Z

## W1 verify at 2026-07-25T03:59:37.201Z

## W1 verify at 2026-07-25T03:59:37.062Z

## W1 verify at 2026-07-25T03:59:34.503Z

## W1 verify at 2026-07-25T03:59:33.411Z

## W1 verify at 2026-07-25T03:59:33.998Z

## W1 verify at 2026-07-25T03:59:37.973Z

## W1 verify at 2026-07-25T03:59:37.909Z

## W1 verify at 2026-07-25T03:59:46.951Z
## W1 verify at 2026-07-25T03:59:44.777Z

## W1 verify at 2026-07-25T03:59:45.890Z

## W1 verify at 2026-07-25T03:59:44.342Z

## W1 verify at 2026-07-25T03:59:54.141Z

## W1 verify at 2026-07-25T04:00:00.303Z

## W1 verify at 2026-07-25T04:00:11.649Z
## W1 verify at 2026-07-25T04:00:21.502Z

## W1 verify at 2026-07-25T03:59:52.852Z

## W1 verify at 2026-07-25T04:00:39.585Z

## W1 verify at 2026-07-25T04:01:00.635Z
## W1 verify at 2026-07-25T04:01:01.965Z

## W1 verify at 2026-07-25T04:01:01.969Z

## W1 verify at 2026-07-25T04:00:58.596Z

## W1 verify at 2026-07-25T04:00:54.147Z

## W1 verify at 2026-07-25T04:01:08.587Z

## W1 verify at 2026-07-25T04:01:07.441Z

## W1 verify at 2026-07-25T04:01:06.306Z

## W1 verify at 2026-07-25T04:01:07.229Z
## W1 verify at 2026-07-25T04:01:05.341Z

## W1 verify at 2026-07-25T04:01:04.699Z

## W1 verify at 2026-07-25T04:01:11.111Z

## W1 verify at 2026-07-25T04:01:14.117Z

## W1 verify at 2026-07-25T04:01:10.775Z

## W1 verify at 2026-07-25T04:01:23.780Z

## W1 verify at 2026-07-25T04:01:24.297Z

## W1 verify at 2026-07-25T04:01:24.061Z

## W1 verify at 2026-07-25T04:01:23.225Z

## W1 verify at 2026-07-25T04:01:30.810Z

## W1 verify at 2026-07-25T04:00:37.557Z

## W1 verify at 2026-07-25T04:01:40.166Z

## W1 verify at 2026-07-25T04:01:38.775Z

## W1 verify at 2026-07-25T04:01:40.544Z

## W1 verify at 2026-07-25T04:01:42.103Z

## W1 verify at 2026-07-25T04:01:43.162Z

## W1 verify at 2026-07-25T04:01:57.874Z
## W1 verify at 2026-07-25T04:01:52.944Z

## W1 verify at 2026-07-25T04:02:26.583Z

## W1 verify at 2026-07-25T04:02:17.827Z

## W1 verify at 2026-07-25T04:02:40.796Z

## W1 verify at 2026-07-25T04:02:40.824Z

## W1 verify at 2026-07-25T04:02:40.165Z
## W1 verify at 2026-07-25T04:02:36.884Z

## W1 verify at 2026-07-25T04:02:37.695Z

## W1 verify at 2026-07-25T04:02:37.089Z

## W1 verify at 2026-07-25T04:02:37.002Z

## W1 verify at 2026-07-25T04:02:46.478Z

## W1 verify at 2026-07-25T04:02:48.291Z

## W1 verify at 2026-07-25T04:02:46.233Z

## W1 verify at 2026-07-25T04:02:47.725Z

## W1 verify at 2026-07-25T04:02:46.210Z

## W1 verify at 2026-07-25T04:02:45.629Z

## W1 verify at 2026-07-25T04:02:46.381Z

## W1 verify at 2026-07-25T04:02:45.121Z

## W1 verify at 2026-07-25T04:02:44.212Z

## W1 verify at 2026-07-25T04:02:44.015Z

## W1 verify at 2026-07-25T04:02:52.985Z

## W1 verify at 2026-07-25T04:02:53.812Z

## W1 verify at 2026-07-25T04:02:53.569Z

## W1 verify at 2026-07-25T04:02:54.222Z

## W1 verify at 2026-07-25T04:02:50.104Z

## W1 verify at 2026-07-25T04:02:52.648Z
## W1 verify at 2026-07-25T04:02:49.888Z

## W1 verify at 2026-07-25T04:02:49.701Z

## W1 verify at 2026-07-25T04:02:49.774Z

## W1 verify at 2026-07-25T04:02:54.296Z

## W1 verify at 2026-07-25T04:02:55.575Z

## W1 verify at 2026-07-25T04:03:11.079Z

## W1 verify at 2026-07-25T04:03:28.714Z

## W1 verify at 2026-07-25T04:02:13.115Z

## W1 verify at 2026-07-25T04:03:47.313Z

## W1 verify at 2026-07-25T04:03:47.171Z

## W1 verify at 2026-07-25T04:03:55.072Z

## W1 verify at 2026-07-25T04:04:06.257Z
