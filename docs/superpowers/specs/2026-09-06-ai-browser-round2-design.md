# 内置 AI 浏览器一期补齐：真多 Tab + 观察窗接入 + 快照刷新/链接安全

> 日期：2026-09-06
> 状态：已确认，待写实施计划
> 前置：`docs/superpowers/specs/2026-09-05-ai-browser-design.md`（一期已完成并合并）

## 1. 背景

一期（v0.9.3-dev）已交付 `web_search` + 7 个 `browser_*` 工具、隐藏窗口 Driver、强审批、SSRF 全链路、只读观察窗组件 `BrowserTab.tsx`。遗留缺口（最终评审记录）：

- **I2 多 Tab 只是记账**：`BrowserService` 每 session 只有一个隐藏窗口，`browser_tabs create/select` 只改 TabPool 元数据，snapshot/extract/screenshot 永远读同一窗口 DOM，切 Tab 不切页面。
- **观察窗未接入 UI**：`BrowserTab.tsx` 已建但未挂载到任何页面，用户看不到 Agent 的浏览过程。
- **快照不实时刷新**：快照 effect 只依赖 `activeId`，同 Tab 新 `browser_snapshot` 事件不触发重新加载。
- **链接无协议校验**：`MarkdownView` 的 `a` 组件直接 `target=_blank`，`javascript:` 等协议 href 未拦截。

## 2. 已确认决策

- A1：**每 Tab 一隐藏窗口**（上限 5），`select` 真实切换，快照/截图/动作精确对应 Tab。
- A2：观察窗挂**聊天区旁面板**，`browser_*` 活动时**自动展开**，手动收起后本轮不再自动弹出。
- A3：同 Tab snapshot 事件触发快照刷新；MarkdownView 链接协议硬化（全应用受益）。
- 不引入新依赖；继续遵循 sandbox/contextIsolation/partition 隔离与强审批。

## 3. A1 BrowserService 多 Tab 化

### 3.1 状态结构

```
windows:    Map<tabId, BrowserWindow>      // 每 Tab 一窗口（替代 Map<sessionId, window>）
activeTabs: Map<sessionId, tabId>          // 每会话当前活动 Tab
lastDomain: Map<tabId, string>             // 审批按 Tab 域名判新旧（替代按 session）
knownIds:   Map<tabId, Set<string>>        // 不变，仍按 tabId
tabPool:    TabPool                        // 不变，LRU 上限 5
```

### 3.2 行为

- `browser_navigate`（无 tabId）：`ensureTab` 创建 Tab + 创建窗口（partition 仍 `persist:stellara-browser-{sessionId}`，同会话共享 Cookie）；有 tabId：使用该 Tab 的窗口。
- `browser_tabs create`：建 Tab + 建窗口，返回 tab JSON。
- `browser_tabs select`：`activeTabs.set(sessionId, tabId)`，返回 tab JSON。
- `browser_tabs close`：`win.destroy()` + 清理 `knownIds`；若关闭的是活动 Tab，自动切到列表中最新的剩余 Tab。
- LRU 逐出：`TabPool.create` 改为返回 `{ tab, evicted? }`（被逐出的旧 Tab），service 同步 `destroy` 其窗口（防泄漏）。
- 所有 `navigate/snapshot/act/extract/screenshot/exec_js` 按 tabId 解析窗口；窗口缺失（已关/被逐出）→ 明确错误 `Tab 窗口不存在（可能已关闭或被逐出），请重新 browser_tabs create`。
- `stop()`（chat:abort）：对当前 session 活动 Tab 的窗口 `webContents.stop()`。
- 窗口总数 = Tab 数 ≤ 5；session 关闭/`doStop` 不销毁窗口（沿用一期语义，应用退出统一回收）。

### 3.3 测试

`service.test.ts` 用注入 fake window 工厂覆盖：Tab↔窗口一一对应、create 超限逐出并销毁窗口、close 清理 + active 转移、select 切换活动 Tab、窗口缺失错误路径。

## 4. A2 观察窗接入 + 自动展开

### 4.1 MainView 事件收集

- 新增 `browserEvents: ChatStreamEvent[]` 状态：stream 循环内仅收集 `tool_call`（name 以 `browser_` 开头）、`tool_result`（同上）、`browser_navigate/browser_snapshot/browser_screenshot` 事件；新 stream 开始与切换 session 时清空。
- 不保留全量流事件（防内存增长），只存 browser 相关。

### 4.2 面板挂载

- `BrowserTab` 挂聊天区旁面板（与 WorkspacePanel 并列区域），props 传入 `sessionId/streamId/browserEvents`。
- 自动展开：`browserEvents.length > 0` 且未被用户手动收起 → 面板展开；用户手动收起后本轮（同 stream）不再自动弹出；stream 结束或新 stream 开始恢复默认。
- 无浏览器活动时面板收起（不占空间）。

### 4.3 IPC 类型

- `ElectronAPI.browser.list` 返回项扩展 `active?: boolean`（当前活动 Tab 标记），BrowserTab 高亮显示；`BrowserService` 由 `activeTabs` 提供。

### 4.4 测试

`BrowserTab.test.tsx` 覆盖：面板自动展开/收起、active 高亮、事件驱动列表刷新（沿用现有事件收集路径）。

## 5. A3 快照刷新 + 链接安全

### 5.1 快照实时刷新

- BrowserTab 快照 effect 依赖增加 `snapshotTick`（browser_snapshot 结果事件计数，来自 `browserEvents`），同 Tab 新 snapshot 事件触发重新 `getSnapshot`。
- 保持 `activeId` 依赖（切 Tab 也刷新）。

### 5.2 MarkdownView 链接硬化（全应用）

- `a` 组件：`href` 协议非 `http:/https:/mailto:` 时渲染为纯文本（不生成链接），防 `javascript:` 等。
- 新增可选 prop `onAnchorClick?(href: string): void`：提供时点击先经此回调；BrowserTab 传入确认逻辑——协议校验通过后 `window.open(href, '_blank')`（主进程 `setWindowOpenHandler → isSafeExternalUrl` 兜底），非安全协议不打开。

### 5.3 测试

- `MarkdownView.test.tsx`：危险协议渲染为纯文本；`onAnchorClick` 回调触发。
- `BrowserTab.test.tsx`：同 Tab snapshot 事件后重新加载快照。

## 6. 文件触达清单

- 修改：`electron/browser/service.ts`（多 Tab 窗口化）、`electron/browser/tabs.ts`（create 返回 evicted）、`electron/browser/service.test.ts`、`src/components/BrowserTab.tsx`、`src/components/BrowserTab.test.tsx`、`src/components/MainView.tsx`（browserEvents 收集 + 面板挂载）、`src/components/MarkdownView.tsx`、`src/components/MarkdownView.test.tsx`、`shared/ipc.ts`（browser.list 返回 active）、`electron/main.ts`（browser:list 透传 active）、`electron/preload.ts`（无需改，类型透传）。
- 无新增依赖；无新 IPC 通道（复用 chat-stream + browser:list/getSnapshot）。