import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { McpServerConfig } from '../../shared/ipc';

/** 将 stdio 命令与参数格式化为一行，供确认框逐字核对 */
export function formatMcpCommand(cfg: McpServerConfig): string {
  return [cfg.command, ...(cfg.args ?? [])].join(' ');
}

/** HTTP MCP 端点摘要（URL + 是否携带鉴权头；不打印头值） */
export function formatMcpHttpTarget(cfg: McpServerConfig): string {
  const authNote = cfg.hasAuth || (cfg.headers && Object.keys(cfg.headers).length > 0)
    ? '（含鉴权请求头）'
    : '';
  return `${cfg.url ?? '(未设置 url)'}${authNote}`;
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

/**
 * S9：HTTP MCP 同样需要原生确认（可携带 Authorization，且工具会驱动 agent）。
 * 无窗口或用户取消时返回 false（fail-closed）。
 */
export async function confirmMcpHttpServer(
  win: BrowserWindow | null,
  cfg: McpServerConfig,
): Promise<boolean> {
  if (!win) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认连接 MCP 服务器',
    message: `将连接 MCP 服务器「${cfg.name}」：`,
    detail: formatMcpHttpTarget(cfg),
    buttons: ['取消', '确认'],
    defaultId: 0,
    cancelId: 0,
  });
  return response === 1;
}

/**
 * S9：任何 MCP 增改（含 HTTP）统一走原生确认。
 * approval 变为 never 时在摘要中提示「工具将自动执行」。
 */
export async function confirmMcpServerChange(
  win: BrowserWindow | null,
  cfg: McpServerConfig,
): Promise<boolean> {
  if (!win) return false;
  if (cfg.transport === 'stdio') return confirmStdioMcpCommand(win, cfg);
  const never = cfg.approval === 'never' ? '\n⚠️ 审批策略为「从不」：该服务器工具将自动执行。' : '';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '确认连接 MCP 服务器',
    message: `将连接 MCP 服务器「${cfg.name}」：`,
    detail: `${formatMcpHttpTarget(cfg)}${never}`,
    buttons: ['取消', '确认'],
    defaultId: 0,
    cancelId: 0,
  });
  return response === 1;
}
