import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { buildTrayMenuTemplate, type TrayDeps } from './tray-logic';

export type { TrayDeps } from './tray-logic';

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
 * 创建系统托盘（P11/P12）。
 *
 * - macOS：使用 Template 图标（随系统深浅色自动反色），左键开窗、右键弹出菜单
 *   （setContextMenu 会吞掉左键 click 事件，故不设置），菜单每次弹出时按最新状态重建。
 * - Windows/Linux：使用彩色图标，右键弹出 setContextMenu 设置的菜单，左键开窗；
 *   暂停状态变化后由调用方触发 refreshMenu()。
 *
 * 图标缺失/不可读时抛错：调用方保持托盘句柄为空，close 回退为正常关闭（避免进程失联）。
 */
export function createAppTray(deps: TrayDeps, options: CreateAppTrayOptions = {}): TrayHandle {
  const platform = options.platform ?? process.platform;
  const assetDir = options.assetDir ?? path.join(__dirname, '..', '..', '..', 'assets');
  const isMac = platform === 'darwin';

  const iconPath = path.join(assetDir, isMac ? 'trayTemplate.png' : 'tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    throw new Error(`托盘图标加载失败: ${iconPath}`);
  }
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
