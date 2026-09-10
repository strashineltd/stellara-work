import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInfo, ConfiguredModel, SessionSummary } from '../shared/ipc';
import App from './App';

const INFO: AppInfo = {
  version: '0.9.2',
  platform: 'win32',
  appDataPath: 'C:/stellara',
  envPath: 'C:/stellara/.env',
};

const CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro',
  label: 'DeepSeek v4',
  baseUrl: 'https://example.test',
  model: 'deepseek-v4-pro',
  isCustom: false,
  hasKey: true,
  workDir: 'D:/workspace',
};

const SESSION: SessionSummary = {
  id: 'session-a',
  title: 'Session A',
  modelId: CONFIG.id,
  messageCount: 0,
  updatedAt: 0,
};

let mounted: { container: HTMLDivElement; root: Root } | null = null;

async function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => { /* flush App initialization and MainView effects */ });
  return container;
}

async function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Element.prototype.scrollIntoView = () => {};
  (window as any).electronAPI = {
    menu: { onAction: vi.fn().mockReturnValue(() => {}) },
    app: {
      getInfo: vi.fn().mockResolvedValue(INFO),
      onSettingsChanged: vi.fn().mockReturnValue(() => {}),
    },
    models: {
      list: vi.fn().mockResolvedValue({ presets: [], configured: CONFIG }),
      getAll: vi.fn().mockResolvedValue([
        { ...CONFIG, isActive: true, createdAt: '2026-08-23' },
      ]),
    },
    sessions: {
      list: vi.fn().mockResolvedValue([SESSION]),
      get: vi.fn().mockResolvedValue({ session: SESSION, messages: [] }),
      saveMessages: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    projects: { list: vi.fn().mockResolvedValue([]) },
    settings: { get: vi.fn().mockResolvedValue({}) },
    chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
    skills: { list: vi.fn().mockResolvedValue([]) },
    memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
    fs: { listTree: vi.fn().mockResolvedValue(null) },
  };
});

afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('App panel shortcut focus management', () => {
  it('focuses the persistent sidebar toggle before shortcut closure makes the sidebar inert', async () => {
    const container = await renderApp();
    const sidebar = container.querySelector('.main-layout > .sidebar') as HTMLElement;
    const search = sidebar.querySelector('.sidebar-search-input') as HTMLInputElement;
    const toggle = container.querySelector('.sidebar-toggle') as HTMLButtonElement;
    search.focus();
    expect(document.activeElement).toBe(search);
    let inertWhenToggleFocused: boolean | null = null;
    const focusToggle = toggle.focus.bind(toggle);
    vi.spyOn(toggle, 'focus').mockImplementation((options?: FocusOptions) => {
      inertWhenToggleFocused = sidebar.hasAttribute('inert');
      focusToggle(options);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));
    });

    expect(inertWhenToggleFocused).toBe(false);
    expect(document.activeElement).toBe(toggle);
    expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
    expect(sidebar.hasAttribute('inert')).toBe(true);
  });

  it('focuses the persistent workspace toggle before shortcut closure makes the inspector inert', async () => {
    const container = await renderApp();
    const toggle = container.querySelector('.workspace-toggle') as HTMLButtonElement;
    act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const inspector = container.querySelector('.main-layout > .workspace-panel') as HTMLElement;
    const resizeHandle = inspector.querySelector('.workspace-resize-handle') as HTMLElement;
    resizeHandle.focus();
    expect(document.activeElement).toBe(resizeHandle);
    let inertWhenToggleFocused: boolean | null = null;
    const focusToggle = toggle.focus.bind(toggle);
    vi.spyOn(toggle, 'focus').mockImplementation((options?: FocusOptions) => {
      inertWhenToggleFocused = inspector.hasAttribute('inert');
      focusToggle(options);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', ctrlKey: true, shiftKey: true }));
    });

    expect(inertWhenToggleFocused).toBe(false);
    expect(document.activeElement).toBe(toggle);
    expect(inspector.getAttribute('data-motion-state')).toBe('closing');
    expect(inspector.hasAttribute('inert')).toBe(true);
  });
});

