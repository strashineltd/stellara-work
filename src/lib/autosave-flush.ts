/** 当前挂载视图注册的自动保存落盘器（模块级单槽：同一时刻只有一个主视图）。 */
type AutosaveFlusher = () => Promise<void> | void;

let flusher: AutosaveFlusher | null = null;

/**
 * 注册自动保存落盘器，返回注销函数。
 * 重复注册会替换上一个；旧视图注销时不会清掉新视图的注册（卸载/挂载交错安全）。
 */
export function registerAutosaveFlusher(fn: AutosaveFlusher): () => void {
  flusher = fn;
  return () => {
    if (flusher === fn) flusher = null;
  };
}

/**
 * 身份切换等临界操作前调用：等待当前视图把 pending 的自动保存落盘。
 * 未注册时为 no-op；落盘失败只记录日志，不阻塞后续操作。
 */
export async function runAutosaveFlush(): Promise<void> {
  if (!flusher) return;
  try {
    await flusher();
  } catch (e) {
    console.error('Autosave flush failed:', e);
  }
}
