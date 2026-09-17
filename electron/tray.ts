import { Menu, Tray, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';

export interface TrayDeps {
  /** 左键点击托盘 / 「打开主窗口」：显示并聚焦主窗口 */
  onOpen: () => void;
  /** 「暂停调度 / 恢复调度」：切换调度运行时暂停态 */
  onTogglePause: () => void;
  /** 「退出」：真正退出应用（调用方需先放行 close 拦截） */
  onQuit: () => void;
  /** 当前暂停状态（函数形式：菜单每次构建时读取最新值） */
  isPaused: () => boolean;
}

export interface CreateAppTrayOptions {
  platform?: NodeJS.Platform;
  /** 图标目录覆盖（默认与 main.ts 一致，从编译后的 electron/dist/electron 解析 assets/） */
  assetDir?: string;
}

export interface TrayHandle {
  /** 重建上下文菜单（暂停状态变化后调用，Windows/Linux 生效） */
  refreshMenu: () => void;
  destroy: () => void;
}

/**
 * P12：关闭窗口时是否隐藏而非退出。
 * 仅当开启后台调度且应用未处于退出流程时为 true（Cmd+Q / 托盘退出必须真正退出）。
 */
export function shouldHideOnClose(backgroundScheduling: boolean, isQuitting: boolean): boolean {
  return backgroundScheduling && !isQuitting;
}

/**
 * 托盘上下文菜单模板（纯函数，便于测试）。
 * 暂停时菜单项显示为「恢复调度」，否则显示「暂停调度」。
 */
export function buildTrayMenuTemplate(deps: TrayDeps): MenuItemConstructorOptions[] {
  const paused = deps.isPaused();
  return [
    { label: '打开主窗口', click: () => deps.onOpen() },
    { label: paused ? '恢复调度' : '暂停调度', click: () => deps.onTogglePause() },
    { type: 'separator' },
    { label: '退出', click: () => deps.onQuit() },
  ];
}

/**
 * 创建系统托盘（P11/P12）。
 *
 * - macOS：使用 Template 图标（随系统深浅色自动反色），左键开窗、右键弹出菜单
 *   （setContextMenu 会吞掉左键 click 事件，故不设置），菜单每次弹出时按最新状态重建。
 * - Windows/Linux：使用彩色图标，右键弹出 setContextMenu 设置的菜单，左键开窗；
 *   暂停状态变化后由调用方触发 refreshMenu()。
 */
export function createAppTray(deps: TrayDeps, options: CreateAppTrayOptions = {}): TrayHandle {
  const platform = options.platform ?? process.platform;
  const assetDir = options.assetDir ?? path.join(__dirname, '..', '..', '..', 'assets');
  const isMac = platform === 'darwin';

  const icon = nativeImage.createFromPath(path.join(assetDir, isMac ? 'trayTemplate.png' : 'tray.png'));
  if (isMac) icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('Stellara Work');

  const buildMenu = () => Menu.buildFromTemplate(buildTrayMenuTemplate(deps));

  let refreshMenu: () => void;
  if (isMac) {
    // 右键按需重建并弹出，菜单始终反映最新暂停状态
    refreshMenu = () => {
      // 无需常驻菜单：下次右键弹出时会重新构建
    };
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  } else {
    refreshMenu = () => tray.setContextMenu(buildMenu());
    refreshMenu();
  }
  tray.on('click', () => deps.onOpen());

  return {
    refreshMenu,
    destroy: () => {
      tray.destroy();
    },
  };
}
