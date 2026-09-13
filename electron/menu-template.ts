import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from '../shared/ipc';

export interface AppMenuTemplateOptions {
  appName: string;
  isDev: boolean;
  onAction: (action: MenuAction) => void;
  openHomepage: () => void;
}

/**
 * 纯模板构造：不做 Electron 调用，便于单测。
 * 生产环境隐藏 reload/forceReload/toggleDevTools（含其默认快捷键）。
 */
export function buildAppMenuTemplate({
  appName,
  isDev,
  onAction,
  openHomepage,
}: AppMenuTemplateOptions): MenuItemConstructorOptions[] {
  const devViewItems: MenuItemConstructorOptions[] = isDev
    ? [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
      ]
    : [];

  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: '关于 Stellara Work' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => onAction('open-settings') },
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
        ...devViewItems,
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
        { label: '新建会话', accelerator: 'Cmd+N', click: () => onAction('new-session') },
        { label: '命令面板…', accelerator: 'Cmd+K', click: () => onAction('open-command-palette') },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        // 红绿灯已移除，Cmd+W 是唯一的窗口关闭途径（Cmd+Q 退出整个应用）
        { role: 'close', label: '关闭窗口' },
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
          click: () => openHomepage(),
        },
      ],
    },
  ];
}
