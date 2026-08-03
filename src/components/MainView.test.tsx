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
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
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
