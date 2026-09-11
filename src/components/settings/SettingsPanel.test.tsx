import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../../shared/ipc';
import { SettingsPanel, type SettingsTab } from '../SettingsPanel';

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

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
    getInfo: vi.fn().mockResolvedValue({ version: '0.9.0-test', platform: 'darwin', appDataPath: '/tmp', envPath: '/tmp' }),
    serversList: vi.fn().mockResolvedValue([]),
    serversStatus: vi.fn().mockResolvedValue([]),
    serversOnStatusChanged: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      app: {
        getInfo: mocks.getInfo,
        onSettingsChanged: mocks.onSettingsChanged,
      },
      settings: {
        get: mocks.settingsGet,
      },
      servers: {
        list: mocks.serversList,
        status: mocks.serversStatus,
        onStatusChanged: mocks.serversOnStatusChanged,
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
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  await act(async () => {
    root.render(ui);
  });
  return {
    container,
    rerender: async (nextUi: React.ReactElement) => {
      await act(async () => {
        root!.render(nextUi);
      });
    },
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('SettingsPanel', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.platform;
    delete document.documentElement.dataset.theme;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks = installApi();
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders 7 nav tabs with the models panel by default', async () => {
    const { container } = await render(<SettingsPanel onClose={vi.fn()} />);

    const items = container.querySelectorAll('.settings-nav__item');
    expect(items.length).toBe(7);
    expect(Array.from(items).map((item) => item.textContent)).toContain('服务器');
    expect(container.querySelector('.settings-nav__item.active')?.textContent).toContain('模型');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('模型');
  });

  it('mounts the servers panel when its nav tab is selected', async () => {
    const { container } = await render(<SettingsPanel onClose={vi.fn()} />);

    const serversTab = container.querySelector('.settings-nav__item[data-tab="servers"]');
    expect(serversTab).toBeTruthy();
    await act(async () => {
      serversTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.settings-nav__item.active')?.textContent).toContain('服务器');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('服务器');
    expect(mocks.serversList).toHaveBeenCalledTimes(1);
    expect(mocks.serversStatus).toHaveBeenCalledTimes(1);
    expect(mocks.serversOnStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('falls back to models tab for an invalid initialTab', async () => {
    const { container } = await render(<SettingsPanel initialTab={'bogus' as SettingsTab} onClose={vi.fn()} />);

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
    const { container } = await render(<SettingsPanel initialTab="sessions" onClose={vi.fn()} />);

    const sessions = container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessions?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('会话');
    expect(sessionsList).toHaveBeenCalledTimes(1);
    expect(mocks.getAll).not.toHaveBeenCalled();
  });

  it('sets platform on documentElement', async () => {
    await render(<SettingsPanel onClose={vi.fn()} />);

    expect(document.documentElement.dataset.platform).toBe('darwin');
  });

  it('does not apply a pending platform read after unmount', async () => {
    let resolveInfo!: (value: Awaited<ReturnType<ElectronAPI['app']['getInfo']>>) => void;
    const infoPromise = new Promise<Awaited<ReturnType<ElectronAPI['app']['getInfo']>>>((resolve) => {
      resolveInfo = resolve;
    });
    mocks.getInfo.mockReturnValue(infoPromise);
    const view = await render(<SettingsPanel onClose={vi.fn()} />);
    view.unmount();
    document.documentElement.dataset.platform = 'test-platform';

    await act(async () => {
      resolveInfo({ version: '0.9.0-test', platform: 'win32', appDataPath: '/tmp', envPath: '/tmp' });
      await infoPromise;
    });

    expect(document.documentElement.dataset.platform).toBe('test-platform');
  });

  it('unmounts idempotently and removes document and settings listeners', async () => {
    const unsubscribe = vi.fn();
    mocks.onSettingsChanged.mockReturnValue(unsubscribe);
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const view = await render(<SettingsPanel onClose={vi.fn()} />);

    view.unmount();

    expect(() => view.unmount()).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const { container } = await render(<SettingsPanel onClose={onClose} />);

    const backdrop = container.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    await act(async () => {
      backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the panel', async () => {
    const onClose = vi.fn();
    const { container } = await render(<SettingsPanel onClose={onClose} />);

    const modal = container.querySelector('.settings-modal');
    expect(modal).not.toBeNull();
    await act(async () => {
      modal!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 面板内点击（含 nav 切换）不冒泡到 backdrop，不触发关闭
    const sessions = container.querySelector('.settings-nav__item[data-tab="sessions"]') as HTMLElement;
    await act(async () => {
      sessions.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.settings-nav__item.active')?.textContent).toContain('会话');
  });

  it('closes on Escape while open and ignores Escape and backdrop clicks while closing', async () => {
    const onClose = vi.fn();
    const completeExit = vi.fn();
    const view = await render(
      <SettingsPanel presence={{ state: 'open', completeExit }} onClose={onClose} />,
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await view.rerender(
      <SettingsPanel presence={{ state: 'closing', completeExit }} onClose={onClose} />,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      view.container.querySelector('.modal-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('selects and focuses the requested non-default nav tab when Settings opens', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...window.electronAPI,
        sessions: { list: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(undefined) },
      } as unknown as ElectronAPI,
      writable: true,
      configurable: true,
    });
    const view = await render(
      <SettingsPanel
        initialTab="sessions"
        presence={{ state: 'entering', completeExit: vi.fn() }}
        onClose={vi.fn()}
      />,
    );

    const sessionsTab = view.container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessionsTab?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(sessionsTab);
    view.unmount();
  });

  it('selects and focuses the requested tab when reduced motion mounts Settings directly open', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...window.electronAPI,
        sessions: { list: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(undefined) },
      } as unknown as ElectronAPI,
      writable: true,
      configurable: true,
    });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const view = await render(
      <SettingsPanel
        initialTab="sessions"
        focusRequest={1}
        presence={{ state: 'open', completeExit: vi.fn() }}
        onClose={vi.fn()}
      />,
    );

    const sessionsTab = view.container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessionsTab?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(sessionsTab);
    view.unmount();
    outside.remove();
  });

  it('syncs and focuses a changed request while Settings is already open', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...window.electronAPI,
        sessions: { list: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(undefined) },
      } as unknown as ElectronAPI,
      writable: true,
      configurable: true,
    });
    const completeExit = vi.fn();
    const onClose = vi.fn();
    const view = await render(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'open', completeExit }}
        onClose={onClose}
      />,
    );

    await view.rerender(
      <SettingsPanel
        initialTab="sessions"
        focusRequest={2}
        presence={{ state: 'open', completeExit }}
        onClose={onClose}
      />,
    );

    const sessionsTab = view.container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessionsTab?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(sessionsTab);
    view.unmount();
  });

  it('refocuses the requested tab for a repeated request while Settings is already open', async () => {
    const completeExit = vi.fn();
    const onClose = vi.fn();
    const view = await render(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'open', completeExit }}
        onClose={onClose}
      />,
    );
    const modelsTab = view.container.querySelector('.settings-nav__item[data-tab="models"]');
    const sessionsTab = view.container.querySelector('.settings-nav__item[data-tab="sessions"]') as HTMLButtonElement;
    sessionsTab.focus();

    await view.rerender(
      <SettingsPanel
        initialTab="models"
        focusRequest={2}
        presence={{ state: 'open', completeExit }}
        onClose={onClose}
      />,
    );

    expect(document.activeElement).toBe(modelsTab);
    view.unmount();
  });

  it('does not pull focus back to the active tab when entering settles open', async () => {
    const completeExit = vi.fn();
    const onClose = vi.fn();
    const view = await render(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'entering', completeExit }}
        onClose={onClose}
      />,
    );
    const modelsTab = view.container.querySelector('.settings-nav__item[data-tab="models"]');
    const sessionsTab = view.container.querySelector(
      '.settings-nav__item[data-tab="sessions"]',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(modelsTab);
    sessionsTab.focus();
    expect(document.activeElement).toBe(sessionsTab);

    await view.rerender(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'open', completeExit }}
        onClose={onClose}
      />,
    );

    expect(document.activeElement).toBe(sessionsTab);
    view.unmount();
  });

  it('syncs and focuses the requested nav tab when Settings rapidly reopens during exit', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        ...window.electronAPI,
        sessions: { list: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(undefined) },
      } as unknown as ElectronAPI,
      writable: true,
      configurable: true,
    });
    const completeExit = vi.fn();
    const view = await render(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'entering', completeExit }}
        onClose={vi.fn()}
      />,
    );
    await view.rerender(
      <SettingsPanel
        initialTab="models"
        focusRequest={1}
        presence={{ state: 'closing', completeExit }}
        onClose={vi.fn()}
      />,
    );

    await view.rerender(
      <SettingsPanel
        initialTab="sessions"
        focusRequest={2}
        presence={{ state: 'entering', completeExit }}
        onClose={vi.fn()}
      />,
    );

    const sessionsTab = view.container.querySelector('.settings-nav__item[data-tab="sessions"]');
    expect(sessionsTab?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(sessionsTab);
    view.unmount();
  });

  it('reloads the models panel when settings-changed is broadcast', async () => {
    const { container } = await render(<SettingsPanel onClose={vi.fn()} />);
    expect(mocks.getAll).toHaveBeenCalledTimes(1);

    const broadcast = mocks.onSettingsChanged.mock.calls[0]![0] as () => void;
    await act(async () => {
      broadcast();
    });

    expect(mocks.getAll).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('模型');
  });

  it('preserves the resolved document theme while saved settings are loading', async () => {
    document.documentElement.dataset.theme = 'dark';
    mocks.settingsGet.mockReturnValue(new Promise(() => {}));

    await render(<SettingsPanel onClose={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the saved theme to documentElement', async () => {
    mocks.settingsGet.mockResolvedValue({ theme: 'dark' });
    await render(<SettingsPanel onClose={vi.fn()} />);

    expect(mocks.settingsGet).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('re-syncs theme when settings-changed is broadcast', async () => {
    mocks.settingsGet.mockResolvedValue({ theme: 'light' });
    await render(<SettingsPanel onClose={vi.fn()} />);
    expect(document.documentElement.dataset.theme).toBe('light');

    // 主窗口切到深色 → 广播 → 设置面板重读主题并应用
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
    await render(<SettingsPanel onClose={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe('dark');

    dark = false;
    await act(async () => {
      for (const cb of listeners) cb();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps the settings shell identity while only tab content changes', async () => {
    const { container } = await render(<SettingsPanel onClose={vi.fn()} />);

    const modal = container.querySelector('.settings-modal');
    const panels = container.querySelector('.settings-panels');
    const firstContent = container.querySelector('.settings-tab-content');
    expect(firstContent?.getAttribute('data-motion')).toBe('settings-content-enter');
    expect(firstContent?.getAttribute('data-tab')).toBe('models');

    const sessions = container.querySelector('.settings-nav__item[data-tab="sessions"]') as HTMLElement;
    await act(async () => {
      sessions.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.settings-modal')).toBe(modal);
    expect(container.querySelector('.settings-panels')).toBe(panels);
    const nextContent = container.querySelector('.settings-tab-content');
    expect(nextContent).not.toBe(firstContent);
    expect(nextContent?.getAttribute('data-motion')).toBe('settings-content-enter');
    expect(nextContent?.getAttribute('data-tab')).toBe('sessions');
    expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('会话');
  });

  it('preserves the tab content node when settings-changed refreshes the active panel', async () => {
    const { container } = await render(<SettingsPanel onClose={vi.fn()} />);
    const content = container.querySelector('.settings-tab-content');
    expect(content).not.toBeNull();

    const broadcast = mocks.onSettingsChanged.mock.calls[0]![0] as () => void;
    await act(async () => {
      broadcast();
    });

    expect(container.querySelector('.settings-tab-content')).toBe(content);
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
  });
});
