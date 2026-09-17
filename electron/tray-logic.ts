import type { MenuItemConstructorOptions } from 'electron';

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

/**
 * P12：关闭窗口时是否隐藏而非退出。
 *
 * - 托盘不可用（创建失败 / 未创建）时不得拦截关闭，否则窗口关闭后进程失联；
 * - 仅在开启后台调度且应用未处于退出流程时隐藏（Cmd+Q / 托盘退出必须真正退出）。
 */
export function shouldHideOnClose(
  backgroundScheduling: boolean,
  isQuitting: boolean,
  trayAvailable = true,
): boolean {
  return trayAvailable && backgroundScheduling && !isQuitting;
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
