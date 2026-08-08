import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from '../shared/ipc';
import { openSettingsWindow } from './settings-window';

/**
 * macOS 原生菜单栏（仅 darwin）。
 *
 * Windows / Linux 保持现状（autoHideMenuBar + 无自定义菜单）。
 * 菜单项通过 'menu:action' 事件驱动渲染层 UI，与渲染层快捷键系统复用同一动作语义。
 */
export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  if (process.platform !== 'darwin') return;

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

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 Stellara Work' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => openSettingsWindow() },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Stellara Work' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Stellara Work' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '任务',
      submenu: [
        { label: '新建会话', accelerator: 'Cmd+N', click: () => send('new-session') },
        { label: '命令面板…', accelerator: 'Cmd+K', click: () => send('open-command-palette') },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '全部置于最前' },
      ],
    },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        {
          label: 'Stellara Work 产品网站',
          click: () => void shell.openExternal('https://strashineltd.github.io'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // M2.4: Dock 右键菜单（macOS）。点击行为与菜单栏"任务"菜单一致。
  if (app.dock) {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        { label: '新建会话', click: () => send('new-session') },
        { label: '命令面板…', click: () => send('open-command-palette') },
        { type: 'separator' },
        { label: '设置…', click: () => openSettingsWindow() },
        { type: 'separator' },
        { role: 'quit', label: '退出 Stellara Work' },
      ]),
    );
  }
}
