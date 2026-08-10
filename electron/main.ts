import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, nativeTheme, powerSaveBlocker } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import log from 'electron-log/main';
import { loadEnv, getEnvPath } from './config/env';
import { loadModelsConfig } from './config/models';
import { runAgentLoop } from './agent/loop';
import { ChatStreamRegistry } from './chat/stream-registry';
import { resolveSessionModel } from './chat/session-context';
import { installAppMenu } from './menu';
import { openSettingsWindow, broadcastSettingsChanged } from './settings-window';
import { notifyTaskEnd } from './notifications';
import type {
  AppInfo,
  ModelConfig,
  ConfiguredModel,
  ModelListResponse,
  ChatRequest,
  ChatStreamEvent,
  ToolName,
  ToolArgs,
  ToolResult,
  MessageRow,
  AppSettings,
  ProjectFileSelection,
  Memory,
  McpServerConfig,
} from '../shared/ipc';

const isDev = process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = 'http://localhost:5173';

log.initialize();
log.info('Stellara Work 启动中...');

let mainWindow: BrowserWindow | null = null;

// M2.4: open-file 事件在窗口创建前到达时暂存，窗口就绪后处理
let pendingOpenFile: string | null = null;

// P0-1 + P0-2: 审批流和取消任务的状态管理
const chatStreams = new ChatStreamRegistry();
const grantedWorkDirs = new Set<string>();

