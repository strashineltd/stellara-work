import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

// 本文件专测 electron 面向的 createAppTray；纯逻辑见 tray.test.ts（不 mock electron）。

type Handler = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => {
  interface CreatedImage {
    iconPath: string;
    isEmpty: ReturnType<typeof vi.fn>;
    setTemplateImage: ReturnType<typeof vi.fn>;
  }
  const createdImages: CreatedImage[] = [];
  class MockTray {
    static instances: MockTray[] = [];
    icon: unknown;
    tooltip = '';
    contextMenu: unknown = null;
    poppedMenu: unknown = undefined;
    destroyed = false;
    handlers: Record<string, Handler> = {};
    constructor(icon: unknown) {
      this.icon = icon;
      MockTray.instances.push(this);
    }
    on = vi.fn((event: string, handler: Handler) => {
      this.handlers[event] = handler;
      return this;
    });
    setToolTip = vi.fn((text: string) => {
      this.tooltip = text;
    });
    setContextMenu = vi.fn((menu: unknown) => {
      this.contextMenu = menu;
    });
    popUpContextMenu = vi.fn((menu?: unknown) => {
      this.poppedMenu = menu;
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
    });
    emit(event: string): void {
      this.handlers[event]?.();
    }
  }
  return {
    createdImages,
    MockTray,
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    createFromPath: vi.fn((iconPath: string) => {
      const image: CreatedImage = {
        iconPath,
        isEmpty: vi.fn(() => false),
        setTemplateImage: vi.fn(),
      };
      createdImages.push(image);
      return image;
    }),
  };
});

vi.mock('electron', () => ({
  Tray: mocks.MockTray,
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  nativeImage: { createFromPath: mocks.createFromPath },
}));

import { createAppTray } from './tray';

// createAppTray 的纯逻辑依赖（不经 tray-logic 的 electron 类型）
function makeDeps(paused = false) {
  const state = { paused };
  return {
    state,
    onOpen: vi.fn(),
    onTogglePause: vi.fn(),
    onQuit: vi.fn(),
    isPaused: () => state.paused,
  };
}

function lastTemplate(): MenuItemConstructorOptions[] {
  return mocks.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[];
}

function labels(template: MenuItemConstructorOptions[]): Array<string | undefined> {
  return template.map((item) => item.label ?? item.type);
}

describe('createAppTray', () => {
  beforeEach(() => {
    mocks.MockTray.instances.length = 0;
    mocks.createdImages.length = 0;
    mocks.buildFromTemplate.mockClear();
    mocks.createFromPath.mockClear();
  });

  it('uses the macOS template icon and opens the window on left click', () => {
    const deps = makeDeps(false);
    createAppTray(deps, { platform: 'darwin', assetDir: '/tmp/assets' });

    const tray = mocks.MockTray.instances[0]!;
    expect(mocks.createFromPath).toHaveBeenCalledWith('/tmp/assets/trayTemplate.png');
    expect(mocks.createdImages[0]!.setTemplateImage).toHaveBeenCalledWith(true);
    expect(tray.tooltip).toBe('Stellara Work');

    tray.emit('click');
    expect(deps.onOpen).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the macOS menu on right click so pause state stays fresh', () => {
    const deps = makeDeps(false);
    createAppTray(deps, { platform: 'darwin', assetDir: '/tmp/assets' });
    const tray = mocks.MockTray.instances[0]!;

    // macOS 设置 context menu 会吞掉左键 click，故只用右键弹出
    expect(tray.setContextMenu).not.toHaveBeenCalled();

    tray.emit('right-click');
    expect(labels(lastTemplate())).toContain('暂停调度');
    expect(tray.poppedMenu).toEqual({ template: lastTemplate() });

    deps.state.paused = true;
    tray.emit('right-click');
    expect(labels(lastTemplate())).toContain('恢复调度');
  });

  it('installs a context menu on Windows and refreshes it on demand', () => {
    const deps = makeDeps(false);
    const handle = createAppTray(deps, { platform: 'win32', assetDir: '/tmp/assets' });

    const tray = mocks.MockTray.instances[0]!;
    expect(mocks.createFromPath).toHaveBeenCalledWith('/tmp/assets/tray.png');
    expect(mocks.createdImages[0]!.setTemplateImage).not.toHaveBeenCalled();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);
    expect(labels(lastTemplate())).toContain('暂停调度');

    deps.state.paused = true;
    handle.refreshMenu();
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2);
    expect(labels(lastTemplate())).toContain('恢复调度');

    tray.emit('click');
    expect(deps.onOpen).toHaveBeenCalledTimes(1);
  });

  it('destroys the tray through the handle', () => {
    const handle = createAppTray(makeDeps(false), { platform: 'darwin', assetDir: '/tmp/assets' });

    handle.destroy();

    expect(mocks.MockTray.instances[0]!.destroyed).toBe(true);
  });

  it('throws when the icon cannot be loaded so the caller can fall back to a normal close', () => {
    mocks.createFromPath.mockReturnValueOnce({
      iconPath: '/tmp/assets/tray.png',
      isEmpty: vi.fn(() => true),
      setTemplateImage: vi.fn(),
    });

    expect(() => createAppTray(makeDeps(false), { platform: 'win32', assetDir: '/tmp/assets' })).toThrow(
      /托盘图标加载失败/,
    );
    expect(mocks.MockTray.instances).toHaveLength(0);
  });

  it('main.ts only intercepts close when a tray handle exists (regression)', () => {
    const source = readFileSync(path.resolve(__dirname, 'main.ts'), 'utf-8');

    expect(source).toMatch(
      /shouldHideOnClose\(\s*backgroundSchedulingEnabled,\s*isQuitting,\s*appTray !== null,?\s*\)/,
    );
    expect(source).toContain("import { shouldHideOnClose } from './tray-logic'");
  });
});
