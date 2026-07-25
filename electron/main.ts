import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import log from 'electron-log/main';
import { loadEnv, getEnvPath } from './config/env';
import { loadModelsConfig, saveModelConfig } from './config/models';
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
    // __dirname 在 electron/dist/electron/，需要 ../.. 回到项目根，再拼 dist/index.html
    // 用 app.getAppPath() 更稳
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    log.info(`Loading renderer from: ${indexPath}`);
    mainWindow.loadFile(indexPath);
  }

  // 兜底：5 秒后还没显示就强制 show
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

  // Debug: log renderer errors to console
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

  // 外链走系统浏览器
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

  // Models
  ipcMain.handle('models:list', async (): Promise<ModelListResponse> => {
    const { MODEL_PRESETS } = await import('./llm/presets');
    const configured = await loadModelsConfig();
    return {
      presets: MODEL_PRESETS,
      configured,
    };
  });

  ipcMain.handle('models:configure', async (_e, config: ModelConfig) => {
    try {
      const preset = findPreset(config.id);
      if (!preset) {
        return { ok: false, error: `未知模型：${config.id}` };
      }
      // 合并用户填的（custom 用用户值，内置用 preset 默认）
      const final: ModelConfig = {
        id: config.id,
        label: config.label,
        baseUrl: config.baseUrl || preset.baseUrl,
        model: config.model || preset.model,
        apiKey: config.apiKey,
        isCustom: config.isCustom,
      };
      await saveModelConfig(final);
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

  // Chat
  ipcMain.handle('chat:send', async (_e, request: ChatRequest) => {
    const configured = await loadModelsConfig();
    if (!configured) {
      throw new Error('未配置模型，请先在设置中配置 API key');
    }
    return runAgentLoopForIpc(request, configured);
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
}

async function* runAgentLoopForIpc(
  request: ChatRequest,
  model: ModelConfig,
): AsyncGenerator<ChatStreamEvent> {
  const userMsg = request.messages[request.messages.length - 1];
  if (!userMsg || userMsg.role !== 'user') {
    yield { type: 'error', error: '消息历史末尾必须是 user 消息' };
    return;
  }

  for await (const event of runAgentLoop(userMsg.content, {
    model,
    cwd: process.cwd(),
    // W1: 暂时自动批准所有危险操作（UI 批准机制 W2 实现）
    onApproval: async () => true,
  })) {
    yield event;
  }
}

// ============================================
// App lifecycle
// ============================================

app.whenReady().then(async () => {
  await loadEnv();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 安全：阻止新窗口创建
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(RENDERER_DEV_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
});
