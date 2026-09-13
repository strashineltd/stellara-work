import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => ({ mocked: true, template })),
  setAboutPanelOptions: vi.fn(),
  dockSetMenu: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    name: 'Stellara Work',
    getVersion: () => '0.9.3',
    setAboutPanelOptions: mocks.setAboutPanelOptions,
    dock: { setMenu: mocks.dockSetMenu },
  },
  Menu: {
    setApplicationMenu: mocks.setApplicationMenu,
    buildFromTemplate: mocks.buildFromTemplate,
  },
  shell: { openExternal: mocks.openExternal },
}));

import { installAppMenu } from './menu';

describe('installAppMenu platform policy', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockClear();
  });

  it('clears the Electron default menu on Windows in production', () => {
    installAppMenu(() => null, { platform: 'win32', isDev: false });

    expect(mocks.setApplicationMenu).toHaveBeenCalledTimes(1);
    expect(mocks.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(mocks.buildFromTemplate).not.toHaveBeenCalled();
  });

  it('clears the Electron default menu on Linux in production', () => {
    installAppMenu(() => null, { platform: 'linux', isDev: false });

    expect(mocks.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(mocks.buildFromTemplate).not.toHaveBeenCalled();
  });

  it('leaves the Electron default menu available on Windows/Linux in development', () => {
    installAppMenu(() => null, { platform: 'win32', isDev: true });

    expect(mocks.setApplicationMenu).not.toHaveBeenCalled();
  });

  it('installs the custom menu on macOS and keeps it dev-item-free in production', () => {
    installAppMenu(() => null, { platform: 'darwin', isDev: false });

    // 第一次 buildFromTemplate 是应用菜单，第二次是 Dock 右键菜单
    expect(mocks.buildFromTemplate).toHaveBeenCalledTimes(2);
    expect(mocks.setApplicationMenu).toHaveBeenCalledWith(
      mocks.buildFromTemplate.mock.results[0]?.value,
    );
    // 自定义菜单在 macOS 生产环境仍不得含 reload / devtools
    const template = mocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string;
      submenu?: Array<{ role?: string }>;
    }>;
    const roles = (template.find((item) => item.label === '视图')?.submenu ?? []).map(
      (item) => item.role,
    );
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });
});
