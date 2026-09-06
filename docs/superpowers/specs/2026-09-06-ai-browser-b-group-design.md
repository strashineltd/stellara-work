# AI 浏览器 B 组：设置面板 + 数据清理 + 配额/容错打磨

> 日期：2026-09-06
> 状态：已确认，待写实施计划
> 前置：`docs/superpowers/specs/2026-09-05-ai-browser-design.md`（一期）、`docs/superpowers/specs/2026-09-06-ai-browser-round2-design.md`（二期，均已合并）

## 1. 背景

AI 浏览器一、二期已交付工具集、真多 Tab、观察窗。遗留（最终评审 + 后续搁置）：

- `execJsEnabled` 只有环境变量开关，无设置 UI；搜索 provider（Tavily/Brave）Key 只能手改配置文件。
- `settings:clearAllData / resetSelective('all')` 只清文件与 DB，不清浏览器 partition（Cookie/缓存残留）。
- `planModeTools` 缺 `web_search`（plan 模式无法搜索）。
- act 无频率限制（防抖）、SPA 页面导航后立即 snapshot 易取到未渲染 DOM。

## 2. 已确认决策

- B1：新建独立「AI 浏览器」设置面板（provider 下拉 + Key 输入，无测试按钮；execJsEnabled 开关）。
- B3：`BrowserService` 维护分区注册表，`clearAllData`/`resetSelective('all')` 时显式清分区。
- B4：act 防抖「间隔不足则报错」；SPA 等待用 navigate 后固定 2s 延迟（不做网络空闲判断）；planModeTools 补 web_search。
- 不引入新依赖；Key 永不回传明文；env 开关保留为兜底。

## 3. 配置与 IPC（backend）

### 3.1 config-v2

`app.browser` 扩展（现已有 `searchProvider?`）：

```ts
browser?: {
  searchProvider?: 'auto' | 'duck' | 'tavily' | 'brave';
  execJsEnabled?: boolean;
};
```

无迁移、schemaVersion 不变。

### 3.2 启动接线

`main.ts` app 就绪后读 config，`browserService.setExecJsEnabled(cfg.app.browser?.execJsEnabled)`；`browserService.isExecJsEnabled()` 优先级：注入值 > `STELLARA_BROWSER_JS=1` env。

### 3.3 新增 IPC（主进程 `handle` 走既有 trusted 包装）

| channel | 入参 | 返回 |
|---|---|---|
| `browser:getConfig` | — | `{ searchProvider: string; execJsEnabled: boolean; hasTavilyKey: boolean; hasBraveKey: boolean }`（Key 明文永不出主进程） |
| `browser:updateConfig` | `{ searchProvider?; execJsEnabled? }` | void；落 config-v2，广播 settings-changed |
| `browser:setSearchKey` | `provider: 'tavily' \| 'brave', key: string` | void；复用 secrets 命名空间 `browser-tavily` / `browser-brave` |
| `browser:clearSearchKey` | `provider: 'tavily' \| 'brave'` | void；deleteKey |

preload 暴露同名方法；shared/ipc.ts `ElectronAPI.browser` 扩展。dev-preview 补 stub。

### 3.4 测试

- config-v2.test：`browser.execJsEnabled` round-trip + 旧配置 undefined 兼容。
- secrets 命名空间复用无需新测试（既有 round-trip 覆盖）。

## 4. 设置面板 UI

- 新建 `src/components/settings/SettingsBrowserPanel.tsx` + `SettingsBrowserPanel.test.tsx`，注册进 `SettingsPanel` 导航（标签「AI 浏览器」，与 App/Models/Sessions/Skills/MCP/Shortcuts 并列）。
- 内容与行为：
  - **JS 执行**：checkbox「允许 Agent 执行页面 JS（高风险，仅建议对可信站点开启）」，变更 → `browser:updateConfig({ execJsEnabled })`。
  - **搜索服务**：下拉（自动 / DuckDuckGo（免 Key）/ Tavily / Brave）→ `browser:updateConfig({ searchProvider })`。
  - **Tavily / Brave Key**：password 输入 + 「保存」按钮 → `browser:setSearchKey`；已配置显示「✔ 已配置」+ 「清除」按钮 → `browser:clearSearchKey`。
  - 当前 provider 为 tavily/brave 且无对应 Key 时显示警告文案。
- 数据流：mount 读 `browser:getConfig` + `settings.get`；`app.onSettingsChanged` 刷新；样式沿用 token（深色跟随）。
- 测试：开关变更调 updateConfig；Key 保存调 setSearchKey；已配置态渲染 ✔ 与清除；tavily 无 Key 警告；下拉变更调 updateConfig。

## 5. clearAllData 清浏览器分区

- `BrowserService` 新增 `private createdPartitions = new Set<string>()`；`getOrCreateWindow` 创建窗口时 `createdPartitions.add('persist:stellara-browser-'+sanitizeSessionId(sessionId))`。
- 新方法 `clearPartitions(): Promise<void>`：对每个分区 `session.fromPartition(name).clearStorageData()` + `clearCache()`，逐项 try/catch（幂等）；清空后 `createdPartitions.clear()`。
- `main.ts`：`settings:clearAllData` 与 `settings:resetSelective('all')` 在 wipe 后 `await browserService.clearPartitions()`（失败记日志不阻断）。
- 测试：service 单测——分区注册（create 后 Set 含该分区名）、clearPartitions 调 fake session.clearStorageData/clearCache、异常时吞错。

## 6. 配额/容错（service.ts）

- **act 防抖**：`lastActAt = new Map<sessionId, number>()`；`doAct` 开头若距上次 <1000ms → `{ ok:false, error:'操作过于频繁（1 秒 1 次），请稍后重试' }`（不排队、不覆盖未知 action）；成功路径末尾记录时间。仅 act 限流，navigate/snapshot 不限。
- **SPA 等待**：`navDoneAt = new Map<tabId, number>()`；`doNavigate` 成功后记录；`doSnapshot/doExtract` 距 `navDoneAt.get(tabId)` < `opts.settleDelayMs` 时 `sleep(差值)`；`opts.settleDelayMs` 默认 2000，测试注入 0。
- **planModeTools 补 web_search**：`electron/agent/tools/index.ts` 的 `planModeTools` 加入 `webSearchTools[0]`。
- 测试：连续两次 act 第二次报错（fake timers 或间隔注入）；navigate→snapshot 用 settleDelayMs=0 直通 + 默认值路径用 fake timers 验证等待；planModeTools 含 web_search。

## 7. 文件触达清单

- 修改：`shared/ipc.ts`（browser IPC + ElectronAPI）、`electron/main.ts`（browser:getConfig/updateConfig/setSearchKey/clearSearchKey + 启动接线 + wipe 后清分区）、`electron/config/config-v2.ts`（execJsEnabled）、`electron/browser/service.ts`（分区注册/清理、防抖、SPA 等待、setExecJsEnabled）、`electron/agent/tools/index.ts`（planModeTools）、`electron/preload.ts`（IPC 转发）、`src/dev-preview.ts`（stub）、`src/components/SettingsPanel.tsx`（注册面板）、`electron/config/config-v2.test.ts`、`electron/browser/service.test.ts`。
- 新建：`src/components/settings/SettingsBrowserPanel.tsx` + `SettingsBrowserPanel.test.tsx`。
- 无新增依赖、无新协议通道（全走既有 IPC 封装）。