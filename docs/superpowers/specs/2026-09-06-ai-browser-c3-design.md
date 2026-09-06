# AI 浏览器 C3：浏览记忆（会话末并入提取 + web kind）

> 日期：2026-09-06
> 状态：已确认，待写实施计划
> 前置：一期/二期/B0/B 组/C1/C2 均已合并（base `ad45b8b`）

## 1. 背景

Agent 通过 `web_search` / `browser_*` 工具获取了大量网页信息，但会话结束后现有记忆提取只分析 user/assistant 消息——浏览成果随会话丢失，无法跨会话复用。需要把浏览材料并入现有记忆提取链路。

## 2. 已确认决策

- 提取时机/粒度：**会话末并入现有 `extractMemories` 流程**（不逐页即时提取）。
- 记忆建模：**新增 `kind: 'web'`**（零迁移，kind 为 TEXT 列无 CHECK 约束；FTS5 无 kind 列）。
- 材料范围：**工具结果全量喂入**（成功的 `web_search`/`browser_*` 工具结果，含不可信 marker 文本），总量 30k 字符截断。
- 不引入新依赖；不新增 IPC 通道；复用现有 `memory_store` / `memory-extractor` / 会话末提取钩子。

## 3. 提取链路扩展

### 3.1 memory-extractor

`extractMemories` 新增可选参数：

```ts
browserMaterial?: string
```

- 存在时附加到 transcript 之后：`\n\n--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---\n{browserMaterial}`。
- `EXTRACTION_PROMPT` 扩展：
  - kind 列表：`"fact" | "preference" | "decision" | "codebase" | "requirement" | "meeting" | "web"`
  - 新增「要提取」条目：`web：网页浏览材料中值得长期记忆的调研结论/事实（tags 含来源站点与话题）`
  - 新增规则：`web 条目必须来自浏览材料；不要根据对话内容凭空总结网页`
- 合法 kind 校验数组加入 `'web'`（`memory-extractor.ts:80`）。

### 3.2 材料构建（main.ts 提取钩子）

- 新增纯函数 `buildBrowserMaterial(messages: MessageRow[]): string`（放 `memory-extractor.ts`，便于单测）：
  - 过滤 `role === 'tool'` 且 `toolName` 为 `web_search` 或以 `browser_` 开头。
  - 仅成功结果（`meta` 中 `ok !== false`；无 meta 的工具消息保留）。
  - 每行前缀 `[工具名] `。
  - 拼接后超过 30_000 字符截断（保留头部，尾部追加 `…[已截断]`）。
  - 空返回 `''`。
- `extractMemoriesFromSession` 调用 `extractMemories` 时传入 `buildBrowserMaterial(messages)`；无浏览材料时不改变现有行为。

## 4. 记忆建模

- `shared/ipc.ts` `Memory['kind']` 加 `'web'`（`MemoryKind` 类型注释同步）。
- `memory-store` 无需改动（kind 存 TEXT，查询过滤参数透传）。
- `memory-extractor` 合法 kind 列表加 `'web'`（§3.1）。
- 渲染层检查 `MemoryCenter` 是否按 kind 分组展示；若是，将 `web` 归入新「网页」组（或并入事实组——实施时按现有分组结构选最小方案并记录）。
- 测试：`memory-store` 以 kind='web' 保存/搜索/按 kind 过滤 round-trip；`memory-extractor` 合法 kind 校验放行 web。

## 5. 测试汇总

- memory-extractor.test（如有）：browserMaterial 拼接格式、prompt 含 web 规则、web kind 放行。
- 新增 `buildBrowserMaterial` 单测：工具名过滤（web_search/browser_* 收、read_file 不收）、失败结果跳过、无 meta 保留、前缀格式、30k 截断、空输入返回 ''。
- MemoryCenter kind 分组（若改动）对应测试。
- 全量 `npm test` + typecheck 绿。

## 6. 文件触达清单

- 修改：`electron/memory/memory-extractor.ts`（browserMaterial 参数 + prompt + kind 校验 + buildBrowserMaterial 导出）、`shared/ipc.ts`（kind 加 'web'）、`electron/main.ts`（extractMemoriesFromSession 传材料）、`src/components/memory/MemoryCenter.tsx`（若按 kind 分组，web 归组）、对应测试文件。
- 无新增依赖、无新 IPC 通道。

## 7. 非目标

- 不做逐页即时提取、不做访问日志表、不做浏览记忆专属 UI（记忆中心复用现有列表/检索）。
- 不把浏览材料注入 Agent 上下文（只进记忆提取）。
- 截图/失败结果/导航确认类内容不特殊处理（按 §3.2 规则统一过滤）。