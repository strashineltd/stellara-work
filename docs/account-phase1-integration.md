# 账号体系 Phase 1 · 本地身份 · 合并指引

> 本文档由 AI 生成，用于把「本地用户体系」接入 Stellara Work。
> **状态：已由 AI 全部实施完毕（8 个现有文件 / 15 处补丁）。`npm run typecheck` 与全量 `vitest run` 均通过。**
> 以下的 before → after 记录保留，供审阅与回滚使用。

---

## 一、总览

| 类型 | 数量 | 说明 |
|---|---|---|
| 新增文件 | 6 | 已写入项目（5 个功能文件 + 本指引） |
| 现有文件补丁 | 15 处 / 8 个文件 | ✅ 已全部应用（含实施中新增的 `src/dev-preview.ts`） |
| 依赖安装 | 0 | 全部复用既有依赖（better-sqlite3 / uuid / react） |
| 云服务 | 0 | Phase 1 完全本地，不联网 |

**Phase 1 交付能力**：本机多身份（改名 / 切换 / 新建）+ 侧边栏身份入口 + 设置面板「账号」页。

**Phase 1 不包含**：云账号注册登录（Phase 3 接入腾讯云 CloudBase）、会话/记忆按身份分区（后续阶段）。

---

## 二、已生成的新文件

以下文件已经写好，直接可用：

```
electron/store/local-users.ts                       本地用户表 + CRUD + 幂等初始化
electron/auth/local-auth-manager.ts                 IPC 与数据层之间的协调器
src/components/AccountBadge.tsx                     侧边栏身份入口（头像 + 下拉菜单）
src/components/settings/SettingsAccountPanel.tsx    设置面板「账号」页
src/styles/account.css                              上述两个组件的样式
```

**关键设计**：`local-users.ts` 自己调用 `getDb()` 建表（与 `initContextTables()` 同模式），因此 **`electron/store/db.ts` 完全不需要改动**。

---

## 三、现有文件补丁（14 处）

### 补丁 1／14 · `shared/ipc.ts` — 新增 LocalUser 类型

**找到**：

```typescript
export type ThemeName = 'light' | 'dark' | 'system';
```

**替换为**：

```typescript
// ============================================
// 本地用户（Phase 1）
// ============================================

/** 本机使用者身份（不依赖云账号） */
export interface LocalUser {
  id: string;
  displayName: string;
  /** 头像文件路径（预留，Phase 1 UI 用显示名首字母） */
  avatarPath?: string;
  createdAt: number;
  updatedAt: number;
}

export type ThemeName = 'light' | 'dark' | 'system';
```

---

### 补丁 2／14 · `shared/ipc.ts` — ElectronAPI 新增 `auth`

**找到**（`ElectronAPI` 接口的最后一段）：

```typescript
  menu: {
    /** 监听原生菜单触发的 action（macOS）。返回取消监听函数。 */
    onAction: (callback: (action: MenuAction) => void) => () => void;
  };
}
```

**替换为**：

```typescript
  menu: {
    /** 监听原生菜单触发的 action（macOS）。返回取消监听函数。 */
    onAction: (callback: (action: MenuAction) => void) => () => void;
  };
  auth: {
    local: {
      /** 当前激活的本地身份 */
      getCurrent: () => Promise<LocalUser>;
      /** 全部本地身份（按创建时间升序） */
      list: () => Promise<LocalUser[]>;
      /** 新建本地身份（不自动切换） */
      create: (displayName?: string) => Promise<LocalUser>;
      /** 更新当前身份（只能改自己） */
      update: (patch: { displayName?: string; avatarPath?: string | null }) => Promise<LocalUser>;
      /** 切换当前身份 */
      switch: (id: string) => Promise<LocalUser>;
    };
  };
}
```

---

### 补丁 3／14 · `electron/preload.ts` — 导入 LocalUser 类型

**找到**：

```typescript
  ViewportRect,
} from '../shared/ipc';
```

**替换为**：

```typescript
  ViewportRect,
  LocalUser,
} from '../shared/ipc';
```

---

### 补丁 4／14 · `electron/preload.ts` — 暴露 `auth` API

**找到**（文件末尾 `menu` 段到 `contextBridge` 之前）：

```typescript
  menu: {
    onAction: (callback: (action: MenuAction) => void) => {
      const handler = (_e: unknown, action: MenuAction) => callback(action);
      ipcRenderer.on('menu:action', handler);
      return () => {
        ipcRenderer.removeListener('menu:action', handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
```

**替换为**：

