<p align="center">
  <img src="../../assets/icon-512.png" width="120" alt="Stellara Work" />
</p>

<h1 align="center">Stellara Work</h1>

<p align="center">
  <strong>本地優先的 Codex 風格桌面 Agent</strong>，支援 Windows 與 macOS。<br/>
  自帶 OpenAI 相容 API 金鑰——所有資料僅留在本機。
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README_zh-CN.md">简体中文</a> · <a href="README_ru.md">Русский</a> · <a href="README_fr.md">Français</a> · <a href="README_de.md">Deutsch</a> · <a href="README_es.md">Español</a> · <a href="README_pt-BR.md">Português</a> · <a href="README_ja.md">日本語</a> · <a href="README_ko.md">한국어</a> · <a href="README_ar.md">العربية</a>
</p>

---

**Stellara Work** 是一款**本地優先**的桌面 Agent，運作方式類似個人 Codex。自備 OpenAI 相容的 API 金鑰（`base_url + api_key`），在桌面工作台上與 Agent 協作完成編碼任務——讀取檔案、編輯程式碼、執行指令——全程可審閱、可批准。

API 金鑰、工作階段、檔案與設定**永遠不會離開本機**。Stellara Work 不會向外部伺服器上傳任何資料。

---

## 功能亮點

| | 功能 | 說明 |
|---|---|---|
| 🔒 | **本地隱私優先** | API 金鑰由系統鑰匙圈（macOS）/ DPAPI（Windows）加密；所有資料存於本機 |
| 🧠 | **自帶模型** | 相容任意 OpenAI 協定端點；內建 GLM、DeepSeek、Kimi、MiniMax 預設；支援無限自訂模型 |
| ✅ | **計畫模式 + 批准閘道** | 每次檔案寫入、指令執行都需你明確批准 |
| 💬 | **串流對話** | 即時 Markdown 渲染、diff 檢視與指令輸出卡片 |
| 🗂️ | **專案工作區** | 指向任意資料夾，Agent 在真實程式碼上讀寫與驗證 |
| 🧰 | **技能與 MCP** | 用自訂技能與 MCP 伺服器擴展 Agent 能力 |
| 🧠 | **記憶中心** | 跨工作階段持久、可搜尋的記憶 |
| 📎 | **附件** | 在任意工作階段中拖曳檔案與圖片 |
| 📂 | **檔案管理器** | 側欄檔案樹，支援新增檔案/資料夾 |
| 🎨 | **設計系統** | 統一的 UI 樣式變數與工作台設計 |

---

## 螢幕截圖

| 首頁 | 對話 | 設定 |
|:---:|:---:|:---:|
| ![首頁](../../assets/screenshots/home.png) | ![對話](../../assets/screenshots/chat.png) | ![設定](../../assets/screenshots/settings.png) |

---

## 下載

**最新版本：v0.9.1**

| 平台 | 安裝包 |
|---|---|
| macOS (Apple Silicon) | [Stellara Work-0.9.1-arm64.dmg](https://github.com/strashineltd/stellara-work/releases/latest) |
| Windows (x64) | [Stellara Work-Setup-0.9.1.exe](https://github.com/strashineltd/stellara-work/releases/latest) |

> **注意：** 目前安裝包未簽名。macOS 請右鍵 → 開啟；Windows 在 SmartScreen 中選擇「更多資訊 → 仍要執行」。

---

## 快速開始

### 環境需求

- Node.js 20+
- Windows：Python 3.x + Visual Studio Build Tools（桌面開發 C++）——僅首次 `npm install` 時需要
- macOS / Linux：無需額外安裝

### 1. 安裝相依套件

```bash
npm install
```

macOS/Linux 可使用 `bash setup.sh`（檢查 Node、安裝相依套件、執行測試）。

### 2. 啟動

```bash
npm run dev
```

首次啟動時依照引導選擇模型並填入 API 金鑰。金鑰加密儲存，僅主行程可讀取。

### 3. 常用腳本

```bash
npm run dev          # 開發模式（Vite HMR + Electron）
npm test             # 執行測試
npm run typecheck    # 型別檢查兩個行程
npm run package:mac  # 建置 macOS dmg/zip（僅 macOS）
npm run package:win  # 建置 Windows NSIS 安裝包
```

---

## 內建模型預設

| 模型 | 提供者 | base_url |
|---|---|---|
| GLM-5.2 | 智譜大模型 | `https://open.bigmodel.cn/api/paas/v4` |
| DeepSeek-v4-Pro | DeepSeek | `https://api.deepseek.com` |
| Kimi-K3 | Moonshot | `https://api.moonshot.cn` |
| MiniMax-M3 | MiniMax | `https://api.minimaxi.com/v1` |
| 自訂 | 你的 | 任意 OpenAI 相容端點 |

---

## 安全模型

- `nodeIntegration: false` — 渲染行程無法 `require('fs')`
- `contextIsolation: true` — 渲染行程 JS 與 preload 隔離
- `sandbox: true` — 渲染行程沙箱化執行
- 外部 URL 限制為 `http/https/mailto` 協定
- 所有 IPC handler 驗證 sender 來源
- 所有危險操作（檔案寫入、指令執行）需明確批准

---

## 架構

```
electron/                  # Electron 主行程
├── main.ts                # 進入點 + IPC handlers
├── preload.ts             # contextBridge API
├── agent/                 # Agent 迴圈、規劃、工具（fs / shell / grep / git）
├── llm/                   # OpenAI 相容用戶端 + SSE 串流
├── memory/                # 持久化記憶儲存
└── config/                # 加密金鑰儲存（safeStorage）
src/                       # React 渲染行程
├── components/            # 聊天、計畫卡片、設定、引導、首頁
├── styles/                # 設計變數 + 工作台 CSS
└── lib/                   # 渲染行程工具
shared/                    # 雙向行程共享的 IPC 契約
```

技術堆疊：Electron · React 19 · TypeScript · Vite · better-sqlite3 · CodeMirror 6

---

## 文件

- [macOS 遷移指南](../macos-migration.md)
- [貢獻指南](../../CONTRIBUTING.md)
- [變更記錄](../../CHANGELOG.md)

---

## 授權條款

[MIT](../../LICENSE) © Stellara Work
