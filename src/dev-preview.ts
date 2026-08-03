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
} from '../shared/ipc';

const now = Date.now();
const previewWorkDir = 'D:\\Stellara Work';

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
  { id: 'product', name: '桌面端产品', workDir: previewWorkDir, entryFile: `${previewWorkDir}\\README.md`, updatedAt: now - 40_000, sessionCount: 2 },
  { id: 'website', name: '品牌网站', workDir: previewWorkDir, entryFile: `${previewWorkDir}\\package.json`, updatedAt: now - 240_000, sessionCount: 1 },
];

let sessions: SessionSummary[] = [
  { id: 'ui-review', title: '重做桌面端界面', modelId: previewModel.id, projectId: 'product', messageCount: 5, updatedAt: now - 20_000 },
  { id: 'project-fix', title: '修复项目删除与重命名', modelId: previewModel.id, projectId: 'product', messageCount: 8, updatedAt: now - 140_000 },
  { id: 'release', title: '准备 0.9.0 发布包', modelId: previewModel.id, messageCount: 4, updatedAt: now - 600_000 },
  { id: 'landing', title: '整理官网内容层级', modelId: previewModel.id, projectId: 'website', messageCount: 6, updatedAt: now - 900_000 },
];

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
    version: '0.9.0-preview', platform: 'win32', arch: 'x64', electron: 'preview', chrome: 'preview', node: 'preview',
    appDataPath: 'Preview', envPath: 'Preview', logPath: 'Preview', dbSizeBytes: 0,
    sessionCount: sessions.length, messageCount: previewRows.length, modelCount: 1,
    activeModelId: previewModel.id, modelsWithKey: [previewModel.id], logTail: '', collectedAt: new Date().toISOString(),
  };
}

/** 为 `?ui-preview` 安装内存实现，便于在普通浏览器里检查真实 React 界面。 */
export function installDevPreviewApi(): void {
  const modelItem: ModelListItem = {
    id: previewModel.id, label: previewModel.label, baseUrl: previewModel.baseUrl, model: previewModel.model,
    hasKey: true, isActive: true, createdAt: new Date(now).toISOString(), contextWindow: previewModel.contextWindow,
  };

  const api: ElectronAPI = {
    app: { getInfo: async () => ({ version: '0.9.0-preview', platform: 'win32', appDataPath: 'Preview', envPath: 'Preview' }) },
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
    tools: { invoke: async () => ({ ok: true, output: 'Preview' }) },
    dialog: {
      openDirectory: async () => previewWorkDir,
      openFile: async () => `${previewWorkDir}\\README.md`,
      selectProjectFile: async () => ({ path: `${previewWorkDir}\\README.md`, workDir: previewWorkDir }),
      createProjectFile: async () => ({ path: `${previewWorkDir}\\notes.md`, workDir: previewWorkDir }),
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
      get: async (id) => {
        const summary = sessions.find((session) => session.id === id) ?? sessions[0]!;
        return { session: sessionFromSummary(summary), messages: id === 'ui-review' ? previewRows : [] };
      },
      create: async ({ modelId, workDir, title = 'New session', projectId }) => {
        const projectWorkDir = projects.find((project) => project.id === projectId)?.workDir;
        const session: Session = { id: `session-${Date.now()}`, title, modelId, workDir: projectWorkDir ?? workDir, projectId, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
        sessions = [session, ...sessions];
        return session;
      },
      delete: async (id) => { sessions = sessions.filter((session) => session.id !== id); },
      rename: async (id, title) => { sessions = sessions.map((session) => session.id === id ? { ...session, title } : session); },
      saveMessages: async () => {}, appendMessage: async () => {},
      move: async (sessionId, projectId) => { sessions = sessions.map((session) => session.id === sessionId ? { ...session, projectId: projectId ?? undefined } : session); },
    },
    fs: {
      listTree: async (cwd): Promise<FsNode> => ({ name: 'Stellara Work', path: cwd, type: 'dir', children: [
        { name: 'src', path: 'src', type: 'dir', children: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', size: 9_420 }] },
        { name: 'package.json', path: 'package.json', type: 'file', size: 2_180 },
      ] }),
      readFile: async () => ({ content: '// UI preview', size: 13, truncated: false }),
      openPath: async () => true,
      createFile: async (workDir, relativePath) => ({ path: `${workDir}\\${relativePath.replace(/\//g, '\\')}` }),
    },
    settings: {
      get: async () => ({ theme: 'light', workspaceMode: 'sidebar' }), update: async () => {}, clearAllData: async () => {}, resetSelective: async () => {},
      openDataDir: async () => {}, openLogFile: async () => {}, collectDiagnostics: async () => emptyDiagnostics(),
    },
    skills: { list: async () => [] },
    memory: {
      search: async (): Promise<Memory[]> => [], list: async (): Promise<Memory[]> => [],
      save: async (memory) => ({ ...memory, id: `memory-${Date.now()}`, accessCount: 0, createdAt: Date.now(), updatedAt: Date.now() }),
      update: async () => {}, delete: async () => {}, stats: async () => ({ total: 0, byScope: {}, byKind: {}, recentCount: 0 }),
    },
  };

  window.electronAPI = api;
}