```typescript
  menu: {
    onAction: (callback: (action: MenuAction) => void) => {
      const handler = (_e: unknown, action: MenuAction) => callback(action);
      ipcRenderer.on('menu:action', handler);
      return () => {
        ipcRenderer.removeListener('menu:action', handler);
      };
    },
  },
  auth: {
    local: {
      getCurrent: (): Promise<LocalUser> => ipcRenderer.invoke('auth:local:getCurrent'),
      list: (): Promise<LocalUser[]> => ipcRenderer.invoke('auth:local:list'),
      create: (displayName?: string): Promise<LocalUser> =>
        ipcRenderer.invoke('auth:local:create', displayName),
      update: (patch: { displayName?: string; avatarPath?: string | null }): Promise<LocalUser> =>
        ipcRenderer.invoke('auth:local:update', patch),
      switch: (id: string): Promise<LocalUser> => ipcRenderer.invoke('auth:local:switch', id),
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
```

---

### 补丁 5／14 · `electron/main.ts` — 启动时初始化本地用户表

**找到**（`app.whenReady()` 内的 db 初始化块）：

```typescript
  try {
    const { initDb, initContextTables, getDb } = await import('./store/db');
    initDb();
    // Context Hub 表（response_items / context_events / checkpoints）：
    // 未初始化会导致 chat:start 在 ContextHub 构造时崩溃且无事件回传
    initContextTables();
    // Memory OS: 初始化记忆存储
    const { setMemoryDb } = await import('./memory/memory-store');
    setMemoryDb(getDb);
  } catch (err) {
    log.error('db 初始化失败', err);
  }
```

**替换为**：

```typescript
  try {
    const { initDb, initContextTables, getDb } = await import('./store/db');
    initDb();
    // Context Hub 表（response_items / context_events / checkpoints）：
    // 未初始化会导致 chat:start 在 ContextHub 构造时崩溃且无事件回传
    initContextTables();
    // 本地用户表（Phase 1 账号体系）：首次启动自动创建默认本地身份
    const { initLocalUsers } = await import('./store/local-users');
    initLocalUsers();
    // Memory OS: 初始化记忆存储
    const { setMemoryDb } = await import('./memory/memory-store');
    setMemoryDb(getDb);
  } catch (err) {
    log.error('db 初始化失败', err);
  }
```

---

### 补丁 6／14 · `electron/main.ts` — 注册 5 个 IPC handler

**找到**：

```typescript
  handle('mcp:test', async (_e, cfg: McpServerConfig) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    return mcpManager.testConnection(cfg);
  });

  // Memory OS
```

**替换为**：

```typescript
  handle('mcp:test', async (_e, cfg: McpServerConfig) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    return mcpManager.testConnection(cfg);
  });

  // 本地用户体系（Phase 1）
  handle('auth:local:getCurrent', async () => {
    const { localAuth } = await import('./auth/local-auth-manager');
    return localAuth.getCurrent();
  });

  handle('auth:local:list', async () => {
    const { localAuth } = await import('./auth/local-auth-manager');
    return localAuth.list();
  });

  handle('auth:local:create', async (_e, displayName?: string) => {
    const { localAuth } = await import('./auth/local-auth-manager');
    return localAuth.create(displayName);
  });

  handle('auth:local:update', async (_e, patch: { displayName?: string; avatarPath?: string | null }) => {
    const { localAuth } = await import('./auth/local-auth-manager');
    return localAuth.update(patch);
  });

  handle('auth:local:switch', async (_e, id: string) => {
    const { localAuth } = await import('./auth/local-auth-manager');
    return localAuth.switch(id);
  });

  // Memory OS
```

---

### 补丁 7／14 · `src/components/Sidebar.tsx` — 导入 AccountBadge

**找到**：

```typescript
import { ProjectDialog } from './ProjectDialog';
```

**替换为**：

```typescript
import { ProjectDialog } from './ProjectDialog';
import { AccountBadge } from './AccountBadge';
```

---

### 补丁 8／14 · `src/components/Sidebar.tsx` — 插入身份入口

**找到**：

```tsx
      </nav>

      <div className="sidebar-library-heading">
```

**替换为**：

```tsx
      </nav>

      <AccountBadge />

      <div className="sidebar-library-heading">
```

---

### 补丁 9／14 · `src/components/SettingsPanel.tsx` — 导入新面板

**找到**：

```typescript
import { SettingsShortcutsPanel } from './settings/SettingsShortcutsPanel';
```

**替换为**：

```typescript
import { SettingsShortcutsPanel } from './settings/SettingsShortcutsPanel';
import { SettingsAccountPanel } from './settings/SettingsAccountPanel';
```

---

### 补丁 10／14 · `src/components/SettingsPanel.tsx` — 注册 tab

**找到**：

