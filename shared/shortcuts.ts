/**
 * 快捷键系统（共享类型，主/渲染进程都用）
 *
 * 序列化 KeyboardEvent → "Ctrl+Shift+P" 字符串；持久化到 ~/.stellara/config.json。
 */

export type ShortcutAction =
  | 'toggleSidebar'
  | 'toggleWorkspace'
  | 'togglePlanMode'
  | 'sendMessage'
  | 'rejectApproval'
  | 'openCommandPalette'
  | 'switchTab1'
  | 'switchTab2'
  | 'switchTab3'
  | 'switchTab4'
  | 'switchTab5'
  | 'switchTab6'
  | 'switchTab7'
  | 'switchTab8'
  | 'switchTab9'
  | 'closeActiveTab'
  | 'reopenClosedTab';

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  defaultBinding: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { action: 'toggleSidebar',      label: '切换左会话栏', defaultBinding: 'Ctrl+B' },
  { action: 'toggleWorkspace',    label: '切换右工作区', defaultBinding: 'Ctrl+Shift+W' },
  { action: 'togglePlanMode',     label: '切换 Plan 模式', defaultBinding: 'Ctrl+Shift+P' },
  { action: 'sendMessage',        label: '发送消息',     defaultBinding: 'Ctrl+Enter' },
  { action: 'rejectApproval',     label: '拒绝当前批准', defaultBinding: 'Escape' },
  { action: 'openCommandPalette', label: '打开命令面板', defaultBinding: 'Ctrl+K' },
  { action: 'switchTab1',         label: '切换到 Tab 1', defaultBinding: 'Ctrl+1' },
  { action: 'switchTab2',         label: '切换到 Tab 2', defaultBinding: 'Ctrl+2' },
  { action: 'switchTab3',         label: '切换到 Tab 3', defaultBinding: 'Ctrl+3' },
  { action: 'switchTab4',         label: '切换到 Tab 4', defaultBinding: 'Ctrl+4' },
  { action: 'switchTab5',         label: '切换到 Tab 5', defaultBinding: 'Ctrl+5' },
  { action: 'switchTab6',         label: '切换到 Tab 6', defaultBinding: 'Ctrl+6' },
  { action: 'switchTab7',         label: '切换到 Tab 7', defaultBinding: 'Ctrl+7' },
  { action: 'switchTab8',         label: '切换到 Tab 8', defaultBinding: 'Ctrl+8' },
  { action: 'switchTab9',         label: '切换到 Tab 9', defaultBinding: 'Ctrl+9' },
  { action: 'closeActiveTab',     label: '关闭当前 Tab', defaultBinding: 'Ctrl+W' },
  { action: 'reopenClosedTab',    label: '恢复关闭的 Tab', defaultBinding: 'Ctrl+Shift+T' },
];

export type ShortcutBindings = Partial<Record<ShortcutAction, string>>;

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  toggleSidebar:      'Ctrl+B',
  toggleWorkspace:    'Ctrl+Shift+W',
  togglePlanMode:     'Ctrl+Shift+P',
  sendMessage:        'Ctrl+Enter',
  rejectApproval:     'Escape',
  openCommandPalette: 'Ctrl+K',
  switchTab1:         'Ctrl+1',
  switchTab2:         'Ctrl+2',
  switchTab3:         'Ctrl+3',
  switchTab4:         'Ctrl+4',
  switchTab5:         'Ctrl+5',
  switchTab6:         'Ctrl+6',
  switchTab7:         'Ctrl+7',
  switchTab8:         'Ctrl+8',
  switchTab9:         'Ctrl+9',
  closeActiveTab:     'Ctrl+W',
  reopenClosedTab:    'Ctrl+Shift+T',
};

/**
 * 把 KeyboardEvent 序列化成 "Ctrl+Shift+P" 字符串。
 * - 单独的 modifier 按键（Control/Shift/Alt/Meta）返回 null
 * - 单字符 key 转大写
 * - 空格 → "Space"
 * - 其他按键名原样（Enter、Escape、ArrowUp 等）
 */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export function eventToBinding(e: KeyEventLike): string | null {
  const parts: string[] = [];
  // 项目 Windows 专属，但保留 metaKey 兼容 Mac
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null;
  const keyName = normalizeKey(k);
  if (!keyName) return null;
  parts.push(keyName);
  return parts.join('+');
}

function normalizeKey(k: string): string | null {
  if (k === ' ') return 'Space';
  if (k.length === 1) return k.toUpperCase();
  // 已是大写 / 命名键（Enter, Escape, ArrowUp, F1 等）
  if (/^[A-Za-z]+$/.test(k)) return k;
  return k;
}

/** 把 "Ctrl+Shift+P" 转回显示友好的 "Ctrl + Shift + P" */
export function formatBinding(s: string): string {
  return s.replace(/\+/g, ' + ');
}

/** 给定一个 binding 字符串找出属于哪个 action（第一个匹配的） */
export function findActionByBinding(bindings: ShortcutBindings, binding: string): ShortcutAction | undefined {
  for (const def of SHORTCUT_DEFS) {
    const actual = bindings[def.action] ?? DEFAULT_SHORTCUTS[def.action];
    if (actual === binding) return def.action;
  }
  return undefined;
}