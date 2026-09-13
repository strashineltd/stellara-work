/**
 * IPC sender 校验（防御纵深）
 *
 * 应用为单窗口，所有 IPC 应来自主窗口 webContents 的主框架。
 * 其他 sender（被攻破的 webview/子 frame/未知来源）一律拒绝。
 */

interface WebContentsLike {
  isDestroyed(): boolean;
  /** Electron WebContents.mainFrame；测试替身可能缺失 */
  mainFrame?: unknown;
}

export function isTrustedIpcSender(
  sender: unknown,
  trusted: WebContentsLike | null | undefined,
  senderFrame?: unknown,
): boolean {
  if (!sender || !trusted) return false;
  if (sender !== trusted) return false;
  if (trusted.isDestroyed()) return false;
  // 提供了 senderFrame（真实 Electron 事件必提供）时必须是主框架。
  // undefined 表示测试替身未提供，按既有行为放行。
  if (senderFrame !== undefined) {
    return senderFrame === trusted.mainFrame;
  }
  return true;
}
