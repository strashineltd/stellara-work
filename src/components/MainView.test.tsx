import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MainView } from './MainView';
import type { AppInfo, ConfiguredModel, SessionSummary } from '../../shared/ipc';

const CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro', label: 'DeepSeek-v4-Pro', baseUrl: 'https://x', model: 'd', isCustom: false, hasKey: true,
};
const INFO: AppInfo = { version: '0.9.0', platform: 'win32', appDataPath: 'C:/stellara', envPath: 'C:/stellara/.env' };
const SESSIONS: SessionSummary[] = [
  { id: 'a', title: '会话 A', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
  { id: 'b', title: '会话 B', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
];

async function renderMainView(overrides: Partial<React.ComponentProps<typeof MainView>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  const props: React.ComponentProps<typeof MainView> = {
    config: CONFIG,
    info: INFO,
    sidebarOpen: true,
    workspaceMode: 'tabs',
    workspaceOpen: false,
    onToggleWorkspace: vi.fn(),
    shortcuts: {},
    activeSessionId: 'a',
    projects: [],
    sessions: SESSIONS,
    theme: 'light',
    onToggleSidebar: vi.fn(),
    onReconfigure: vi.fn(),
    onOpenSettings: vi.fn(),
    onProjectCreated: vi.fn(),
    onProjectDeleted: vi.fn(),
    onProjectRenamed: vi.fn(),
    onSessionCreated: vi.fn(),
    onSessionSwitched: vi.fn(),
    onSessionDeleted: vi.fn(),
    onSessionRenamed: vi.fn(),
    onSessionsChanged: vi.fn(),
    onModelChanged: vi.fn(),
    onProjectFileUpdated: vi.fn(),
    onThemeChange: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root = createRoot(container);
    root.render(<MainView {...props} />);
  });
  await act(async () => { /* flush session-load promise */ });
  // TabBar only renders in the tasks view — navigate there via the sidebar nav
  act(() => {
    const nav = Array.from(container.querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('工作记录'),
    );
    nav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
    getByText: (text: string | RegExp) => {
      const pattern = typeof text === 'string' ? text : text;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof pattern === 'string' ? node.textContent.includes(pattern) : pattern.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
  };
}

function fireClick(el: Element | null | undefined) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('MainView session deletion confirmation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = () => {};
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn().mockResolvedValue(undefined),
      },
      chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
      skills: { list: vi.fn().mockResolvedValue([]) },
    };
  });

  it('tab close does NOT delete the session when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { querySelectorAll } = await renderMainView();
    const closeButtons = querySelectorAll('.tab-chip-close');
    expect(closeButtons.length).toBe(2);
    fireClick(closeButtons[1]);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.sessions.delete).not.toHaveBeenCalled();
  });

  it('tab close deletes the session after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { querySelectorAll } = await renderMainView();
    const closeButtons = querySelectorAll('.tab-chip-close');
    fireClick(closeButtons[1]);
    expect((window as any).electronAPI.sessions.delete).toHaveBeenCalledWith('b');
  });

  it('close-others does NOT delete when the user cancels the confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { querySelector, querySelectorAll } = await renderMainView();
    const tabA = querySelector('[data-tab-id="a"]')!;
    act(() => {
      tabA.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const menuItem = Array.from(querySelectorAll('.tab-context-menu-item')).find((el) => el.textContent === '关闭其他');
    expect(menuItem).toBeTruthy();
    fireClick(menuItem);
    expect((window as any).electronAPI.sessions.delete).not.toHaveBeenCalled();
  });

  it('close-others deletes every other session after a single confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { querySelector, querySelectorAll } = await renderMainView();
    const tabA = querySelector('[data-tab-id="a"]')!;
    act(() => {
      tabA.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const menuItem = Array.from(querySelectorAll('.tab-context-menu-item')).find((el) => el.textContent === '关闭其他')!;
    fireClick(menuItem);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect((window as any).electronAPI.sessions.delete).toHaveBeenCalledWith('b');
    expect((window as any).electronAPI.sessions.delete).not.toHaveBeenCalledWith('a');
  });
});

describe('MainView shortcut wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = () => {};
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn().mockResolvedValue(undefined),
      },
      chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
      skills: { list: vi.fn().mockResolvedValue([]) },
    };
  });

  it('Ctrl+K opens the command palette', async () => {
    const { querySelector } = await renderMainView();
    expect(querySelector('.command-palette')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(querySelector('.command-palette')).not.toBeNull();
  });

  it('Ctrl+Shift+P toggles plan mode', async () => {
    const { querySelector } = await renderMainView();
    expect(querySelector('.plan-toggle.on')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    });
    expect(querySelector('.plan-toggle.on')).not.toBeNull();
  });

  it('Ctrl+Enter sends the typed message', async () => {
    const chatStart = vi.fn().mockResolvedValue({ streamId: 's1', events: (async function* () {})() });
    (window as any).electronAPI.chat.start = chatStart;
    const { querySelector } = await renderMainView();
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '写个测试');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    expect(chatStart).toHaveBeenCalledTimes(1);
  });

  it('Escape rejects the pending approval', async () => {
    const approve = vi.fn();
    (window as any).electronAPI.chat.approve = approve;
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({
      streamId: 's1',
      events: (async function* () {
        yield { type: 'approval_required', approval: { id: 'ap1', toolName: 'write_file', args: '{"path":"a.txt"}', toolCallId: 'tc1' } };
      })(),
    });
    const { querySelector } = await renderMainView();
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '改文件');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
    expect(querySelector('.approval-top-bar')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(approve).toHaveBeenCalledWith('ap1', false);
  });
});

describe('MainView model-missing banner', () => {
  const MODEL_LIST = [
    { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', hasKey: true, isActive: true, createdAt: '2026-01-01' },
    { id: 'glm-5.2', label: 'GLM', baseUrl: 'x', model: 'g', hasKey: true, isActive: false, createdAt: '2026-01-01' },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = () => {};
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue(MODEL_LIST), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn().mockResolvedValue(undefined),
      },
      chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
      skills: { list: vi.fn().mockResolvedValue([]) },
    };
  });

  it('does not show the banner when the session model exists in the configured list (even if not active)', async () => {
    const sessions = [{ id: 'a', title: '会话 A', modelId: 'glm-5.2', messageCount: 1, updatedAt: 0 }];
    const { querySelector } = await renderMainView({ sessions, activeSessionId: 'a' });
    expect(querySelector('.model-missing-banner')).toBeNull();
  });

  it('shows the banner when the session model was deleted from the configuration', async () => {
    const sessions = [{ id: 'a', title: '会话 A', modelId: 'deleted-model', messageCount: 1, updatedAt: 0 }];
    const { querySelector } = await renderMainView({ sessions, activeSessionId: 'a' });
    expect(querySelector('.model-missing-banner')).not.toBeNull();
  });
});
