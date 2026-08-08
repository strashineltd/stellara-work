import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const isDev = process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = 'http://localhost:5173';

let settingsWindow: BrowserWindow | null = null;

/**
 * 打开独立设置窗口。已存在时聚焦复用；否则创建 760×640 固定尺寸窗口。
 * initialTab 决定默认标签页（models/sessions/app/skills/shortcuts）。
 */
export function openSettingsWindow(initialTab?: string): BrowserWindow | null {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  const tab = initialTab ?? 'models';
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 640,
    resizable: false,
    maximizable: false,
    minimizable: true,
    show: false,
    title: '设置',
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  if (isDev) {
    void settingsWindow.loadURL(`${RENDERER_DEV_URL}?window=settings&tab=${encodeURIComponent(tab)}`);
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    void settingsWindow.loadFile(indexPath, { query: { window: 'settings', tab } });
  }
  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });
  return settingsWindow;
}

/** 向所有窗口广播设置已变更（渲染层据此刷新本地状态） */
export function broadcastSettingsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings-changed', { at: Date.now() });
  }
}

export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
}
