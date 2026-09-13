import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { buildAppMenuTemplate } from './menu-template';
import type { MenuAction } from '../shared/ipc';

export interface InstallAppMenuOptions {
  platform?: NodeJS.Platform;
  isDev?: boolean;
}

/**
 * macOS 原生菜单栏（仅 darwin）；Windows / Linux 生产环境清空默认菜单。
 *
 * - macOS：自定义菜单，生产环境不暴露 reload / forceReload / toggleDevTools 及其默认快捷键。
 * - Windows / Linux 生产：`Menu.setApplicationMenu(null)`，避免 Electron 自动生成的默认菜单
 *   暴露 reload / toggleDevTools 及其快捷键；开发环境保留默认菜单便于调试。
 *
 * 菜单项通过 'menu:action' 事件驱动渲染层 UI，与渲染层快捷键系统复用同一动作语义。
 */
export function installAppMenu(
  getWindow: () => BrowserWindow | null,
  options: InstallAppMenuOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const isDev = options.isDev ?? process.env.NODE_ENV === 'development';

  if (platform !== 'darwin') {
    if (!isDev) Menu.setApplicationMenu(null);
    return;
  }

  // M2.5: 原生关于面板（应用菜单 → 关于）
  app.setAboutPanelOptions({
    applicationName: 'Stellara Work',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron} · Node ${process.versions.node}`,
    copyright: '© 2026 Stellara Work',
    credits: '数据本地的 Codex 风格桌面 Agent：所有数据（密钥、会话、文件）仅保存在本地，不上传。',
    website: 'https://strashineltd.github.io',
  });

  const send = (action: MenuAction) => {
    getWindow()?.webContents.send('menu:action', action);
  };

  const template: MenuItemConstructorOptions[] = buildAppMenuTemplate({
    appName: app.name,
    isDev,
    onAction: send,
    openHomepage: () => void shell.openExternal('https://strashineltd.github.io'),
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // M2.4: Dock 右键菜单（macOS）。点击行为与菜单栏"任务"菜单一致。
  if (app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: '新建会话', click: () => send('new-session') },
        { label: '命令面板…', click: () => send('open-command-palette') },
        { type: 'separator' },
        { label: '设置…', click: () => send('open-settings') },
        { type: 'separator' },
        { role: 'quit', label: '退出 Stellara Work' },
      ]),
    );
  }
}
