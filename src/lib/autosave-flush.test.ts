import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAutosaveFlusher, runAutosaveFlush } from './autosave-flush';

describe('autosave flush registry', () => {
  afterEach(() => {
    // 清空模块级单槽，避免用例间相互影响
    const clear = registerAutosaveFlusher(() => {});
    clear();
  });

  it('is a no-op when no flusher is registered', async () => {
    await expect(runAutosaveFlush()).resolves.toBeUndefined();
  });

  it('awaits the registered flusher', async () => {
    let resolveFlush: () => void = () => {};
    const flusher = vi.fn(() => new Promise<void>((resolve) => { resolveFlush = resolve; }));
    registerAutosaveFlusher(flusher);

    let settled = false;
    const pending = runAutosaveFlush().then(() => { settled = true; });
    expect(flusher).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveFlush();
    await pending;
    expect(settled).toBe(true);
  });

  it('stops flushing after unregister', async () => {
    const flusher = vi.fn();
    registerAutosaveFlusher(flusher)();

    await runAutosaveFlush();
    expect(flusher).not.toHaveBeenCalled();
  });

  it('replaces the previous flusher when registered again', async () => {
    const first = vi.fn();
    const second = vi.fn();
    registerAutosaveFlusher(first);
    registerAutosaveFlusher(second);

    await runAutosaveFlush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps the newer flusher when a stale registration is unregistered', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerAutosaveFlusher(first);
    registerAutosaveFlusher(second);

    unregisterFirst();
    await runAutosaveFlush();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs flusher errors', async () => {
    const error = new Error('save rejected');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerAutosaveFlusher(() => { throw error; });

    await expect(runAutosaveFlush()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Autosave flush failed:', error);
    consoleError.mockRestore();
  });
});
