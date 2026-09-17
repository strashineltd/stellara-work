import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildTrayMenuTemplate, shouldHideOnClose, type TrayDeps } from './tray-logic';

// 本文件刻意不 mock electron：tray-logic.ts 不得在导入期依赖 electron（P12）。

function makeDeps(paused = false) {
  const state = { paused };
  return {
    state,
    onOpen: vi.fn(),
    onTogglePause: vi.fn(),
    onQuit: vi.fn(),
    isPaused: () => state.paused,
  } satisfies TrayDeps & { state: { paused: boolean } };
}

function labels(template: MenuItemConstructorOptions[]): Array<string | undefined> {
  return template.map((item) => item.label ?? item.type);
}

describe('shouldHideOnClose', () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])('backgroundScheduling=%s isQuitting=%s -> %s', (setting, quitting, expected) => {
    expect(shouldHideOnClose(setting, quitting)).toBe(expected);
  });

  it('never hides when the tray is unavailable (regression: tray 创建失败不得拦截关闭)', () => {
    expect(shouldHideOnClose(true, false, false)).toBe(false);
    expect(shouldHideOnClose(true, true, false)).toBe(false);
    expect(shouldHideOnClose(false, false, false)).toBe(false);
  });

  it('hides only when the tray is available and scheduling runs in background', () => {
    expect(shouldHideOnClose(true, false, true)).toBe(true);
  });
});

describe('buildTrayMenuTemplate', () => {
  it('offers open / 暂停调度 / 退出 while scheduling is running', () => {
    const deps = makeDeps(false);

    const template = buildTrayMenuTemplate(deps);

    expect(labels(template)).toEqual(['打开主窗口', '暂停调度', 'separator', '退出']);
  });

  it('shows 恢复调度 while scheduling is paused', () => {
    const template = buildTrayMenuTemplate(makeDeps(true));

    expect(labels(template)).toContain('恢复调度');
    expect(labels(template)).not.toContain('暂停调度');
  });

  it('invokes the matching callback for each item', () => {
    const deps = makeDeps(false);
    const template = buildTrayMenuTemplate(deps);

    (template[0]!.click as unknown as () => void)();
    (template[1]!.click as unknown as () => void)();
    (template[3]!.click as unknown as () => void)();

    expect(deps.onOpen).toHaveBeenCalledTimes(1);
    expect(deps.onTogglePause).toHaveBeenCalledTimes(1);
    expect(deps.onQuit).toHaveBeenCalledTimes(1);
  });
});