async function normalizeWorkDir(workDir: string): Promise<string> {
  const resolved = path.resolve(workDir);
  if (process.platform === 'win32') return resolved.toLowerCase();
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function grantWorkDir(workDir: string): Promise<string> {
  const resolved = path.resolve(workDir);
  grantedWorkDirs.add(await normalizeWorkDir(workDir));
  return resolved;
}

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: !isMac,
    // macOS 深度适配：窗口底色跟随系统深浅色，避免主题切换时闪白；
    // 深色面板色与 grounded-tokens 深色背景一致
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E2126' : '#FFFFFF',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {
          // macOS 12+ 原生圆角窗口；红绿灯保持系统默认位置（hiddenInset），
          // 侧栏按钮通过 CSS margin 置于其下方，两者互不重叠
          roundedCorners: true,
        }
      : {
          titleBarOverlay: {
            color: 'rgba(0, 0, 0, 0)',
            symbolColor: '#65758B',
            height: 72,
          },
        }),
    icon: path.join(__dirname, '..', '..', 'assets', isMac ? 'icon-512.png' : 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(RENDERER_DEV_URL);
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    log.info(`Loading renderer from: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    log.info('Window ready to show');
    mainWindow?.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      log.warn('Forcing window show after 5s timeout');
      mainWindow.show();
    }
  }, 5000);

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    const msg = `Renderer failed to load: ${errorCode} ${errorDescription} (URL: ${validatedURL})`;
    console.error(msg);
    log.error(msg);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    const msg = `Render process gone: ${JSON.stringify(details)}`;
    console.error(msg);
    log.error(msg);
  });
  mainWindow.webContents.on('console-message', (_e, _level, message, line, source) => {
    const msg = `[renderer] ${message} (${source}:${line})`;
    console.log(msg);
    log.info(msg);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================
// IPC Handlers
// ============================================

function registerIpcHandlers(): void {
  // App info
  ipcMain.handle('app:getInfo', async (): Promise<AppInfo> => {
    const appDataPath = app.getPath('userData');
    await fs.mkdir(appDataPath, { recursive: true });
    return {
      version: app.getVersion(),
      platform: process.platform,
      appDataPath,
      envPath: getEnvPath(),
    };
  });

  // Models（v1，保留兼容但走 v2 数据）
  ipcMain.handle('models:list', async (): Promise<ModelListResponse> => {
    const { MODEL_PRESETS } = await import('./llm/presets');
    const { loadConfig } = await import('./config/config-v2');
    const { getKey } = await import('./config/secrets');
    const cfg = await loadConfig();
    const active = cfg.models.find((m) => m.id === cfg.activeModelId);
    if (!active) {
      return { presets: MODEL_PRESETS, configured: null };
    }
    // 安全：渲染进程拿不到原始 key，只告知是否已配置
    const key = getKey(active.id) ?? '';
    const configured: ConfiguredModel = {
      id: active.id as ConfiguredModel['id'],
      label: active.label,
      baseUrl: active.baseUrl,
      model: active.model,
      workDir: active.workDir,
      isCustom: false,
      contextWindow: active.contextWindow,
      hasKey: !!key,
    };
    return { presets: MODEL_PRESETS, configured };
  });

  ipcMain.handle('models:configure', async (_e, config: ModelConfig) => {
    try {
      const { configureModel } = await import('./config/model-configure');
      const result = await configureModel(config);
      if (result.ok) broadcastSettingsChanged();
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('models:test', async (_e, config: ModelConfig) => {
    try {
      const { OpenAICompatClient } = await import('./llm/openai-compat');
      const client = new OpenAICompatClient(config);
      return await client.testConnection();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Models v2
  ipcMain.handle('models:getAll', async () => {
    const { loadConfig } = await import('./config/config-v2');
    const { listKeys } = await import('./config/secrets');
    const cfg = await loadConfig();
    const keys = await listKeys();
    return cfg.models.map((m) => ({
      id: m.id,
      label: m.label,
      baseUrl: m.baseUrl,
      model: m.model,
      workDir: m.workDir,
      createdAt: m.createdAt,
      hasKey: !!keys[m.id],
      isActive: m.id === cfg.activeModelId,
      contextWindow: m.contextWindow,
    }));
  });

  ipcMain.handle('models:remove', async (_e, modelId: string) => {
    const { removeModel } = await import('./config/config-v2');
    const { deleteKey } = await import('./config/secrets');
    await removeModel(modelId);
    await deleteKey(modelId);
    broadcastSettingsChanged();
  });

  ipcMain.handle('models:setActive', async (_e, modelId: string) => {
    const { setActiveModel } = await import('./config/config-v2');
    await setActiveModel(modelId);
    broadcastSettingsChanged();
  });

  ipcMain.handle('models:updateWorkDir', async (_e, modelId: string, workDir: string) => {
    const { loadConfig, saveConfig } = await import('./config/config-v2');
    const cfg = await loadConfig();
    const idx = cfg.models.findIndex((m) => m.id === modelId);
    if (idx < 0) throw new Error(`Model 不存在: ${modelId}`);
    cfg.models[idx] = { ...cfg.models[idx]!, workDir };
    await saveConfig(cfg);
  });

  ipcMain.handle('models:updateKey', async (_e, modelId: string, newKey: string) => {
    const { setKey } = await import('./config/secrets');
    await setKey(modelId, newKey);
    broadcastSettingsChanged();
  });

  ipcMain.handle('models:updateContextWindow', async (_e, modelId: string, contextWindow: number) => {
    const { loadConfig, saveConfig } = await import('./config/config-v2');
    const cfg = await loadConfig();
    const idx = cfg.models.findIndex((m) => m.id === modelId);
    if (idx < 0) throw new Error(`Model 不存在: ${modelId}`);
    cfg.models[idx] = { ...cfg.models[idx]!, contextWindow };
    await saveConfig(cfg);
    broadcastSettingsChanged();
  });

  // Chat
  ipcMain.handle('chat:start', async (_e, request: ChatRequest): Promise<{ streamId: string }> => {
    const configured = await resolveSessionExecutionContext(request.sessionId);
    const streamId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void runAgentLoopForIpc(request, configured, streamId);
    return { streamId };
  });

  // P0-2: 取消任务
  ipcMain.on('chat:abort', (_e, streamId: string) => {
    if (chatStreams.abort(streamId)) {
      log.info(`[chat:abort] stream ${streamId} 已取消`);
    }
  });

  // P0-1: 审批响应
  ipcMain.on('approval:respond', (_e, approvalId: string, approved: boolean) => {
    if (chatStreams.respond(approvalId, approved)) {
      log.info(`[approval:respond] ${approvalId} → ${approved ? '同意' : '拒绝'}`);
    }
  });

  // Tools (仅开发环境，绕过 LLM 直调)
  if (isDev) {
    ipcMain.handle('tools:invoke', async (_e, name: ToolName, args: ToolArgs): Promise<ToolResult> => {
      const { invokeTool } = await import('./agent/tools');
      const configured = await loadModelsConfig();
      const cwd = configured?.workDir ?? process.cwd();
      return invokeTool(name, args, cwd);
    });
  }

  // Dialog: 选工作目录
  ipcMain.handle('dialog:openDirectory', async (): Promise<string | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作目录',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFile', async (_e, workDir: string): Promise<string | null> => {
    if (!mainWindow) return null;
    if (typeof workDir !== 'string' || !workDir.trim()) throw new Error('工作目录无效');
    await assertWorkDirAllowed(workDir);
    const root = path.resolve(workDir);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目文件',
      defaultPath: root,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const { verifyExistingPath } = await import('./fs/path-security');
    const check = await verifyExistingPath(path.resolve(result.filePaths[0]!), root);
    if (!check.ok) throw new Error(check.error);
    const stat = await fs.stat(check.realPath);
    if (!stat.isFile()) throw new Error('选择的路径不是文件');
    return check.realPath;
  });

  ipcMain.handle('dialog:selectProjectFile', async (): Promise<ProjectFileSelection | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目入口文件',
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const selected = await fs.realpath(path.resolve(result.filePaths[0]!));
    const stat = await fs.stat(selected);
    if (!stat.isFile()) throw new Error('选择的路径不是文件');
    const workDir = await grantWorkDir(path.dirname(selected));
    return { path: selected, workDir };
  });

  // 文件夹模式：选择项目工作区目录，自动探测 README.md 作为可选入口文件
  ipcMain.handle('dialog:selectProjectDir', async (): Promise<{ workDir: string; entryFile?: string } | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const workDir = await grantWorkDir(result.filePaths[0]!);
    let entryFile: string | undefined;
    const readmePath = path.join(workDir, 'README.md');
    try {
      await fs.access(readmePath);
      entryFile = readmePath;
    } catch {
      // 无 README.md → 入口文件留空
    }
    return { workDir, entryFile };
  });

  ipcMain.handle('dialog:createProjectFile', async (): Promise<ProjectFileSelection | null> => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '新建项目入口文件',
      defaultPath: 'README.md',
      buttonLabel: '新建文件',
    });
    if (result.canceled || !result.filePath) return null;

    const requested = path.resolve(result.filePath);
    const realParent = await fs.realpath(path.dirname(requested));
    const filePath = path.join(realParent, path.basename(requested));
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(filePath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('文件已存在，请更换名称');
      }
      throw error;
    } finally {
      await handle?.close();
    }
    const workDir = await grantWorkDir(realParent);
    return { path: filePath, workDir };
  });

  // FS: 列目录树 / 读文件（W4）—— workDir 必须来自已配置的工作区
  ipcMain.handle('fs:listTree', async (_e, cwd: string, maxDepth?: number) => {
    await assertWorkDirAllowed(cwd);
    const { listTree } = await import('./fs/tree');
    return listTree(cwd, maxDepth);
  });

  ipcMain.handle('fs:readFile', async (_e, workDir: string, filePath: string, maxBytes?: number) => {
    await assertWorkDirAllowed(workDir);
    const { readFileContent } = await import('./fs/tree');
    return readFileContent(workDir, filePath, maxBytes);
  });

  // FS: 用系统默认应用打开（文件用默认 app，目录用资源管理器）
  ipcMain.handle('fs:openPath', async (_e, workDir: string, filePath: string) => {
    await assertWorkDirAllowed(workDir);
    const { isWithinDir } = await import('./fs/path-security');
    const root = path.resolve(workDir);
    const resolved = path.resolve(filePath);
    if (!isWithinDir(resolved, root)) {
      throw new Error(`路径超出允许范围：${resolved}`);
    }
    // 真实路径检查（防 symlink 绕过）
    const { verifyExistingPath } = await import('./fs/path-security');
    const check = await verifyExistingPath(resolved, root);
    if (!check.ok) throw new Error(check.error);
    const result = await shell.openPath(check.realPath);
    if (result) throw new Error(`打开失败：${result}`);
    return true;
  });

  ipcMain.handle('fs:createFile', async (_e, workDir: string, relativePath: string) => {
    if (typeof workDir !== 'string' || !workDir.trim()) throw new Error('工作目录无效');
    if (typeof relativePath !== 'string') throw new Error('文件名无效');
    await assertWorkDirAllowed(workDir);
    const { createEmptyFile } = await import('./fs/tree');
    return createEmptyFile(workDir, relativePath);
  });

  // Projects
  ipcMain.handle('projects:list', async () => {
    const { listProjects } = await import('./store/db');
    const projects = listProjects();
    const { listSessions } = await import('./store/db');
    const sessions = listSessions();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      workDir: p.workDir,
      entryFile: p.entryFile,
      updatedAt: p.updatedAt,
      sessionCount: sessions.filter((s) => s.projectId === p.id).length,
    }));
  });

  ipcMain.handle('projects:create', async (_e, args: { name: string; workDir: string; entryFile?: string }) => {
    if (typeof args?.name !== 'string' || !args.name.trim()) throw new Error('项目名称不能为空');
    if (typeof args?.workDir !== 'string' || !args.workDir.trim()) throw new Error('请选择项目文件夹');
    const { v4: uuid } = await import('uuid');
    const { createProject } = await import('./store/db');
    let entryFile: string | undefined;
    if (typeof args.entryFile === 'string' && args.entryFile.trim()) {
      const selection = await verifyProjectSelection(args.workDir, args.entryFile.trim());
      entryFile = selection.path;
    }
    return createProject({
      id: uuid(),
      name: args.name.trim().slice(0, 50),
      workDir: args.workDir.trim(),
      entryFile,
    });
  });

  ipcMain.handle('projects:updateFile', async (_e, id: string, selection: ProjectFileSelection) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('项目 ID 无效');
    if (typeof selection?.workDir !== 'string' || typeof selection?.path !== 'string') {
      throw new Error('项目文件无效');
    }
    const verified = await verifyProjectSelection(selection.workDir, selection.path);
    const { updateProjectFile } = await import('./store/db');
    return updateProjectFile(id.trim(), verified.workDir, verified.path);
  });

  ipcMain.handle('projects:delete', async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('项目 ID 无效');
    const { deleteProject } = await import('./store/db');
    deleteProject(id.trim());
  });

  ipcMain.handle('projects:rename', async (_e, id: string, name: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('项目 ID 无效');
    if (typeof name !== 'string' || !name.trim()) throw new Error('项目名称不能为空');
    const { renameProject } = await import('./store/db');
    renameProject(id.trim(), name.trim().slice(0, 50));
  });

  // Sessions
  ipcMain.handle('sessions:list', async () => {
    const { listSessions } = await import('./store/db');
    return listSessions().map((s) => ({
      id: s.id,
      title: s.title,
      modelId: s.modelId,
      workDir: s.workDir,
      projectId: s.projectId,
      messageCount: s.messageCount,
      updatedAt: s.updatedAt,
    }));
  });

  ipcMain.handle('sessions:get', async (_e, id: string) => {
    const { getSession, getMessages } = await import('./store/db');
    const session = getSession(id);
    if (!session) throw new Error(`Session 不存在: ${id}`);
    const messages = getMessages(id);
    return { session, messages };
  });

  ipcMain.handle('sessions:create', async (_e, args: { modelId: string; workDir?: string; title?: string; projectId?: string }) => {
    const { v4: uuid } = await import('uuid');
    const { createSession, getProject } = await import('./store/db');
    const { getKey } = await import('./config/secrets');
    if (!getKey(args.modelId)) {
      throw new Error(`Model ${args.modelId} 未配置 API key`);
    }
    let workDir = args.workDir;
    if (args.projectId) {
      const project = getProject(args.projectId);
      if (!project) throw new Error('项目不存在或已被删除');
      if (!project.workDir) throw new Error('该项目尚未设置入口文件');
      workDir = project.workDir;
    }
    if (!workDir) throw new Error('请先创建项目并设置入口文件');
    await assertWorkDirAllowed(workDir);
    const id = uuid();
    return createSession({
      id,
      title: args.title ?? 'New session',
      modelId: args.modelId,
      workDir,
      projectId: args.projectId,
    });
  });

  ipcMain.handle('sessions:delete', async (_e, id: string) => {
    const { deleteSession } = await import('./store/db');
    deleteSession(id);
  });

  ipcMain.handle('sessions:rename', async (_e, id: string, title: string) => {
    const { renameSession } = await import('./store/db');
    renameSession(id, title);
  });

  ipcMain.handle('sessions:saveMessages', async (_e, id: string, messages: MessageRow[]) => {
    const { saveMessages } = await import('./store/db');
    saveMessages(id, messages);
  });

  ipcMain.handle('sessions:appendMessage', async (_e, id: string, message: MessageRow) => {
    const { appendMessage } = await import('./store/db');
    appendMessage({ ...message, sessionId: id });
  });

  ipcMain.handle('sessions:move', async (_e, sessionId: string, projectId: string | null) => {
    const { moveSession } = await import('./store/db');
    moveSession(sessionId, projectId);
  });

  // Settings
  ipcMain.handle('settings:openWindow', (_e, tab?: string) => {
    openSettingsWindow(tab);
    return true;
  });

  ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
    const { loadConfig } = await import('./config/config-v2');
    const cfg = await loadConfig();
    return cfg.app;
  });

  ipcMain.handle('settings:update', async (_e, partial: Partial<AppSettings>) => {
    const { loadConfig, saveConfig } = await import('./config/config-v2');
    const cfg = await loadConfig();
    cfg.app = { ...cfg.app, ...partial };
    await saveConfig(cfg);
    broadcastSettingsChanged();
  });

  ipcMain.handle('settings:clearAllData', async () => {
    const { wipeAllData } = await import('./config/wipe-data');
    await wipeAllData();
    broadcastSettingsChanged();
  });

  ipcMain.handle('settings:resetSelective', async (_e, level: 'sessions' | 'memories' | 'all') => {
    if (level === 'all') {
      const { wipeAllData } = await import('./config/wipe-data');
      await wipeAllData();
      broadcastSettingsChanged();
      return { cleared: 'all' as const };
    }
    if (level === 'sessions') {
      const { deleteAllSessions } = await import('./store/db');
      const count = deleteAllSessions();
      broadcastSettingsChanged();
      return { cleared: 'sessions' as const, count };
    }
    if (level === 'memories') {
      const { deleteAllMemories } = await import('./memory/memory-store');
      const count = deleteAllMemories();
      broadcastSettingsChanged();
      return { cleared: 'memories' as const, count };
    }
  });

  ipcMain.handle('settings:openDataDir', async () => {
    const { getAppDataDir } = await import('./config/data-dir');
    const dir = getAppDataDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('settings:openLogFile', async (_e, name: 'main' | 'renderer') => {
    const logPath = name === 'main'
      ? path.join(app.getPath('logs'), 'main.log')
      : path.join(app.getPath('logs'), 'renderer.log');
    await shell.openPath(logPath);
  });

  ipcMain.handle('settings:collectDiagnostics', async () => {
    const { loadConfig } = await import('./config/config-v2');
    const { listSessions, countAllMessages } = await import('./store/db');
    const { listKeys } = await import('./config/secrets');
    const cfg = await loadConfig();
    const sessions = listSessions();
    const keys = await listKeys();
    // 真实数据（不再硬编码桩值）
    let dbSizeBytes = 0;
    let logTail = '';
    try {
      const { getDb } = await import('./store/db');
      const dbFile = getDb().name;
      dbSizeBytes = (await fs.stat(dbFile)).size;
    } catch {
      // db 文件不可读时保持 0
    }
    try {
      const logFile = path.join(app.getPath('logs'), 'main.log');
      const raw = await fs.readFile(logFile, 'utf8');
      logTail = raw.slice(-2000);
    } catch {
      // 日志不存在时保持空
    }
    // 脱敏：不包含 API key
    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.version,
      appDataPath: app.getPath('userData'),
      envPath: getEnvPath(),
      logPath: app.getPath('logs'),
      dbSizeBytes,
      sessionCount: sessions.length,
      messageCount: countAllMessages(),
      modelCount: cfg.models.length,
      activeModelId: cfg.activeModelId,
      modelsWithKey: cfg.models.filter((m) => !!keys[m.id]).map((m) => m.id),
      logTail,
      collectedAt: new Date().toISOString(),
    };
  });

  // 校验技能文件相对路径：resolve 后必须在 workDir/skills 内，返回绝对路径。
  // mode 'existing'（update/delete）用 verifyExistingPath 做真实路径校验（防 symlink 指向外部被覆盖/删除），
  // mode 'write'（create）用 verifyWritePath 校验父目录，失败均抛其 error。
  async function assertSkillFile(workDir: string, file: string, mode: 'existing' | 'write'): Promise<string> {
    const skillsDir = path.join(workDir, 'skills');
    const resolved = path.resolve(skillsDir, file);
    const { verifyExistingPath, verifyWritePath } = await import('./fs/path-security');
    const check =
      mode === 'write' ? await verifyWritePath(resolved, skillsDir) : await verifyExistingPath(resolved, skillsDir);
    if (!check.ok) throw new Error(check.error);
    return check.realPath;
  }

  ipcMain.handle('skills:list', async (_e, workDir: string) => {
    // 安全：只允许读取已授权项目工作目录内的 skills/
    await assertWorkDirAllowed(workDir);
    const { loadSkills } = await import('./agent/skills');
    return loadSkills(workDir);
  });

  ipcMain.handle('skills:listDetailed', async (_e, workDir: string) => {
    await assertWorkDirAllowed(workDir);
    const { loadSkillsWithErrors } = await import('./agent/skills');
    return loadSkillsWithErrors(workDir);
  });

  ipcMain.handle('skills:create', async (_e, workDir: string, input: { name: string; description: string; prompt: string }) => {
    await assertWorkDirAllowed(workDir);
    const { buildSkillMarkdown, sanitizeSkillName } = await import('./agent/skills');
    const name = sanitizeSkillName(input.name);
    if (!name) throw new Error('技能名称不能为空');
    const file = `${name}.md`;
    const resolved = await assertSkillFile(workDir, file, 'write');
    let exists = true;
    try {
      await fs.access(resolved);
    } catch {
      exists = false;
    }
    if (exists) throw new Error(`技能已存在：${file}`);
    await fs.writeFile(resolved, buildSkillMarkdown({ name, description: input.description, prompt: input.prompt }), 'utf-8');
    broadcastSettingsChanged();
    return { file };
  });

  ipcMain.handle('skills:update', async (_e, workDir: string, file: string, patch: { name?: string; description?: string; prompt?: string; enabled?: boolean }) => {
    await assertWorkDirAllowed(workDir);
    if (path.isAbsolute(file)) throw new Error('技能文件需为相对路径');
    if (!file.endsWith('.md')) throw new Error('旧格式技能仅支持删除');
    const { mergeSkillFrontmatter } = await import('./agent/skills');
    const resolved = await assertSkillFile(workDir, file, 'existing');
    const original = await fs.readFile(resolved, 'utf-8');
    await fs.writeFile(resolved, mergeSkillFrontmatter(original, patch), 'utf-8');
    broadcastSettingsChanged();
  });

  ipcMain.handle('skills:delete', async (_e, workDir: string, file: string) => {
    await assertWorkDirAllowed(workDir);
    if (path.isAbsolute(file)) throw new Error('技能文件需为相对路径');
    const resolved = await assertSkillFile(workDir, file, 'existing');
    await fs.unlink(resolved);
    broadcastSettingsChanged();
  });

  // MCP 服务器管理
  ipcMain.handle('mcp:list', async (): Promise<McpServerConfig[]> => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    return mcpManager.listServers();
  });

  ipcMain.handle('mcp:add', async (_e, cfg: McpServerConfig) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    await mcpManager.addServer(cfg);
    broadcastSettingsChanged();
  });

  ipcMain.handle('mcp:update', async (_e, id: string, patch: Partial<McpServerConfig>) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    await mcpManager.updateServer(id, patch);
    broadcastSettingsChanged();
  });

  ipcMain.handle('mcp:remove', async (_e, id: string) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    await mcpManager.removeServer(id);
    broadcastSettingsChanged();
  });

  ipcMain.handle('mcp:test', async (_e, cfg: McpServerConfig) => {
    const { mcpManager } = await import('./mcp/mcp-manager');
    return mcpManager.testConnection(cfg);
  });

  // Memory OS
  ipcMain.handle('memory:search', async (_e, query: string, options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number }) => {
    const { searchMemories } = await import('./memory/memory-store');
    return searchMemories({ query, scope: options?.scope, kind: options?.kind, limit: options?.limit });
  });

  ipcMain.handle('memory:list', async (_e, options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number; offset?: number }) => {
    const { listMemories } = await import('./memory/memory-store');
    return listMemories({ scope: options?.scope, kind: options?.kind, limit: options?.limit, offset: options?.offset });
  });

  ipcMain.handle('memory:save', async (_e, memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>) => {
    const { saveMemory } = await import('./memory/memory-store');
    return saveMemory(memory);
  });

  ipcMain.handle('memory:update', async (_e, id: string, patch: { content?: string; importance?: number; tags?: string[] }) => {
    const { updateMemory } = await import('./memory/memory-store');
    updateMemory(id, patch);
  });

  ipcMain.handle('memory:delete', async (_e, id: string) => {
    const { deleteMemory } = await import('./memory/memory-store');
    deleteMemory(id);
  });

  ipcMain.handle('memory:stats', async () => {
    const { getMemoryStats } = await import('./memory/memory-store');
    return getMemoryStats();
  });

  ipcMain.handle('memory:exportSingle', async (_e, id: string): Promise<{ path: string } | null> => {
    const { listMemories } = await import('./memory/memory-store');
    const { memoryToMarkdown, exportFileName } = await import('./memory/memory-md');
    const all = listMemories({ limit: 1000 });
    const memory = all.find((m) => m.id === id);
    if (!memory) throw new Error('记忆不存在');
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出记忆',
      defaultPath: exportFileName(memory),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, memoryToMarkdown(memory), 'utf-8');
    return { path: result.filePath };
  });

  ipcMain.handle('memory:exportAll', async (): Promise<{ path: string; count: number } | null> => {
    const { listMemories } = await import('./memory/memory-store');
    const { memoriesToExport, exportAllFileName } = await import('./memory/memory-md');
    const all = listMemories({ limit: 1000 });
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出全部记忆',
      defaultPath: exportAllFileName(),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, memoriesToExport(all), 'utf-8');
    return { path: result.filePath, count: all.length };
  });

  ipcMain.handle('memory:copyMd', async (_e, id: string): Promise<string> => {
    const { listMemories } = await import('./memory/memory-store');
    const { memoryToMarkdown } = await import('./memory/memory-md');
    const memory = listMemories({ limit: 1000 }).find((m) => m.id === id);
    if (!memory) throw new Error('记忆不存在');
    return memoryToMarkdown(memory);
  });
}

async function verifyProjectSelection(workDir: string, filePath: string): Promise<ProjectFileSelection> {
  await assertWorkDirAllowed(workDir);
  const root = path.resolve(workDir);
  const { verifyExistingPath } = await import('./fs/path-security');
  const check = await verifyExistingPath(path.resolve(filePath), root);
  if (!check.ok) throw new Error(check.error);
  const stat = await fs.stat(check.realPath);
  if (!stat.isFile()) throw new Error('项目入口必须是文件');
  return { path: check.realPath, workDir: root };
}

/**
 * 验证 renderer 传入的 workDir 是否来自现有项目、旧会话/模型配置，
 * 或本次原生文件选择明确授予的目录。防止 renderer 通过 IPC 读取任意目录。
 */
async function assertWorkDirAllowed(workDir: string): Promise<void> {
  const [{ loadConfig }, { listProjects, listSessions }] = await Promise.all([
    import('./config/config-v2'),
    import('./store/db'),
  ]);
  const cfg = await loadConfig();
  const allowed = cfg.models
    .map((m) => m.workDir)
    .filter((d): d is string => !!d);
  allowed.push(...listProjects().map((project) => project.workDir).filter((d): d is string => !!d));
  allowed.push(...listSessions().map((session) => session.workDir).filter((d): d is string => !!d));
  // 兼容旧版 app 设置中的默认工作目录
  if (cfg.app.workDirDefault) allowed.push(cfg.app.workDirDefault);

  const resolved = await normalizeWorkDir(workDir);
  if (grantedWorkDirs.has(resolved)) return;
  for (const dir of allowed) {
    if ((await normalizeWorkDir(dir)) === resolved) return;
  }
  throw new Error(`工作目录不在已配置的工作区内：${workDir}`);
}

async function runAgentLoopForIpc(
  request: ChatRequest,
  model: ModelConfig,
  streamId: string,
): Promise<void> {
  const send = (event: ChatStreamEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat-stream', { streamId, event });
    }
  };

  const last = request.messages[request.messages.length - 1];
  if (!last || last.role !== 'user') {
    send({ type: 'error', error: '消息历史末尾必须是 user 消息' });
    return;
  }
  const history = request.messages.slice(0, -1);

  // M4.1: 上下文压缩阈值随模型 contextWindow 自适应（默认 24K 阈值对 256K 窗口过保守）
  const { compressionForContextWindow } = await import('./agent/compress');
  const compression = compressionForContextWindow(model.contextWindow);

  // P0-2: 创建 AbortController
  const ctrl = chatStreams.start(streamId);
  let terminalEventSent = false;
  let taskCompleted = false;
  let taskFailed = false;

  // macOS 深度适配：Agent 执行期间阻止系统休眠（长任务不被打断）
  let powerSaveId: number | null = null;
  if (process.platform === 'darwin') {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  }

  try {
    // 使用已验证的工作目录（chat:start 已检查 model.workDir 必须存在）
    const cwd = model.workDir!;

    // 加载 skills（注入 system prompt）
    let skills: import('../shared/ipc').SkillDef[] = [];
    try {
      const { loadSkills } = await import('./agent/skills');
      skills = await loadSkills(cwd);
    } catch {
      // skills 加载失败不影响 agent 运行
    }

    // 加载 MCP 工具（注入 extraTools）
    let extraTools: import('../shared/ipc').OpenAITool[] = [];
    try {
      const { mcpManager } = await import('./mcp/mcp-manager');
      extraTools = await mcpManager.getEnabledTools();
    } catch {
      // MCP 工具加载失败不影响 agent 运行
    }

    for await (const event of runAgentLoop(last.content, {
      model,
      cwd,
      history,
      compression,
      planMode: request.planMode ?? false,
      platform: { platform: process.platform, arch: process.arch },
      skills,
      extraTools,
      signal: ctrl.signal,
      onApproval: async (toolCall) => {
        // P0-1: 向前端发送审批请求，等待用户响应
        const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const toolName = toolCall.function.name;

        send({
          type: 'approval_required',
          approval: { id: approvalId, toolName, args: toolCall.function.arguments, toolCallId: toolCall.id },
        });

        const requestedTimeout = request.approvalTimeoutMs ?? 60_000;
        const timeoutMs = Math.min(Math.max(requestedTimeout, 1_000), 300_000);
        return chatStreams.requestApproval(streamId, approvalId, timeoutMs);
      },
      onPlanApproval: async (plan) => {
        const approvalId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        send({
          type: 'plan_approval_required',
          planApproval: { id: approvalId, plan: plan.steps.map((s) => s.description) },
        });
        const requestedTimeout = request.approvalTimeoutMs ?? 60_000;
        const timeoutMs = Math.min(Math.max(requestedTimeout, 1_000), 300_000);
        return chatStreams.requestApproval(streamId, approvalId, timeoutMs);
      },
    })) {
      // P0-2: 检查是否已 abort
      if (ctrl.signal.aborted) break;
      send(event);
      if (event.type === 'task_complete') taskCompleted = true;
      if (event.type === 'error') taskFailed = true;
      if (event.type === 'done' || event.type === 'error') terminalEventSent = true;
    }

    // M2.3: 任务结束系统通知（仅窗口未聚焦时）+ Dock bounce
    const windowActive = mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFocused();
    if (!windowActive && !ctrl.signal.aborted && (taskCompleted || taskFailed)) {
      // macOS：Dock 图标弹跳提示
      if (process.platform === 'darwin') {
        app.dock?.bounce(taskFailed ? 'critical' : 'informational');
      }
      notifyTaskEnd(
        { completed: taskCompleted, failed: taskFailed, aborted: false },
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        },
      );
    }
  } catch (err) {
    if (!ctrl.signal.aborted) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    // 清理
    chatStreams.cleanup(streamId);
    if (!terminalEventSent) send({ type: 'done' });

    // macOS：任务结束恢复系统休眠策略
    if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }

    // 异步提取记忆（不阻塞会话结束）
    void extractMemoriesFromSession(request, model).catch(() => {});
  }
}

/**
 * 会话结束后异步提取记忆。失败静默忽略。
 */
async function extractMemoriesFromSession(
  request: ChatRequest,
  model: ModelConfig,
): Promise<void> {
  try {
    const { getMessages, getSession } = await import('./store/db');
    const { extractMemories } = await import('./memory/memory-extractor');
    const { OpenAICompatClient } = await import('./llm/openai-compat');

    const messages = getMessages(request.sessionId);
    if (messages.length < 2) return;

    const session = getSession(request.sessionId);
    const scope = session?.projectId ? 'project' as const : 'personal' as const;
    const scopeId = session?.projectId ?? undefined;

    const client = new OpenAICompatClient(model);
    const llmCall = async (systemPrompt: string, userMessage: string): Promise<string> => {
      return client.summarize(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        30_000,
      );
    };

    const chatMessages: import('../shared/ipc').ChatMessage[] = messages.map((m) => ({
      role: m.role as import('../shared/ipc').ChatMessage['role'],
      content: m.content,
    }));

    const saved = await extractMemories(chatMessages, scope, scopeId, `session:${request.sessionId}`, llmCall);
    if (saved.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memories-extracted', { sessionId: request.sessionId, count: saved.length });
    }
  } catch {
    // 记忆提取失败不影响用户体验
  }
}

/**
 * Resolve the exact model and work directory bound to a session. A global
 * active-model change must not silently send an existing session to another
 * provider or run it in a different workspace.
 */
async function resolveSessionExecutionContext(sessionId: string): Promise<ModelConfig> {
  const [{ getSession, getProject }, { loadConfig }, { getKey }] = await Promise.all([
    import('./store/db'),
    import('./config/config-v2'),
    import('./config/secrets'),
  ]);
  return resolveSessionModel(sessionId, {
    getSession,
    getProject,
    loadConfig,
    getKey,
    isDirectory: async (candidate) => {
      try {
        return (await fs.stat(candidate)).isDirectory();
      } catch {
        return false;
      }
    },
  });
}

// ============================================
// App lifecycle
// ============================================

app.whenReady().then(async () => {
  // M2.3: Windows toast 通知需要 AppUserModelID
  if (process.platform === 'win32') app.setAppUserModelId('work.stellara.app');
  const { setAppDataDir, migrateLegacyAppData } = await import('./config/data-dir');
  const appDataDir = app.getPath('userData');
  setAppDataDir(appDataDir);
  try {
    const copied = await migrateLegacyAppData(appDataDir);
    if (copied.length > 0) {
      log.info(`已迁移旧版应用数据：${copied.join(', ')}`);
    }
  } catch (err) {
    log.error('旧版应用数据迁移失败，将使用标准应用数据目录', err);
  }

  await loadEnv();

  // API key 加密：Windows 上用 safeStorage（DPAPI）加密存储；不可用时降级明文并警告
  try {
    const { _setCipher, migrateLegacyKeys } = await import('./config/secrets');
    if (safeStorage.isEncryptionAvailable()) {
      _setCipher({
        encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
        decrypt: (b) => safeStorage.decryptString(Buffer.from(b, 'base64')),
      });
    } else {
      log.warn('safeStorage 不可用，API key 将以明文存储（当前环境不支持加密）');
    }
    try {
      const migrated = await migrateLegacyKeys();
      if (migrated > 0) {
        log.info(`已将 ${migrated} 个 API key 加密迁移`);
      }
    } catch (err) {
      log.error('API key 加密迁移失败', err);
    }
  } catch (err) {
    log.error('API key 加密初始化失败', err);
  }

  // W3: 旧 config 迁移 + 初始化 db
  try {
    const { migrateFromV1 } = await import('./config/config-v2');
    const migrated = await migrateFromV1();
    if (migrated) {
      log.info('已迁移旧 config.json 到新格式');
    }
  } catch (err) {
    log.error('config 迁移失败', err);
  }
  try {
    const { initDb, getDb } = await import('./store/db');
    initDb();
    // Memory OS: 初始化记忆存储
    const { setMemoryDb } = await import('./memory/memory-store');
    setMemoryDb(getDb);
  } catch (err) {
    log.error('db 初始化失败', err);
  }

  registerIpcHandlers();
  createWindow();
  installAppMenu(() => mainWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// M2.4: macOS 拖文件到 Dock 图标 / Finder 打开 → 通知渲染层处理该路径
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenFile = filePath;
    return;
  }
  mainWindow.show();
  mainWindow.webContents.send('menu:action', 'open-path:' + filePath);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    if (pendingOpenFile) {
      mainWindow?.webContents.send('menu:action', 'open-path:' + pendingOpenFile);
      pendingOpenFile = null;
    }
  }
});

app.on('will-quit', () => {
  try {
    // 同步关闭 db（better-sqlite3 是同步 API）
    // 用 require 避免顶层 await
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbModule = require('./store/db') as { closeDb: () => void };
    dbModule.closeDb();
  } catch {
    // ignore
  }
});

// 安全：阻止新窗口创建
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(RENDERER_DEV_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
});
