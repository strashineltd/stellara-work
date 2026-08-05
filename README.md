# Stellara Work
> 数据本地的 Codex 风格桌面 Agent（Windows / macOS） · **v0.9 内测版**
GLM-5.2 / DeepSeek-v4-Pro / Kimi-K3 / MiniMax-M3 + 自定义模型（OpenAI 兼容协议）
**完整规划**：见 [`plan.md`](./plan.md)
---
## 当前进度
- ✅ **W1** - 后端核心闭环（agent 循环 / tools / LLM 客户端）
- ✅ **W2** - 桌面壳 + 聊天 UI（流式聊天、计划模式 + 批准门禁、diff/shell 卡片、命令面板）
- ✅ **W3** - 数据本地 + 体验收尾（onboarding、设置、会话存储与恢复、上下文压缩、NSIS 打包）
- ⏳ v0.9 内测打磨中
---
## 技术栈
- **桌面壳**：Electron 32+（Node.js + Chromium）
- **前端**：React 18 + TypeScript + Vite
- **后端**：Node.js + TypeScript（主进程）
- **LLM 客户端**：fetch + eventsource-parser（OpenAI 兼容）
- **存储**：better-sqlite3
- **配置**：dotenv + JSON
- **打包**：electron-builder（Windows NSIS / macOS dmg+zip 双架构）
---
## 快速开始
### 1. 装依赖
```powershell
# Windows PowerShell
npm install
```
```bash
# macOS / Linux
bash setup.sh
# 或手动：npm install（better-sqlite3 自带 darwin prebuilds，无需编译）
```
> ⚠️ （仅 Windows）首次 `npm install` 会编译 `better-sqlite3`（原生模块），需要：
> - Node.js 20+（已验证 v24.14.1）
> - Python 3.x
> - Visual Studio Build Tools（"使用 C++ 的桌面开发"工作负载）
### 2. 配置模型
**首次启动引导**（UI 推荐）：直接 `npm run dev`，在 onboarding 流程里选模型 + 填 API key。
**手动配置**（开发期）：应用配置存 `~/.stellara/config.json`（模型列表 + 活跃模型），API key 存 `~/.stellara/.env`（仅主进程读写）：
```json
{
  "activeModelId": "deepseek-v4-pro",
  "models": [
    {
      "id": "deepseek-v4-pro",
      "label": "DeepSeek-v4-Pro",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-v4-pro"
    }
  ]
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
## 跨平台
**数据位置**：

| 平台 | 数据目录 | 日志 |
|------|----------|------|
| Windows | `%APPDATA%\Stellara Work`（旧版 `~/.stellara`） | `%APPDATA%\Stellara Work\logs` |
| macOS | `~/Library/Application Support/Stellara Work` | `~/Library/Logs/Stellara Work/main.log` |

**打包**：
- `npm run package:mac` — 产出 macOS dmg/zip（x64 + arm64），只能在 macOS 上构建
- `npm run package:win` — 在 macOS 上交叉构建 Windows NSIS 安装包；无签名证书时设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`

**数据迁移**：旧 `~/.stellara` 数据（config.json + .env）在首次启动时自动迁移到当前平台的数据目录。macOS 迁移与常见问题详见 [`docs/macos-migration.md`](./docs/macos-migration.md)。
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
