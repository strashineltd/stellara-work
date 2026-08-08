import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../../shared/ipc';
import { SettingsWindow } from '../SettingsWindow';

function installApi() {
  const mocks = {
    getAll: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ presets: [], configured: null }),
    configure: vi.fn().mockResolvedValue({ ok: true }),
    test: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    updateKey: vi.fn().mockResolvedValue(undefined),
    updateWorkDir: vi.fn().mockResolvedValue(undefined),
    updateContextWindow: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn().mockReturnValue(() => {}),
    settingsGet: vi.fn().mockResolvedValue({ theme: 'light' }),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      app: {
        getInfo: vi.fn().mockResolvedValue({ version: '0.9.0-test', platform: 'darwin', appDataPath: '/tmp', envPath: '/tmp' }),
        openSettingsWindow: vi.fn().mockResolvedValue(undefined),
        onSettingsChanged: mocks.onSettingsChanged,
      },
      settings: {
        get: mocks.settingsGet,
      },
      models: {
        getAll: mocks.getAll,
        list: mocks.list,
        configure: mocks.configure,
        test: mocks.test,
        remove: mocks.remove,
        setActive: mocks.setActive,
        updateKey: mocks.updateKey,
        updateWorkDir: mocks.updateWorkDir,
        updateContextWindow: mocks.updateContextWindow,
      },
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

describe('SettingsWindow', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.platform;
    delete document.documentElement.dataset.theme;
    mocks = installApi();
  });

  it('renders 5 nav tabs with the models panel by default', async () => {
    const { container } = await render(<SettingsWindow />);

    const items = container.querySelectorAll('.settings-nav__item');
    expect(items.length).toBe(5);
    expect(container.querySelector('.settings-nav__item.active')?.textContent).toContain('模型');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('模型');
  });

  it('falls back to models tab for an invalid initialTab', async () => {
    const { container } = await render(<SettingsWindow initialTab="bogus" />);

    expect(container.querySelector('.settings-nav__item.active')?.textContent).toContain('模型');
  });

  it('marks the requested tab active and mounts its panel', async () => {
    const sessionsList = vi.fn().mockResolvedValue([]);
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...window.electronAPI,
        sessions: { list: sessionsList, delete: vi.fn().mockResolvedValue(undefined) },
      } as unknown as ElectronAPI,
      writable: true,
      configurable: true,
    });
    const { container } = await render(<SettingsWindow initialTab="sessions" />);

    const sessions = container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessions?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('会话');
    expect(sessionsList).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).not.toHaveBeenCalled();
  });

  it('shows the version and sets platform on documentElement', async () => {
    const { container } = await render(<SettingsWindow />);

    expect(container.querySelector('.settings-window__version')?.textContent).toContain('0.9.0-test');
    expect(document.documentElement.dataset.platform).toBe('darwin');
  });

  it('reloads the models panel when settings-changed is broadcast', async () => {
    const { container } = await render(<SettingsWindow />);
    expect(mocks.getAll).toHaveBeenCalledTimes(1);

    const broadcast = mocks.onSettingsChanged.mock.calls[0]![0] as () => void;
    await act(async () => {
      broadcast();
    });

    expect(mocks.getAll).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('模型');
  });

  it('applies the saved theme to documentElement', async () => {
    mocks.settingsGet.mockResolvedValue({ theme: 'dark' });
    await render(<SettingsWindow />);

    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('re-syncs theme when settings-changed is broadcast', async () => {
    mocks.settingsGet.mockResolvedValue({ theme: 'light' });
    await render(<SettingsWindow />);
    expect(document.documentElement.dataset.theme).toBe('light');

    // 主窗口切到深色 → 广播 → 设置窗口重读主题并应用
    mocks.settingsGet.mockResolvedValue({ theme: 'dark' });
    const broadcast = mocks.onSettingsChanged.mock.calls[0]![0] as () => void;
    await act(async () => {
      broadcast();
    });

    expect(mocks.settingsGet).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows prefers-color-scheme changes when theme is system', async () => {
    let dark = true;
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        get matches() {
          return dark;
        },
        addEventListener: vi.fn().mockImplementation((_event: string, cb: () => void) => {
          listeners.push(cb);
        }),
        removeEventListener: vi.fn(),
      }),
    });
    mocks.settingsGet.mockResolvedValue({ theme: 'system' });
    await render(<SettingsWindow />);

    expect(document.documentElement.dataset.theme).toBe('dark');

    dark = false;
    await act(async () => {
      for (const cb of listeners) cb();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