```typescript
  { id: 'skills', label: '技能与 MCP' },
  { id: 'shortcuts', label: '快捷键' },
] as const;
```

**替换为**：

```typescript
  { id: 'skills', label: '技能与 MCP' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'account', label: '账号' },
] as const;
```

---

### 补丁 11／14 · `src/components/SettingsPanel.tsx` — tab 图标映射

**找到**：

```typescript
  shortcuts: 'more',
};
```

**替换为**：

```typescript
  shortcuts: 'more',
  account: 'user',
};
```

---

### 补丁 12／14 · `src/components/SettingsPanel.tsx` — 渲染新面板

**找到**：

```tsx
            {tab === 'shortcuts' && (
              <SettingsShortcutsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
            )}
          </div>
```

**替换为**：

```tsx
            {tab === 'shortcuts' && (
              <SettingsShortcutsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
            )}
            {tab === 'account' && (
              <SettingsAccountPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
            )}
          </div>
```

---

### 补丁 13／14 · `src/components/Icon.tsx` — 新增 `user` 图标

**(a) 图标名联合类型**

**找到**：

```typescript
  | 'tool'
  | 'x';
```

**替换为**：

```typescript
  | 'tool'
  | 'user'
  | 'x';
```

**(b) 图标路径**

**找到**：

```typescript
    case 'x':
      return <svg {...common}><path d="m4 4 8 8M12 4l-8 8" /></svg>;
```

**替换为**：

```typescript
    case 'user':
      return <svg {...common}><circle cx="8" cy="5.6" r="2.6" /><path d="M3.2 13.2c0-2.6 2.2-4.2 4.8-4.2s4.8 1.6 4.8 4.2" /></svg>;
    case 'x':
      return <svg {...common}><path d="m4 4 8 8M12 4l-8 8" /></svg>;
```

---

### 补丁 14／14 · `src/main.tsx` — 引入账号样式

**找到**：

```typescript
import './styles/workbench.css';
```

**替换为**：

```typescript
import './styles/workbench.css';
import './styles/account.css';
```

---

### 补丁 15／15 · `src/dev-preview.ts` — 补 `auth` 桩（实施中新增）

**为什么需要**：`src/dev-preview.ts` 里有一个完整的 `ElectronAPI` 手写桩（供 `?ui-preview` 浏览器预览使用）。
`ElectronAPI` 新增 `auth` 命名空间后，该桩因类型不完整而报 `TS2741: Property 'auth' is missing`。

**找到**：

```typescript
import type {
  DiagnosticsInfo,
  ElectronAPI,
  FsNode,
  Memory,
  MessageRow,
  ConfiguredModel,
  ModelListItem,
  Project,
  ProjectSummary,
  Session,
  SessionSummary,
  ContextStateView,
  AppSettings,
} from '../shared/ipc';
```

**替换为**：

```typescript
import type {
  DiagnosticsInfo,
  ElectronAPI,
  FsNode,
  Memory,
  MessageRow,
  ConfiguredModel,
  ModelListItem,
  Project,
  ProjectSummary,
  Session,
  SessionSummary,
  ContextStateView,
  AppSettings,
  LocalUser,
} from '../shared/ipc';
```

**(b) 新增预览用状态**（`previewSettings` 声明之后）：

```typescript
// UI 预览用本地身份（Phase 1）：侧边栏 AccountBadge 与设置「账号」面板可交互
const previewLocalUsers: LocalUser[] = [
  { id: 'preview-local-1', displayName: 'Local User', createdAt: now - 86_400_000, updatedAt: now - 86_400_000 },
];
let previewActiveLocalUserId = previewLocalUsers[0]!.id;
```

**(c) 桩对象末尾新增 `auth` 段**（`menu` 之后）：

```typescript
    menu: {
      onAction: () => () => {},
    },
    auth: {
      local: {
        getCurrent: async () => ({ ...(previewLocalUsers.find((u) => u.id === previewActiveLocalUserId) ?? previewLocalUsers[0]!) }),
        list: async () => previewLocalUsers.map((u) => ({ ...u })),
        create: async (displayName?: string) => {
          const created: LocalUser = {
            id: `preview-local-${previewLocalUsers.length + 1}`,
            displayName: displayName?.trim() || 'Local User',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          previewLocalUsers.push(created);
          return { ...created };
        },
        update: async (patch: { displayName?: string; avatarPath?: string | null }) => {
          const target = previewLocalUsers.find((u) => u.id === previewActiveLocalUserId) ?? previewLocalUsers[0]!;
          if (patch.displayName !== undefined) target.displayName = patch.displayName;
          if (patch.avatarPath !== undefined) target.avatarPath = patch.avatarPath ?? undefined;
          target.updatedAt = Date.now();
          return { ...target };
        },
        switch: async (id: string) => {
          const target = previewLocalUsers.find((u) => u.id === id) ?? previewLocalUsers[0]!;
          previewActiveLocalUserId = target.id;
          return { ...target };
        },
      },
    },
  };
```

