import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { McpServerConfig } from '../../shared/ipc';

/** 将 stdio 命令与参数格式化为一行，供确认框逐字核对 */
export function formatMcpCommand(cfg: McpServerConfig): string {
  return [cfg.command, ...(cfg.args ?? [])].join(' ');
}

/**
 * C3：stdio MCP 服务器会 spawn 本地进程，必须在主窗口用原生确认框
 * 展示完整 command/args，用户确认后才允许持久化、探测或变更命令。
 * 无窗口或用户取消时返回 false（fail-closed）。
 */
export async function confirmStdioMcpCommand(
  win: BrowserWindow | null,
  cfg: McpServerConfig,
): Promise<boolean> {
  if (!win) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认执行本地 MCP 命令',
    message: `MCP 服务器「${cfg.name}」将以本地命令启动：`,
    detail: formatMcpCommand(cfg),
    buttons: ['取消', '确认'],
    defaultId: 0,
    cancelId: 0,
  });
  return response === 1;
}
