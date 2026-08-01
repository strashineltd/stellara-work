import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import log from 'electron-log/main';
import { loadEnv, getEnvPath } from './config/env';
import { loadModelsConfig } from './config/models';
import { runAgentLoop } from './agent/loop';
import { findPreset } from './llm/presets';
import type {
  AppInfo,
  ModelConfig,
  ModelListResponse,
  ChatRequest,
  ChatStreamEvent,
  ToolName,
  ToolArgs,
  ToolResult,
  MessageRow,
  AppSettings,
} from '../shared/ipc';

const isDev = process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = 'http://localhost:5173';

log.initialize();
log.info('Stellara Work 启动中...');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
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
    const appDataPath = path.join(os.homedir(), '.stellara');
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
    const key = getKey(active.id) ?? '';
    const configured: ModelConfig = {
      id: active.id as ModelConfig['id'],
      label: active.label,
      baseUrl: active.baseUrl,
      model: active.model,
      apiKey: key,
      workDir: active.workDir,
      isCustom: false,
    };
    return { presets: MODEL_PRESETS, configured };
  });

  ipcMain.handle('models:configure', async (_e, config: ModelConfig) => {
    try {
      const preset = findPreset(config.id);
      const { upsertModel } = await import('./config/config-v2');
      const { setKey } = await import('./config/secrets');
      const entry = {
        id: config.id,
        label: config.label,
        baseUrl: config.baseUrl || preset?.baseUrl || '',
        model: config.model || preset?.model || '',
        workDir: config.workDir,
        createdAt: new Date().toISOString(),
      };
      await upsertModel(entry);
      if (config.apiKey) {
        await setKey(config.id, config.apiKey);
      }
      return { ok: true };
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

  // Chat
  ipcMain.handle('chat:start', async (_e, request: ChatRequest): Promise<{ streamId: string }> => {
    const configured = await loadModelsConfig();
    if (!configured) {
      throw new Error('未配置模型，请先在设置中配置 API key');
    }
    const streamId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void runAgentLoopForIpc(request, configured, streamId);
    return { streamId };
  });

  // Tools (开发期直调，绕过 LLM)
  ipcMain.handle('tools:invoke', async (_e, name: ToolName, args: ToolArgs): Promise<ToolResult> => {
    const { invokeTool } = await import('./agent/tools');
    const cwd = process.cwd();
    return invokeTool(name, args, cwd);
  });

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

  // FS: 列目录树 / 读文件（W4）
  ipcMain.handle('fs:listTree', async (_e, cwd: string, maxDepth?: number) => {
    const { listTree } = await import('./fs/tree');
    return listTree(cwd, maxDepth);
  });

  ipcMain.handle('fs:readFile', async (_e, workDir: string, filePath: string, maxBytes?: number) => {
    const { readFileContent } = await import('./fs/tree');
    return readFileContent(workDir, filePath, maxBytes);
  });

  // FS: 用系统默认应用打开（文件用默认 app，目录用资源管理器）
  ipcMain.handle('fs:openPath', async (_e, workDir: string, filePath: string) => {
    const root = path.resolve(workDir);
    const resolved = path.resolve(filePath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`路径超出允许范围：${resolved}`);
    }
    const result = await shell.openPath(resolved);
    if (result) throw new Error(`打开失败：${result}`);
    return true;
  });

  // Sessions
  ipcMain.handle('sessions:list', async () => {
    const { listSessions } = await import('./store/db');
    return listSessions().map((s) => ({
      id: s.id,
      title: s.title,
      modelId: s.modelId,
      messageCount: s.messageCount,
      updatedAt: s.updatedAt,
    }));
  });

  ipcMain.handle('sessions:get', async (_e, id: string) => {
    const { getSession, getMessages } = await import('./store/db');
    const session = getSession(id);
    if (!session) throw new Error(`Session 不存在: ${id}`);
    const messages = getMessages(id);
    console.log('[DBG-MAIN] get', { id, msgCount: messages.length, dbCount: session.messageCount });
    return { session, messages };
  });

  ipcMain.handle('sessions:create', async (_e, args: { modelId: string; workDir?: string; title?: string }) => {
    const { v4: uuid } = await import('uuid');
    const { createSession } = await import('./store/db');
    const { getKey } = await import('./config/secrets');
    if (!getKey(args.modelId)) {
      throw new Error(`Model ${args.modelId} 未配置 API key`);
    }
    const id = uuid();
    return createSession({
      id,
      title: args.title ?? 'New session',
      modelId: args.modelId,
      workDir: args.workDir,
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
    console.log('[DBG-MAIN] save', { id, msgCount: messages.length });
    saveMessages(id, messages);
  });

  ipcMain.handle('sessions:appendMessage', async (_e, id: string, message: MessageRow) => {
    const { appendMessage } = await import('./store/db');
    appendMessage({ ...message, sessionId: id });
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
    const dir = path.join(os.homedir(), '.stellara');
    await fs.rm(dir, { recursive: true, force: true });
  });

  ipcMain.handle('settings:openDataDir', async () => {
    const dir = path.join(os.homedir(), '.stellara');
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('settings:openLogFile', async (_e, name: 'main' | 'renderer') => {
    const logPath = name === 'main'
      ? path.join(app.getPath('logs'), 'main.log')
      : path.join(app.getPath('logs'), 'renderer.log');
    await shell.openPath(logPath);
  });
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

  try {
    for await (const event of runAgentLoop(last.content, {
      model,
      cwd: model.workDir ?? process.cwd(),
      history,
      planMode: request.planMode ?? false,
      onApproval: async () => true,
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
      send(event);
    }
  } catch (err) {
    send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================
// App lifecycle
// ============================================

app.whenReady().then(async () => {
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
    const { initDb } = await import('./store/db');
    initDb();
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