---

## 四、验证步骤（已执行）

```bash
cd "/Users/lhy/Stellara Work"

# 1. 类型检查（渲染层 + 主进程）→ ✅ 通过
npm run typecheck

# 2. 全量测试 → ✅ 通过
npm run test

# 3. 启动应用做手工验收
npm run dev
```

**实施中额外修复的 2 处**：

| 位置 | 问题 | 处理 |
|---|---|---|
| `src/dev-preview.ts` | `ElectronAPI` 桩缺 `auth` → `TS2741` | 补 `auth.local` 桩（见补丁 15），并做成可交互预览态 |
| `src/components/AccountBadge.tsx` | 挂载即调 `window.electronAPI.auth`，测试/预览环境无此 API → 未捕获的 Promise rejection，导致 `Sidebar.test.tsx` 报 44 个 error | `refresh` / `switch` / `create` 加 try-catch 静默降级（无 API 时不渲染身份入口） |
| `src/components/settings/SettingsPanel.test.tsx` | 断言导航为 6 个 tab | 改为 7 个（新增「账号」） |

**手工验收清单**：

1. **侧边栏出现身份入口** — 「新对话 / Pull Request / 已安排」下方有一个头像 + `Local User`，带下拉箭头
2. **点击展开菜单** — 显示「本地身份」标题、当前身份（带 ✓）、「新建本地身份」、底部灰字说明
3. **点击外部或 Esc** — 菜单关闭
4. **打开设置 → 账号** — 左侧导航多出「账号」一项，图标是人形
5. **改名** — 把「显示名」改成任意文字 → 点「保存」→ 侧边栏名字同步变化
6. **重启应用** — 名字保持（说明已落库）
7. **新建身份** — 点「新建」→ 列表多一条 `Local User`，且自动切换为当前
8. **切换** — 对非当前身份点「切换」→ ✓ 移到该身份，侧边栏同步
9. **数据落库检查** — 数据库里应有 `local_users` 与 `active_local_user` 两张表

---

## 五、风险与注意事项

### 1. 测试环境兼容（已处理）

`Sidebar.test.tsx` 从来不定义 `window.electronAPI`（Sidebar 只在有搜索词时才调 `sessions.search`，常规用例测不到）。
`AccountBadge` 挂载即调用 `auth.local.*`，因此在测试环境会抛未捕获的 Promise rejection。

**已采用的方案**：给 `AccountBadge` 的 `refresh` / `switch` / `create` 加 try-catch 静默降级 ——
非 Electron 环境（单测 / 浏览器预览）不渲染身份入口，不影响既有断言。
`SettingsAccountPanel` 本身已有 try-catch + `error-banner`，无需改动。

另一个可选方案（未采用）：在测试里 `vi.stubGlobal('electronAPI', {...})` 补 `auth.local` 桩。

### 2. 切换身份目前不影响数据

Phase 1 的「切换」只切换当前使用者标识。会话、记忆、工作区**尚未按身份分区** —— 这是后续阶段的工作。UI 中已用灰字说明，避免误解。

### 3. 头像文件选择未接入

`LocalUser.avatarPath` 字段与 IPC 参数已预留，但 Phase 1 的 UI 使用「显示名首字母」色块。接入真实头像需要新增一个「选图 + 读取 dataURL」的 IPC（可参考现有 `attachments.readImage` 与 `dialog.openAttachmentFiles` 的模式），建议放到 Phase 1.5。

### 4. 安全边界

- 本阶段**不接触任何密钥**，不走网络
- 渲染进程只能通过白名单 IPC 操作，无法直接访问 SQLite
- `update` 只允许改「当前身份」，不接受任意 id，避免越权

### 5. 与 Phase 3 的衔接

Phase 3 接入腾讯云 CloudBase 时：
- 新增 `cloud_links` 表（`local_user_id` 外键指向 `local_users.id`）
- 新增 `auth.cloud.*` IPC，与 `auth.local.*` **并存**
- 本阶段的 5 个文件与 14 处补丁**无需回滚或重写**

---

## 六、回滚方式

如需完全撤销 Phase 1：

1. 删除 6 个新增文件
2. 反向执行 15 处补丁（把每处「替换为」改回「找到」）
3. （可选）删除数据库中的 `local_users` / `active_local_user` 两张表

补丁全部是纯追加，不影响任何既有逻辑。
