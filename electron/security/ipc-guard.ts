/**
 * IPC sender 校验（防御纵深）
 *
 * 应用为单窗口，所有 IPC 应来自主窗口 webContents。
 * 其他 sender（被攻破的 webview/子 frame/未知来源）一律拒绝。
 */

interface WebContentsLike {
  isDestroyed(): boolean;
}

export function isTrustedIpcSender(
  sender: unknown,
  trusted: WebContentsLike | null | undefined,
): boolean {
  if (!sender || !trusted) return false;
  if (sender !== trusted) return false;
  return !trusted.isDestroyed();
}
