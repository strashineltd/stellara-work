# AI 浏览器 L3：观察窗实时画面（WebContentsView 嵌入 + 只读守卫 + 接管）

> 日期：2026-09-07
> 状态：已确认，待写实施计划
> 前置：一期/二期/B0/B 组/C1/C2/C3 均已合并（base `a217f83`）

## 1. 背景

观察窗目前只展示文本快照 + 截图，用户看不到网页的真实画面。一期 L3 的完整愿景是「面板内实时画面」：把 Agent 正在操作的网页实时渲染到观察窗区域。Electron 中 `BrowserWindow` 无法嵌入宿主窗口，因此窗口池需改用 `WebContentsView`。

## 2. 已确认决策

- 形态：**面板内实时画面**——窗口池改用 `WebContentsView` 挂主窗口 contentView，观察窗区域内定位。
- 用户权限：**默认只读 + 接管按钮**——实时画面默认拦截用户输入，接管后可交互；Agent 发起 `browser_*` 动作时自动收回接管权。
- 视图关系：**双视图切换**——「实时画面 / 快照」Tab 并存，截图保留在快照视图；默认快照视图。
- 不引入新依赖；Agent 工具语义/审批/SSRF/分区全部不变。

## 3. 窗口架构改造（BrowserService）

### 3.1 视图池

- `getOrCreateWindow(sessionId, tabId)`：生产路径 `new electron.WebContentsView({ webPreferences: 同现有 })` 替代 `BrowserWindow`；测试注入 `createWindow` 工厂不变（fake 形状兼容——`webContents` API 相同）。
- WebContentsView 默认**不附着**到任何窗口：加载/快照/act/截图照常工作（无窗口也可运行）。
- SSRF 钩子、`setWindowOpenHandler(()=>deny)`、`will-download preventDefault`、`did-finish-load` 行为全部保持。

### 3.2 附着与定位

- `opts.getContentView?: () => any`（main.ts 注入 `mainWindow.contentView`；测试注入 fake）。无 getContentView 时附着类操作返回错误 `'主窗口不可用'`。
- `attachView(tabId)`：校验 tab 归属 → 若已有附着视图先 detach → `contentView.addChildView(view)` + 按最近 `setViewport` 的矩形 `view.setBounds(...)`；记录 `attachedTabId`。
- `detachView()`：`contentView.removeChildView(view)`，清 `attachedTabId`（视图池不销毁）。
- `setViewport(rect: {x,y,width,height})`：保存最近矩形；若当前有附着视图立即 `view.setBounds(rect)`。
- 切 Tab（`browser_tabs select`）：若附着中，detach 旧 + attach 新（保持实时跟随）。
- Tab 关闭/逐出：若附着先 detach，再 destroy。
- 生命周期不变：`clearPartitions`、`chat:abort` stop、before-quit Cookie 清理。

### 3.3 只读守卫与接管

- 守卫脚本常量 `READONLY_GUARD_SCRIPT`（导出供单测）：在 isolated world 对 document 以 capture 注册 `mousedown/mouseup/mousemove/click/dblclick/contextmenu/wheel/keydown/keyup/keypress/input` 监听，回调内 `stopPropagation()` + `preventDefault()`；脚本根据 `window.__stellaraReadonly` 标志决定是否拦截（标志由注入代码设置为 true）。
- 注入时机：`getOrCreateWindow` 后、以及每次 `did-finish-load` 后 `executeJavaScriptInIsolatedWorld(999, [...])` 注入守卫。
- 「接管」= `setUserInteraction(tabId, true)`：向页面注入 `window.__stellaraReadonly = false` + `webContents.focus()`；「交还」= 注入 `window.__stellaraReadonly = true`。守卫监听器持续在位，仅读标志。
- Agent 的 `executeJavaScriptInIsolatedWorld` 调用与守卫同处 isolated world——守卫只拦 DOM 事件，不拦脚本调用，Agent 不受影响。

## 4. IPC

| channel | 入参 | 行为 |
|---|---|---|
| `browser:attachView` | `tabId: string` | 校验归属 → detach 旧 → addChildView + setBounds |
| `browser:detachView` | — | removeChildView |
| `browser:setViewport` | `{x,y,width,height}` | 记录矩形；附着中则 setBounds |
| `browser:setUserInteraction` | `tabId: string, enabled: boolean` | 注入 readonly 标志 + focus |

均走 trusted `handle` 包装；preload / dev-preview stub 同步扩展。

## 5. UI（BrowserTab 双视图）

- 面板头部加视图切换 Tab：「实时画面 / 快照」，默认快照；`viewMode` state。
- 实时视图：占位容器 div（flex:1 占满面板剩余高度）；`useEffect` 挂载时 `browser:attachView(selectedId)` + `ResizeObserver` 量容器 rect（相对窗口 content 区，CSS px ≈ DIP）→ `browser:setViewport(rect)`；卸载/切 Tab/切快照/收起 → `browser:detachView()`。
- 接管：actions 行新增「接管交互 / 交还 Agent」按钮（仅实时视图渲染）；点击调 `browser:setUserInteraction(selectedId, enabled)`；收到 `browser_*` 的 `tool_call` 事件自动置回只读并同步按钮态。
- 快照视图：现有 Markdown + 截图逻辑不动。
- 会话切换/面板收起：MainView 现有清空逻辑触发 BrowserTab 卸载 → detach（含 useEffect cleanup）。

## 6. 测试

- service（注入 fake contentView + createWindow）：attach 后 addChildView/setBounds 调用与参数；detach 后 removeChildView；未设 getContentView 时 attach 报错；setViewport 记录并在 attach 时应用；切 Tab 自动换绑；关 Tab 先 detach 再 destroy；守卫脚本常量包含事件名单与标志读写；setUserInteraction 注入标志。
- BrowserTab.test：默认快照视图；切实时调 attachView + setViewport（ResizeObserver mock）；切回快照/卸载调 detachView；接管按钮调 setUserInteraction；`browser_*` tool_call 事件自动收回接管；快照视图现有测试全绿。
- 全量 `npm test` + typecheck。

## 7. 文件触达清单

- 修改：`electron/browser/service.ts`（WebContentsView + attach/detach/setViewport/setUserInteraction + 守卫脚本 + did-finish-load 注入）、`electron/browser/service.test.ts`、`shared/ipc.ts`（4 个新方法）、`electron/main.ts`（4 个 handler + whenReady 注入 getContentView）、`electron/preload.ts`、`src/dev-preview.ts`、`src/components/BrowserTab.tsx` + 测试。
- 无新增依赖。

## 8. 非目标

- 不做地址栏/手动导航/书签历史（仍由 Agent 驱动导航）。
- 不做多视图同屏（同一时刻只附着活动 Tab 一个视图）。
- 不做视图内右键菜单定制、开发者工具、缩放控制。
- 快照/实时不做画中画或分屏。