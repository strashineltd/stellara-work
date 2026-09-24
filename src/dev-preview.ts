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
  LocalIdentity,
  IdentitySwitchResult,
  CloudAccount,
  CloudAuthState,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskKind,
  ScheduledTaskPatch,
} from '../shared/ipc';

const now = Date.now();
const isMacPreview = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const sep = isMacPreview ? '/' : '\\';
const previewWorkDir = isMacPreview ? '/tmp/stellara-preview' : 'D:\\Stellara Work';
const previewPlatform = isMacPreview ? 'darwin' : 'win32';

const previewModel: ConfiguredModel = {
  id: 'custom',
  label: '本地模型',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: 'workbench-local',
  isCustom: true,
  hasKey: true,
  contextWindow: 256_000,
};

let projects: ProjectSummary[] = [
  { id: 'product', name: '桌面端产品', workDir: previewWorkDir, entryFile: `${previewWorkDir}${sep}README.md`, updatedAt: now - 40_000, sessionCount: 2 },
  { id: 'website', name: '品牌网站', workDir: previewWorkDir, entryFile: `${previewWorkDir}${sep}package.json`, updatedAt: now - 240_000, sessionCount: 1 },
];

let sessions: SessionSummary[] = [
  { id: 'ui-review', title: '重做桌面端界面', modelId: previewModel.id, projectId: 'product', messageCount: 5, updatedAt: now - 20_000 },
  { id: 'project-fix', title: '修复项目删除与重命名', modelId: previewModel.id, projectId: 'product', messageCount: 8, updatedAt: now - 140_000 },
  { id: 'release', title: '准备 0.9.0 发布包', modelId: previewModel.id, messageCount: 4, updatedAt: now - 600_000 },
  { id: 'landing', title: '整理官网内容层级', modelId: previewModel.id, projectId: 'website', messageCount: 6, updatedAt: now - 900_000 },
];
let previewSettings: AppSettings = { theme: 'light', workspaceMode: 'tabs' };
const settingsListeners = new Set<() => void>();

// UI 预览用本地身份（Phase 1）：侧边栏 AccountBadge 与设置「账号」面板可交互
const previewLocalUsers: LocalUser[] = [
  { id: 'preview-local-1', displayName: 'Local User', createdAt: now - 86_400_000, updatedAt: now - 86_400_000 },
];
let previewActiveLocalUserId = previewLocalUsers[0]!.id;

// H10：身份切换（含默认档）与 identity-changed 订阅
const previewIdentityListeners = new Set<(user: LocalIdentity) => void>();

function previewIdentities(): LocalIdentity[] {
  return [
    { id: 'default', name: '本地默认', kind: 'default' },
    ...previewLocalUsers.map((user): LocalIdentity => ({
      id: user.id,
      name: user.displayName,
      kind: 'user',
    })),
  ];
}

function previewCurrentIdentity(): LocalIdentity {
  return (
    previewIdentities().find((item) => item.id === previewActiveLocalUserId) ?? {
      id: 'default',
      name: '本地默认',
      kind: 'default',
    }
  );
}

function previewSetActiveIdentity(id: string): LocalIdentity {
  if (id !== 'default' && !previewLocalUsers.some((user) => user.id === id)) {
    throw new Error(`用户不存在: ${id}`);
  }
  previewActiveLocalUserId = id;
  return previewCurrentIdentity();
}

// UI 预览用云账号（Phase 3）：设置「账号」面板可走通登录/登出/解绑流程
let previewCloudAccount: CloudAccount | null = null;
let previewCloudSignedIn = false;

function previewCloudState(): CloudAuthState {
  return {
    configured: true,
    signedIn: previewCloudSignedIn,
    account: previewCloudAccount,
  };
}

