/**
 * 危险工具的主进程原生确认（S4）。
 *
 * 渲染层审批（approval:respond）可被同一被攻破的 renderer 自批。
 * write_file / edit_file / run_command / browser_exec_js / dispatch_subagents
 * 必须以 dialog.showMessageBox 的真实用户手势为准；渲染层只作展示。
 */
import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';

/** 必须走原生确认的工具（与 tool-policy.DANGEROUS_TOOLS 中的高危子集对齐） */
export const NATIVE_CONFIRM_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'browser_exec_js',
  'dispatch_subagents',
]);

export function requiresNativeConfirm(toolName: string): boolean {
  return NATIVE_CONFIRM_TOOLS.has(toolName);
}

/** 把工具参数格式化为确认框 detail（截断，避免巨参撑爆对话框） */
export function formatToolArgs(args: string, maxChars = 1200): string {
  const raw = typeof args === 'string' ? args : JSON.stringify(args ?? '');
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n…（已截断）`;
}

/**
 * 原生确认框。无窗口或用户取消时返回 false（fail-closed）。
 * 不依赖渲染层，XSS 无法代点。
 */
export async function confirmDangerousTool(
  win: BrowserWindow | null,
  toolName: string,
  args: string,
): Promise<boolean> {
  if (!win || win.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认执行敏感工具',
    message: `即将执行「${toolName}」，请核对参数：`,
    detail: formatToolArgs(args),
    buttons: ['取消', '允许执行'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
}
