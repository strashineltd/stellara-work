import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import log from 'electron-log/main';
import { loadEnv, getEnvPath } from './config/env';
import { loadModelsConfig } from './config/models';
import { runAgentLoop } from './agent/loop';
import { ChatStreamRegistry } from './chat/stream-registry';
import { resolveSessionModel } from './chat/session-context';
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
} from '../shared/ipc';

const isDev = process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = 'http://localhost:5173';

log.initialize();
log.info('Stellara Work 启动中...');

let mainWindow: BrowserWindow | null = null;

// P0-1 + P0-2: 审批流和取消任务的状态管理
const chatStreams = new ChatStreamRegistry();
const grantedWorkDirs = new Set<string>();

function grantWorkDir(workDir: string): string {
  const resolved = path.resolve(workDir);
  grantedWorkDirs.add(resolved.toLowerCase());
  return resolved;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: '#65758B',
      height: 72,
    },
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
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
      platform: 'win32',
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
      return await configureModel(config);
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
  });

  ipcMain.handle('models:setActive', async (_e, modelId: string) => {
    const { setActiveModel } = await import('./config/config-v2');
    await setActiveModel(modelId);
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
  });

  ipcMain.handle('models:updateContextWindow', async (_e, modelId: string, contextWindow: number) => {
    const { loadConfig, saveConfig } = await import('./config/config-v2');
    const cfg = await loadConfig();
    const idx = cfg.models.findIndex((m) => m.id === modelId);
    if (idx < 0) throw new Error(`Model 不存在: ${modelId}`);
    cfg.models[idx] = { ...cfg.models[idx]!, contextWindow };
    await saveConfig(cfg);
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
    const workDir = grantWorkDir(path.dirname(selected));
    return { path: selected, workDir };
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
    const workDir = grantWorkDir(realParent);
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

  ipcMain.handle('projects:create', async (_e, args: { name: string; workDir: string; entryFile: string }) => {
    if (typeof args?.name !== 'string' || !args.name.trim()) throw new Error('项目名称不能为空');
    if (typeof args?.workDir !== 'string' || !args.workDir.trim()) throw new Error('请选择项目文件');
    if (typeof args?.entryFile !== 'string' || !args.entryFile.trim()) throw new Error('请选择项目文件');
    const selection = await verifyProjectSelection(args.workDir, args.entryFile);
    const { v4: uuid } = await import('uuid');
    const { createProject } = await import('./store/db');
    return createProject({
      id: uuid(),
      name: args.name.trim().slice(0, 50),
      workDir: selection.workDir,
      entryFile: selection.path,
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
  });

  ipcMain.handle('settings:clearAllData', async () => {
    try {
      const { closeDb } = await import('./store/db');
      closeDb();
    } catch {
      // ignore
    }
    const { getAppDataDir, getLegacyDataDir } = await import('./config/data-dir');
    const { resetEnvCache } = await import('./config/env');
    const dir = getAppDataDir();
    const legacyDir = getLegacyDataDir();
    const filesToDelete = [
      'config.json', 'config.json.bak', '.env',
      'stellara.db', 'stellara.db-wal', 'stellara.db-shm',
    ];
    // 顺序删除 runtime dir 文件，带重试（Windows 文件锁）
    for (const name of filesToDelete) {
      const filePath = path.join(dir, name);
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rm(filePath, { force: true });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const code = (err as NodeJS.ErrnoException).code;
          if (attempt < 2 && (code === 'EBUSY' || code === 'EPERM')) {
            await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
            continue;
          }
        }
      }
      if (lastErr) {
        const code = (lastErr as NodeJS.ErrnoException).code;
        if (code === 'EBUSY' || code === 'EPERM') {
          throw new Error('无法删除数据文件：文件被占用。请关闭应用后重试。');
        }
        throw lastErr;
      }
    }
    // 遗留目录清理（独立 try，不受 runtime dir 错误影响）
    try {
      await Promise.all(
        filesToDelete.map((name) => fs.rm(path.join(legacyDir, name), { force: true })),
      );
    } catch {
      // 遗留目录删除失败不阻塞重置
    }
    // 重置 env 缓存
    resetEnvCache();
    // 重新初始化空数据库 + 记忆存储
    try {
      const { initDb, getDb } = await import('./store/db');
      initDb();
      const { setMemoryDb } = await import('./memory/memory-store');
      setMemoryDb(getDb);
    } catch {
      // ignore - will be re-initialized on next access
    }
  });

  ipcMain.handle('settings:resetSelective', async (_e, level: 'sessions' | 'memories' | 'all') => {
    if (level === 'all') {
      // 复用 clearAllData 逻辑：手动触发同一个 handler
      // 直接调用函数避免 IPC 递归
      const { closeDb } = await import('./store/db');
      try { closeDb(); } catch { /* ignore */ }
      const { getAppDataDir, getLegacyDataDir } = await import('./config/data-dir');
      const { resetEnvCache } = await import('./config/env');
      const dir = getAppDataDir();
      const legacyDir = getLegacyDataDir();
      const filesToDelete = [
        'config.json', 'config.json.bak', '.env',
        'stellara.db', 'stellara.db-wal', 'stellara.db-shm',
      ];
      for (const name of filesToDelete) {
        const filePath = path.join(dir, name);
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await fs.rm(filePath, { force: true });
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            const code = (err as NodeJS.ErrnoException).code;
            if (attempt < 2 && (code === 'EBUSY' || code === 'EPERM')) {
              await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
              continue;
            }
          }
        }
        if (lastErr) {
          const code = (lastErr as NodeJS.ErrnoException).code;
          if (code === 'EBUSY' || code === 'EPERM') {
            throw new Error('无法删除数据文件：文件被占用。请关闭应用后重试。');
          }
          throw lastErr;
        }
      }
      try {
        await Promise.all(
          filesToDelete.map((name) => fs.rm(path.join(legacyDir, name), { force: true })),
        );
      } catch { /* 遗留目录删除失败不阻塞 */ }
      resetEnvCache();
      try {
        const { initDb, getDb } = await import('./store/db');
        initDb();
        const { setMemoryDb } = await import('./memory/memory-store');
        setMemoryDb(getDb);
      } catch { /* ignore */ }
      return { cleared: 'all' as const };
    }
    if (level === 'sessions') {
      const { deleteAllSessions } = await import('./store/db');
      const count = deleteAllSessions();
      return { cleared: 'sessions' as const, count };
    }
    if (level === 'memories') {
      const { deleteAllMemories } = await import('./memory/memory-store');
      const count = deleteAllMemories();
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

  ipcMain.handle('skills:list', async (_e, workDir: string) => {
    // 安全：只允许读取已授权项目工作目录内的 skills/
    await assertWorkDirAllowed(workDir);
    const { loadSkills } = await import('./agent/skills');
    return loadSkills(workDir);
  });

  // Memory OS
  ipcMain.handle('memory:search', async (_e, query: string, options?: { scope?: string; kind?: string; limit?: number }) => {
    const { searchMemories } = await import('./memory/memory-store');
    return searchMemories({ query, scope: options?.scope as 'personal' | 'project' | 'workspace' | undefined, kind: options?.kind as 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting' | undefined, limit: options?.limit });
  });

  ipcMain.handle('memory:list', async (_e, options?: { scope?: string; kind?: string; limit?: number; offset?: number }) => {
    const { listMemories } = await import('./memory/memory-store');
    return listMemories({ scope: options?.scope as 'personal' | 'project' | 'workspace' | undefined, kind: options?.kind as 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting' | undefined, limit: options?.limit, offset: options?.offset });
  });

  ipcMain.handle('memory:save', async (_e, memory: { scope: string; scopeId?: string; kind: string; content: string; source?: string; importance?: number; confidence?: number; tags?: string[] }) => {
    const { saveMemory } = await import('./memory/memory-store');
    return saveMemory(memory as Parameters<typeof saveMemory>[0]);
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

  const resolved = path.resolve(workDir);
  if (grantedWorkDirs.has(resolved.toLowerCase())) return;
  for (const dir of allowed) {
    if (path.resolve(dir) === resolved) return;
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

  // P0-2: 创建 AbortController
  const ctrl = chatStreams.start(streamId);
  let terminalEventSent = false;

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

    for await (const event of runAgentLoop(last.content, {
      model,
      cwd,
      history,
      planMode: request.planMode ?? false,
      skills,
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
      if (event.type === 'done' || event.type === 'error') terminalEventSent = true;
    }
  } catch (err) {
    if (!ctrl.signal.aborted) {
      send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  } finally {
    // 清理
    chatStreams.cleanup(streamId);
    if (!terminalEventSent) send({ type: 'done' });

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

    await extractMemories(chatMessages, scope, scopeId, `session:${request.sessionId}`, llmCall);
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