const previewRows: MessageRow[] = [
  {
    sessionId: 'ui-review', position: 0, role: 'user', createdAt: now - 80_000,
    content: '重新设计程序 UI。希望它像成熟的 Windows 工作工具，克制、清楚，不要科幻风，也不要一眼看出是 AI 产品。',
  },
  {
    sessionId: 'ui-review', position: 1, role: 'assistant', createdAt: now - 70_000,
    content: '我会把界面收束为三层：左侧负责项目与会话，中间保持任务记录的连续阅读，右侧只在需要时展示检查信息。颜色使用纸张灰、炭黑和低饱和墨蓝。',
    toolCalls: JSON.stringify([{ id: 'preview-tool', type: 'function', function: { name: 'edit_file', arguments: '{"path":"src/styles/workbench.css"}' } }]),
  },
  {
    sessionId: 'ui-review', position: 2, role: 'tool', toolCallId: 'preview-tool', toolName: 'edit_file', createdAt: now - 55_000,
    content: '已更新界面基础样式与响应式布局。',
    meta: JSON.stringify({ kind: 'edit', path: 'src/styles/workbench.css', before: ':root {}', after: ':root { color-scheme: light dark; }' }),
  },
  {
    sessionId: 'ui-review', position: 3, role: 'assistant', createdAt: now - 30_000,
    content: '界面骨架已经完成。\n\n- 移除了发光、渐变与玻璃效果\n- 统一了按钮、输入框和菜单的状态\n- 设置面板保持固定尺寸，切换分类时不再跳动\n- 所有关键操作保留清晰的键盘焦点',
  },
];

function sessionFromSummary(summary: SessionSummary): Session {
  return {
    ...summary,
    workDir: summary.workDir ?? projects.find((project) => project.id === summary.projectId)?.workDir,
    createdAt: summary.updatedAt - 3_600_000,
  };
}

function emptyDiagnostics(): DiagnosticsInfo {
  return {
    version: '0.9.2-preview', platform: previewPlatform, arch: 'x64', electron: 'preview', chrome: 'preview', node: 'preview',
    appDataPath: 'Preview', envPath: 'Preview', logPath: 'Preview', dbSizeBytes: 0,
    sessionCount: sessions.length, messageCount: previewRows.length, modelCount: 1,
    activeModelId: previewModel.id, modelsWithKey: [previewModel.id], logTail: '', collectedAt: new Date().toISOString(),
  };
}

// v0.9.3 调度器预览：内存任务 / 执行记录（UI 页面联调用）
let previewScheduledTasks: ScheduledTask[] = [
  {
    id: 'scheduled-preview-1', name: '每日构建巡检',
    prompt: '检查主分支构建状态并总结失败项',
    projectId: 'product', workDir: previewWorkDir, runtime: 'local', modelId: previewModel.id,
    scheduleKind: 'cron', scheduleExpr: '0 9 * * *', enabled: true,
    nextRunAt: now + 3_600_000, lastRunAt: now - 43_200_000, lastStatus: 'success',
    policy: { allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: [] }, createdAt: now - 86_400_000, updatedAt: now - 43_200_000,
    running: true,
  },
  {
    id: 'scheduled-preview-2', name: '间隔值班',
    prompt: '巡检服务器状态，异常时给出摘要',
    runtime: 'server', serverId: 'srv-preview',
    scheduleKind: 'interval', scheduleExpr: '30', enabled: false,
    nextRunAt: null, lastRunAt: null, lastStatus: null,
    createdAt: now - 3_600_000, updatedAt: now - 3_600_000,
  },
];
let previewScheduledRuns: ScheduledRun[] = [
  {
    id: 'run-preview-1', taskId: 'scheduled-preview-1',
    startedAt: now - 43_200_000, finishedAt: now - 43_190_000,
    status: 'success', sessionId: 'ui-review',
  },
];

function previewNextRunAt(kind: ScheduledTaskKind, expr: string): number | null {
  if (kind === 'once') {
    const at = Date.parse(expr);
    return Number.isNaN(at) ? null : at;
  }
  if (kind === 'interval') {
    const minutes = Number(expr);
    return Number.isFinite(minutes) && minutes > 0 ? Date.now() + minutes * 60_000 : null;
  }
  return Date.now() + 60_000;
}

/** 补丁 → 任务字段（null 归一为 undefined，保持 ScheduledTask 的可选字段语义） */
function previewPatchToTask(patch: ScheduledTaskPatch): Partial<ScheduledTask> {
  const next: Partial<ScheduledTask> = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.prompt !== undefined) next.prompt = patch.prompt;
  if (patch.projectId !== undefined) next.projectId = patch.projectId ?? undefined;
  if (patch.workDir !== undefined) next.workDir = patch.workDir ?? undefined;
  if (patch.runtime !== undefined) next.runtime = patch.runtime;
  if (patch.serverId !== undefined) next.serverId = patch.serverId ?? undefined;
  if (patch.modelId !== undefined) next.modelId = patch.modelId ?? undefined;
  if (patch.scheduleKind !== undefined) next.scheduleKind = patch.scheduleKind;
  if (patch.scheduleExpr !== undefined) next.scheduleExpr = patch.scheduleExpr;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.policy !== undefined) next.policy = patch.policy ?? undefined;
  return next;
}