describe('App Settings presence and focus management', () => {
  it('retains Settings as inert and hidden until only the backdrop transition completes exit', async () => {
    const container = await renderApp();
    const opener = Array.from(container.querySelectorAll('.sidebar-tool')).find((el) => el.textContent === '设置') as HTMLButtonElement;
    opener.focus();
    await fireClick(opener);
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    const settingsTab = backdrop.querySelector('.settings-nav__item') as HTMLButtonElement;
    settingsTab.focus();
    expect(document.activeElement).toBe(settingsTab);

    await fireClick(backdrop);

    expect(container.querySelector('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.getAttribute('data-motion-state')).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      backdrop.querySelector('.settings-modal')?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(container.querySelector('.modal-backdrop')).toBe(backdrop);

    act(() => {
      backdrop.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });
    expect(container.querySelector('.modal-backdrop')).toBeNull();
  });

  it('restores focus to the captured connected opener immediately on close request', async () => {
    const container = await renderApp();
    const opener = Array.from(container.querySelectorAll('.sidebar-tool')).find((el) => el.textContent === '设置') as HTMLButtonElement;
    opener.focus();
    await fireClick(opener);
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    const settingsTab = backdrop.querySelector('.settings-nav__item') as HTMLButtonElement;
    settingsTab.focus();
    expect(document.activeElement).toBe(settingsTab);

    await fireClick(backdrop);

    expect(opener.isConnected).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(container.querySelector('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.getAttribute('data-motion-state')).toBe('closing');
  });

  it('returns focus from model Settings to the durable model trigger instead of its removed menu item', async () => {
    const container = await renderApp();
    const modelTrigger = container.querySelector('.main-model') as HTMLButtonElement;
    await fireClick(modelTrigger);
    const menuItem = container.querySelector('.model-switcher-add') as HTMLButtonElement;
    menuItem.focus();
    expect(document.activeElement).toBe(menuItem);

    await fireClick(menuItem);
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    const menu = menuItem.closest('.model-switcher-menu') as HTMLElement;
    expect(menuItem.isConnected).toBe(true);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    await fireClick(backdrop);

    expect(modelTrigger.isConnected).toBe(true);
    expect(document.activeElement).toBe(modelTrigger);
    act(() => menu.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(menuItem.isConnected).toBe(false);
  });

  it('reinvokes already-open Settings from Ctrl+K without replacing its original return target', async () => {
    const container = await renderApp();
    const opener = Array.from(container.querySelectorAll('.sidebar-tool')).find((el) => el.textContent === '设置') as HTMLButtonElement;
    opener.focus();
    await fireClick(opener);
    const settings = container.querySelector('.settings-modal') as HTMLElement;
    const modelsTab = settings.querySelector('[data-tab="models"]') as HTMLButtonElement;
    const sessionsTab = settings.querySelector('[data-tab="sessions"]') as HTMLButtonElement;
    await fireClick(sessionsTab);
    sessionsTab.focus();
    expect(document.activeElement).toBe(sessionsTab);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    const palette = container.querySelector('.command-palette') as HTMLElement;
    const paletteInput = palette.querySelector('.command-palette-input');
    expect(document.activeElement).toBe(paletteInput);
    const originalFocus = vi.spyOn(opener, 'focus');
    const staleFocus = vi.spyOn(sessionsTab, 'focus');
    const openSettings = Array.from(palette.querySelectorAll<HTMLElement>('.command-palette-item'))
      .find((item) => item.textContent?.includes('打开设置'));

    await fireClick(openSettings ?? null);

    expect(modelsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(modelsTab);
    expect(staleFocus).not.toHaveBeenCalled();
    expect(originalFocus).not.toHaveBeenCalled();
    expect(palette.closest('.modal-backdrop')?.getAttribute('data-motion-state')).toBe('closing');

    await fireClick(settings.closest('.modal-backdrop'));

    expect(document.activeElement).toBe(opener);
    expect(originalFocus).toHaveBeenCalledOnce();
  });
});
