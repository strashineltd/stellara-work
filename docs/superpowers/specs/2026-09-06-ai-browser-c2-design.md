# AI 浏览器 C2：Cookie 登录态保留策略（允许列表 + 退出清理）

> 日期：2026-09-06
> 状态：已确认，待写实施计划
> 前置：一期/二期/B0/B 组/C1 均已合并（base `41a652b`）

## 1. 背景

浏览器分区使用 `persist:stellara-browser-{sessionId}`（持久分区），Cookie 目前永久保留，只有 `clearAllData`/`resetSelective('all')` 时整体清空。Agent 在浏览/填表/登录场景中会积累大量站点 Cookie——包括仅一次性使用的站点。需要可管理的登录态保留策略：**允许列表 + 退出清理**。

## 2. 已确认决策

- 保留模型：**允许列表（allowlist）+ 退出清理**。允许列表中的站点 Cookie 永久保留；其余站点在应用退出时清除。
- 允许列表维护：**设置面板**（SettingsBrowserPanel 扩展），手动输入域名 + chips 删除。
- 清理时机：**app 退出时**（before-quit），仅清非允许列表站点的 Cookie；不清允许列表站点、不清 storage（localStorage 等）——本次只处理 Cookie。
- 不引入新依赖；不新增 IPC 通道（复用 `browser:getConfig` / `browser:updateConfig`）。

## 3. 配置与 IPC

### 3.1 config-v2

`app.browser` 扩展（现有 `searchProvider?` / `execJsEnabled?` 之外）：

```ts
loginAllowlist?: string[];
```

规范化规则：存储前每个域名 `trim().toLowerCase()`，去除协议（`https://`、`http://`）、路径、端口、尾点；空项剔除；去重。非法格式（含空白、非域名字符）整批拒绝。

### 3.2 IPC（复用 B 组通道）

- `browser:getConfig` 返回新增 `loginAllowlist: string[]`。
- `browser:updateConfig` 接受 `loginAllowlist?: string[]`：非 undefined 时校验整批（`Array.isArray` + 每项通过 `normalizeAllowlistDomain` 返回合法结果），非法抛 `'无效的登录保留域名'`；合法则规范化为小写域名数组保存并广播。

### 3.3 测试

- config-v2 round-trip：loginAllowlist 保存/加载。
- 规范化纯函数矩阵：协议/路径/端口剥离、小写化、空项剔除、去重、非法输入返回失败。

## 4. Cookie 过滤（BrowserService）

### 4.1 新方法

```ts
clearNonAllowlistedCookies(allowlist: string[]): Promise<void>
```

行为：
- 遍历 `partitionSessions`（含 createdPartitions 兜底 `session.fromPartition`）。
- `session.cookies.get({})` → 对每个 cookie 取 `cookie.domain`（可能带前导点，如 `.github.com`），规范化后判断是否命中 allowlist：允许项 `a.com` 匹配 cookie 域 `a.com` 与 `x.a.com`（后缀匹配，含子域）。
- 未命中的 cookie：`session.cookies.remove(url, name)`，url 按 cookie 的 `secure`/`domain`/`path` 构造（`(cookie.secure ? 'https://' : 'http://') + cookie.domain + cookie.path`）。
- 逐分区 try/catch（沿用 `onPartitionClearError` 注入模式上报错误，不阻断）。
- 幂等、无状态副作用；允许列表为空时 = 清所有 Cookie。

### 4.2 退出钩子（main.ts）

```ts
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void (async () => {
    try {
      const { loadConfig } = await import('./config/config-v2');
      const { browserService } = await import('./browser/service');
      const cfg = await loadConfig();
      await browserService.clearNonAllowlistedCookies(cfg.app?.browser?.loginAllowlist ?? []);
    } catch (err) {
      log.warn('退出时清理 Cookie 失败（忽略）', err);
    } finally {
      app.quit();
    }
  })();
});
```

- 防重入 flag（`quitting`）避免递归 quit。
- 清理失败记日志仍正常退出。

### 4.3 测试

service 单测（注入 fake partitionSessions + fake `session.cookies`）：
- 精确匹配保留（`github.com` in allowlist → `.github.com` cookie 保留）。
- 子域匹配保留（allowlist `github.com` → `x.github.com` 保留）。
- 非列表 cookie 被 remove（断言 remove 调用参数 url/name）。
- secure cookie 用 https 前缀构造 url。
- 允许列表为空 → 全部 remove。
- 单分区 cookies.get 抛错 → 上报 onPartitionClearError，不阻断其他分区。

## 5. 设置 UI（SettingsBrowserPanel 扩展）

新增「登录保留站点」区块（置于搜索服务之后）：

- 域名输入框（placeholder `例如 github.com`）+「添加」按钮。
- 添加：`browser:updateConfig({ loginAllowlist: [...当前, 规范化域名] })`；非法输入内联错误提示（复用 error 展示模式），不提交。
- 已存列表：chips，每项带删除按钮 → `browser:updateConfig({ loginAllowlist: 过滤后 })`。
- 说明文案：`这些站点的登录状态会在退出应用时保留，其他站点的 Cookie 会在退出时自动清除`。
- 数据流：mount 时 `browser:getConfig` 已含 loginAllowlist；变更后本地 state 同步 + onSettingsChanged。

测试（SettingsBrowserPanel.test.tsx 追加）：
- 添加合法域名 → updateConfig 收到含新域名的数组。
- 非法输入（`https://a b.com`、空）→ 不调 updateConfig，显示错误。
- 删除 chip → updateConfig 收到过滤后数组。

## 6. 文件触达清单

- 修改：`electron/config/config-v2.ts`（loginAllowlist + 规范化辅助）、`electron/config/config-v2.test.ts`、`electron/browser/service.ts`（clearNonAllowlistedCookies）、`electron/browser/service.test.ts`、`electron/main.ts`（before-quit 钩子 + getConfig/updateConfig 扩展）、`shared/ipc.ts`（BrowserConfigView + updateConfig 类型）、`src/components/settings/SettingsBrowserPanel.tsx` + 测试。
- 无新增依赖、无新 IPC 通道。

## 7. 非目标

- 不清 localStorage / IndexedDB / cache（仅 Cookie）。
- 不做 Agent 自动收集允许列表、不做站点级 UI 管理、不做按时间过期。
- 允许列表变更立即生效（下次退出生效），不热迁移已存 Cookie。