/** 为 `?ui-preview` 安装内存实现，便于在普通浏览器里检查真实 React 界面。 */
export function installDevPreviewApi(): void {
  const modelItem: ModelListItem = {
    id: previewModel.id, label: previewModel.label, baseUrl: previewModel.baseUrl, model: previewModel.model,
    hasKey: true, isActive: true, createdAt: new Date(now).toISOString(), contextWindow: previewModel.contextWindow,
  };

  const api: ElectronAPI = {
    app: {
      getInfo: async () => ({ version: '0.9.2-preview', platform: previewPlatform, appDataPath: 'Preview', envPath: 'Preview', secretStorage: 'encrypted' }),
      getGitBranch: async () => 'main',
      onSettingsChanged: (callback) => {
        settingsListeners.add(callback);
        return () => settingsListeners.delete(callback);
      },
      isFullScreen: async () => false,
      onFullscreenChanged: () => () => {},
    },
    models: {
      list: async () => ({ presets: [], configured: previewModel }),
      getAll: async () => [modelItem],
      configure: async () => ({ ok: true }), test: async () => ({ ok: true }),
      remove: async () => {}, setActive: async () => {}, updateKey: async () => {},
      updateWorkDir: async () => {}, updateContextWindow: async () => {},
    },
    chat: {
      start: async () => ({ streamId: 'preview-stream', events: (async function* () { yield { type: 'done' as const }; })() }),
      abort: () => {}, approve: () => {},
    },
    context: {
      getSnapshot: async (sessionId) => previewContextState(sessionId),
      createCheckpoint: async (sessionId) => ({
        ...previewContextState(sessionId),
        checkpoint: {
          id: 'preview-checkpoint', sessionId, contextRevision: 12, workspaceRevision: 2,
          objective: '完成桌面端界面升级', constraints: ['保持克制、非科幻视觉'], decisions: ['采用三栏工作台'],
          filesChanged: ['src/styles/workbench.css'], verification: ['界面测试通过'], failures: [],
          planState: [], pendingWork: [], createdAt: new Date().toISOString(),
        },
      }),
      compact: async (sessionId: string) => ({
        ok: true,
        busy: false,
        compacted: true,
        snapshot: previewContextState(sessionId),
      }),
    },
    tools: { invoke: async () => ({ ok: true, output: 'Preview' }) },
    browser: {
      list: async () => [],
      getSnapshot: async () => ({ markdown: '' }),
      getConfig: async () => ({ searchProvider: 'auto', execJsEnabled: false, hasTavilyKey: false, hasBraveKey: false, loginAllowlist: [] }),
      updateConfig: async () => {},
      setSearchKey: async () => {},
      clearSearchKey: async () => {},
      attachView: async () => {},
      detachView: async () => {},
      setViewport: async () => {},
      setUserInteraction: async () => {},
    },
    dialog: {
      openDirectory: async () => previewWorkDir,
      openFile: async () => `${previewWorkDir}${sep}README.md`,
      selectProjectDir: async () => ({ workDir: previewWorkDir, entryFile: 'README.md' }),
      openAttachmentFiles: async () => [`${previewWorkDir}${sep}notes.md`],
      getPathForFile: () => '',
    },
    projects: {
      list: async () => projects,
      create: async ({ name, workDir, entryFile }) => {
        const project: Project = { id: `project-${Date.now()}`, name, workDir, entryFile, createdAt: Date.now(), updatedAt: Date.now() };
        projects = [{ ...project, sessionCount: 0 }, ...projects];
        return project;
      },
      delete: async (id) => { projects = projects.filter((project) => project.id !== id); },
      rename: async (id, name) => { projects = projects.map((project) => project.id === id ? { ...project, name } : project); },
      updateFile: async (id, selection) => {
        projects = projects.map((project) => project.id === id ? { ...project, workDir: selection.workDir, entryFile: selection.path, updatedAt: Date.now() } : project);
        const project = projects.find((item) => item.id === id);
        if (!project) throw new Error('项目不存在');
        return { ...project, createdAt: project.updatedAt };
      },
    },
    sessions: {
      list: async () => sessions,
      search: async () => [],
      get: async (id) => {
        const summary = sessions.find((session) => session.id === id) ?? sessions[0]!;
        return { session: sessionFromSummary(summary), messages: id === 'ui-review' ? previewRows : [] };
      },
      create: async ({ modelId, workDir, title = 'New session', projectId }) => {
        const projectWorkDir = projects.find((project) => project.id === projectId)?.workDir;
        const session: Session = { id: `session-${Date.now()}`, title, modelId: modelId ?? previewModel.id, workDir: projectWorkDir ?? workDir, projectId, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
        sessions = [session, ...sessions];
        return session;
      },
      delete: async (id) => { sessions = sessions.filter((session) => session.id !== id); },
      rename: async (id, title) => { sessions = sessions.map((session) => session.id === id ? { ...session, title } : session); },
      saveMessages: async () => {}, appendMessage: async () => {},
      move: async (sessionId, projectId) => { sessions = sessions.map((session) => session.id === sessionId ? { ...session, projectId: projectId ?? undefined } : session); },
    },
    servers: {
      list: async () => [],
      add: async (input) => ({
        id: `server-${Date.now()}`,
        name: input.name ?? input.url,
        url: input.url,
        username: input.username,
        hasPassword: Boolean(input.password),
        isDefault: false,
        createdAt: new Date().toISOString(),
      }),
      update: async (id, patch) => ({
        id,
        name: patch.name ?? id,
        url: patch.url ?? '',
        username: patch.username,
        hasPassword: Boolean(patch.password),
        isDefault: false,
        createdAt: new Date().toISOString(),
      }),
      remove: async () => {},
      test: async () => ({ ok: true, status: 'connected' }),
      setDefault: async () => {},
      status: async () => [],
      connect: async (id: string) => ({ id, status: 'connected' as const }),
      providers: async () => ({ providers: [] }),
      vcs: async () => ({ branch: null }),
      agents: async () => [],
      onStatusChanged: () => () => {},
    },
    fs: {
      listTree: async (cwd): Promise<FsNode> => ({ name: 'Stellara Work', path: cwd, type: 'dir', children: [
        { name: 'src', path: 'src', type: 'dir', children: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 9_420 }] },
        { name: 'package.json', path: 'package.json', type: 'file', size: 2_180 },
      ] }),
      readFile: async () => ({ content: '// UI preview', size: 13, truncated: false }),
      openPath: async () => true,
      createFile: async (workDir, relativePath) => ({ path: `${workDir}${sep}${relativePath.replace(/\//g, sep)}` }),
      mkdir: async (workDir, relativePath) => `${workDir}${sep}${relativePath.replace(/\//g, sep)}`,
    },
    attachments: {
      add: async (sessionId, _workDir, filePaths) => ({
        attachments: filePaths.map((p) => {
          const name = p.split('/').pop()!.split('\\').pop()!;
          return {
            id: name,
            name,
            size: 0,
            mimeType: 'application/octet-stream',
            kind: 'file' as const,
            relPath: `${sessionId}/${name}`,
          };
        }),
      }),
      readImage: async () => ({ dataUrl: '' }),
      open: async () => true,
    },
    settings: {
      get: async () => previewSettings,
      update: async (partial) => {
        previewSettings = { ...previewSettings, ...partial };
        settingsListeners.forEach((listener) => listener());
      },
      clearAllData: async () => {}, resetSelective: async () => {},
      openDataDir: async () => {}, openLogFile: async () => {}, collectDiagnostics: async () => emptyDiagnostics(),
    },
    skills: {
      list: async () => [
        { name: 'code-review', description: '对当前变更做全面代码审查，输出发现清单', prompt: '请先读取当前 diff，然后逐文件审查…', format: 'md' },
        { name: 'mcp-setup', description: '配置 MCP 服务器的 JSON 模板', prompt: 'JSON 格式技能内容', format: 'json' },
        { name: 'macos-pack', description: '构建 arm64/x64 dmg/zip 并验证产物', prompt: '运行 package:mac 并检查 release 目录…' },
      ],
      listDetailed: async () => ({
        items: [
          { name: 'code-review', description: '对当前变更做全面代码审查，输出发现清单', prompt: '请先读取当前 diff，然后逐文件审查…', format: 'md', file: 'code-review.md' },
          { name: 'mcp-setup', description: '配置 MCP 服务器的 JSON 模板', prompt: 'JSON 格式技能内容', format: 'json', file: 'mcp-setup.json' },
          { name: 'macos-pack', description: '构建 arm64/x64 dmg/zip 并验证产物', prompt: '运行 package:mac 并检查 release 目录…', file: 'macos-pack.md' },
        ],
        errors: [
          { file: 'bad.json', reason: '缺少 name' },
          { file: 'broken.md', reason: '格式解析失败' },
        ],
      }),
      initBuiltins: async () => ['code-review.md', 'test-writer.md', 'debug-issue.md'],
      listBuiltins: async () => [
        { name: 'code-review', description: '审查代码变更，输出按严重程度排序的问题清单与修复建议' },
        { name: 'test-writer', description: '为目标代码编写单元测试并确保全部通过' },
        { name: 'debug-issue', description: '定位并修复程序 bug，最小改动验证后总结根因' },
      ],
      create: async () => ({ file: 'preview-skill.md' }),
      update: async () => {},
      delete: async () => {},
    },
    mcp: {
      list: async () => [
        {
          id: 'filesystem',
          name: '本地文件系统',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', previewWorkDir],
          enabled: true,
        },
        {
          id: 'github',
          name: 'GitHub API',
          transport: 'http',
          url: 'https://mcp.example.com/github',
          enabled: false,
        },
      ],
      add: async () => {},
      update: async () => {},
      remove: async () => {},
      test: async () => ({ ok: true, toolCount: 3 }),
    },
    memory: {
      search: async (): Promise<Memory[]> => [], list: async (): Promise<Memory[]> => [],
      save: async (memory) => ({ ...memory, id: `memory-${Date.now()}`, accessCount: 0, userId: 'default', createdAt: Date.now(), updatedAt: Date.now() }),
      update: async () => {}, delete: async () => {}, stats: async () => ({ total: 0, byScope: {}, byKind: {}, recentCount: 0 }),
      exportSingle: async () => ({ path: 'Preview/export.md' }),
      exportAll: async () => ({ path: 'Preview/all.md', count: 1 }),
      copyMd: async () => '# Preview\n',
      onExtracted: () => () => {},
    },
    menu: {
      onAction: () => () => {},
    },
    auth: {
      local: {
        getCurrent: async () => {
          const target = previewLocalUsers.find((u) => u.id === previewActiveLocalUserId);
          if (!target) throw new Error('本地用户未初始化，请先调用 initLocalUsers()');
          return { ...target };
        },
        list: async () => previewIdentities(),
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
          const target = previewLocalUsers.find((u) => u.id === previewActiveLocalUserId);
          if (!target) throw new Error('本地用户未初始化，请先调用 initLocalUsers()');
          if (patch.displayName !== undefined) target.displayName = patch.displayName;
          if (patch.avatarPath !== undefined) target.avatarPath = patch.avatarPath ?? undefined;
          target.updatedAt = Date.now();
          return { ...target };
        },
        switch: async (id: string) => {
          previewSetActiveIdentity(id);
          return previewLocalUsers.find((u) => u.id === id) ?? null;
        },
      },
      cloud: {
        getState: async () => previewCloudState(),
        sendSignUpCode: async (args: { email: string }) => ({
          ok: true as const,
          data: { pendingId: 'preview-pending-1', email: args.email },
        }),
        // 固定验证码 123456，其余走「验证码不正确」分支，便于在预览里验证错误分层
        verifySignUp: async (args: { pendingId: string; code: string }) => {
          if (args.code !== '123456') {
            return {
              ok: false as const,
              error: {
                code: 'verification_failed',
                message: '验证码不正确或已过期',
                hint: '请重新获取验证码后再试',
              },
            };
          }
          previewCloudAccount = {
            uid: 'preview-cloud-uid-1',
            email: 'preview@example.com',
            username: 'preview_user',
            displayName: '预览用户',
          };
          previewCloudSignedIn = true;
          return { ok: true as const, data: previewCloudState() };
        },
        signInWithPassword: async (args: { identifier: string; password: string }) => {
          // 密码固定 preview123，其余走「账号或密码不正确」分支
          if (args.password !== 'preview123') {
            return {
              ok: false as const,
              error: {
                code: 'invalid_credentials',
                message: '邮箱/用户名或密码不正确',
                hint: '请检查后重试',
              },
            };
          }
          const isEmail = args.identifier.includes('@');
          previewCloudAccount = {
            uid: 'preview-cloud-uid-1',
            email: isEmail ? args.identifier : 'preview@example.com',
            username: isEmail ? 'preview_user' : args.identifier,
            displayName: '预览用户',
          };
          previewCloudSignedIn = true;
          return { ok: true as const, data: previewCloudState() };
        },
        signOut: async () => {
          previewCloudSignedIn = false;
          return { ok: true as const, data: previewCloudState() };
        },
        unlink: async () => {
          previewCloudSignedIn = false;
          previewCloudAccount = null;
          return { ok: true as const, data: previewCloudState() };
        },
        // 固定把 taken_user 当作已占用，便于在预览里看到「用户名已被占用」
        isUsernameRegistered: async (name: string) => ({ ok: true as const, data: name === 'taken_user' }),
      },
    },
    identity: {
      list: async () => previewIdentities(),
      getCurrent: async () => previewCurrentIdentity(),
      switch: async (userId: string, _force?: boolean): Promise<IdentitySwitchResult> => {
        const user = previewSetActiveIdentity(userId);
        previewIdentityListeners.forEach((listener) => listener(user));
        return { ok: true, user };
      },
      onChanged: (callback: (user: LocalIdentity) => void) => {
        previewIdentityListeners.add(callback);
        return () => {
          previewIdentityListeners.delete(callback);
        };
      },
    },
    scheduled: {
      list: async () => previewScheduledTasks,
      create: async (input: ScheduledTaskInput) => {
        const stamp = Date.now();
        const task: ScheduledTask = {
          ...input,
          id: `scheduled-${stamp}`,
          enabled: input.enabled ?? true,
          policy: input.policy,
          nextRunAt: previewNextRunAt(input.scheduleKind, input.scheduleExpr),
          lastRunAt: null, lastStatus: null,
          createdAt: stamp, updatedAt: stamp,
        };
        previewScheduledTasks = [task, ...previewScheduledTasks];
        return task;
      },
      update: async (id, patch) => {
        const current = previewScheduledTasks.find((task) => task.id === id);
        if (!current) throw new Error('任务不存在或已被删除');
        const updated: ScheduledTask = {
          ...current,
          ...previewPatchToTask(patch),
          updatedAt: Date.now(),
        };
        if (patch.enabled === false) updated.nextRunAt = null;
        else if (patch.enabled === true || patch.scheduleKind !== undefined || patch.scheduleExpr !== undefined) {
          updated.nextRunAt = previewNextRunAt(updated.scheduleKind, updated.scheduleExpr);
        }
        previewScheduledTasks = previewScheduledTasks.map((task) => (task.id === id ? updated : task));
        return updated;
      },
      remove: async (id) => {
        previewScheduledTasks = previewScheduledTasks.filter((task) => task.id !== id);
        previewScheduledRuns = previewScheduledRuns.filter((run) => run.taskId !== id);
      },
      toggle: async (id) => {
        const current = previewScheduledTasks.find((task) => task.id === id);
        if (!current) throw new Error('任务不存在或已被删除');
        const enabled = !current.enabled;
        previewScheduledTasks = previewScheduledTasks.map((task) => (task.id === id
          ? { ...task, enabled, nextRunAt: enabled ? previewNextRunAt(task.scheduleKind, task.scheduleExpr) : null, updatedAt: Date.now() }
          : task));
      },
      runNow: async () => {},
      abort: async () => {},
      runs: async (taskId) => previewScheduledRuns.filter((run) => run.taskId === taskId),
      onChanged: () => () => {},
    },
  };

  window.electronAPI = api;
}

function previewContextState(sessionId: string): ContextStateView {
  return {
    sessionId,
    revision: 12,
    workspaceRevision: 2,
    objective: '完成桌面端界面升级',
    planSteps: [],
    usage: {
      inputUsageRatio: 0.18,
      softThreshold: 0.75,
      hardThreshold: 0.9,
      nearLimit: false,
      hardLimited: false,
      currentInputTokens: 46_200,
      usableInputBudget: 239_616,
    },
    checkpoint: null,
    modifiedFiles: ['src/styles/workbench.css'],
    unverifiedFiles: [],
    staleEvidence: [],
    taskGate: { ok: true, reasons: [] },
    subagents: [],
  };
}
