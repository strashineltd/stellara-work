import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useState } from 'react';
import { MainView } from './MainView';
import { captureFocusTarget, restoreFocusTarget } from '../lib/presence-ui';
import type { AppInfo, AttachmentMeta, ConfiguredModel, Project, SessionSummary } from '../../shared/ipc';

const CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro', label: 'DeepSeek-v4-Pro', baseUrl: 'https://x', model: 'd', isCustom: false, hasKey: true,
};
const INFO: AppInfo = { version: '0.9.0', platform: 'win32', appDataPath: 'C:/stellara', envPath: 'C:/stellara/.env' };
const SESSIONS: SessionSummary[] = [
  { id: 'a', title: '会话 A', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
  { id: 'b', title: '会话 B', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

async function renderMainView(
  overrides: Partial<React.ComponentProps<typeof MainView>> = {},
  Component: React.ComponentType<React.ComponentProps<typeof MainView>> = MainView,
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  let props: React.ComponentProps<typeof MainView> = {
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
    root.render(<Component {...props} />);
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
    rerender: async (nextOverrides: Partial<React.ComponentProps<typeof MainView>>) => {
      props = { ...props, ...nextOverrides };
      await act(async () => {
        root!.render(<Component {...props} />);
      });
    },
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
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
    const banner = querySelector('.model-missing-banner');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.classList.contains('motion-feedback-enter')).toBe(true);
  });
});

function SessionSwitchHarness(props: React.ComponentProps<typeof MainView>) {
  const [activeId, setActiveId] = useState<string | null>(props.activeSessionId);
  return (
    <MainView
      {...props}
      activeSessionId={activeId}
      onSessionSwitched={(id) => setActiveId(id)}
    />
  );
}

function ProjectCreationHarness(props: React.ComponentProps<typeof MainView>) {
  const [projects, setProjects] = useState(props.projects);
  return (
    <MainView
      {...props}
      projects={projects}
      onProjectCreated={(project) => {
        props.onProjectCreated(project);
        setProjects((current) => [
          ...current,
          {
            id: project.id,
            name: project.name,
            workDir: project.workDir,
            entryFile: project.entryFile,
            updatedAt: project.updatedAt,
            sessionCount: 0,
          },
        ]);
      }}
    />
  );
}

function SettingsCloseHarness(props: React.ComponentProps<typeof MainView>) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  return (
    <>
      {settingsOpen && (
        <div className="settings-modal">
          <button
            className="settings-close"
            type="button"
            onClick={() => {
              restoreFocusTarget(returnFocus);
              setSettingsOpen(false);
            }}
          >
            关闭设置
          </button>
        </div>
      )}
      <MainView
        {...props}
        onOpenSettings={(_tab, returnFocusTarget) => {
          setReturnFocus(captureFocusTarget(returnFocusTarget));
          setSettingsOpen(true);
        }}
      />
    </>
  );
}

describe('MainView memory context', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('shows injected memories in the workspace panel after a memory_context event', async () => {
    const events = (async function* () {
      yield {
        type: 'memory_context',
        memories: [
          { kind: 'fact', content: '项目使用 npm workspaces', importance: 0.9, source: 'task' },
          { kind: 'preference', content: '用户偏好中文界面', importance: 0.4 },
        ],
      };
      yield { type: 'done' };
    })();
    const chatStart = vi.fn().mockResolvedValue({ streamId: 's1', events });
    (window as any).electronAPI.chat.start = chatStart;
    const { querySelector, querySelectorAll, getByText } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj' },
    });
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '写个测试');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
    expect(getByText('本次记忆')).toBeTruthy();
    const items = querySelectorAll('.memory-inject-item');
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector('.memory-inject-kind')?.textContent).toBe('fact');
    expect(getByText('项目使用 npm workspaces')).toBeTruthy();
    expect(querySelectorAll('.memory-inject-star').length).toBe(1);
  });

  it('shows the extraction hint when onExtracted fires for the active session', async () => {
    let extractedCb: ((info: { sessionId: string; count: number }) => void) | null = null;
    (window as any).electronAPI.memory.onExtracted = vi.fn((cb) => {
      extractedCb = cb;
      return () => {};
    });
    const { querySelector } = await renderMainView();
    expect(querySelector('.memory-extracted-hint')).toBeNull();
    act(() => {
      extractedCb!({ sessionId: 'a', count: 3 });
    });
    const hint = querySelector('.memory-extracted-hint');
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toContain('本次会话已沉淀 3 条记忆');
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.classList.contains('motion-feedback-enter')).toBe(true);
  });

  it('hides the extraction hint after switching to another session', async () => {
    let extractedCb: ((info: { sessionId: string; count: number }) => void) | null = null;
    (window as any).electronAPI.memory.onExtracted = vi.fn((cb) => {
      extractedCb = cb;
      return () => {};
    });
    const { querySelector } = await renderMainView({}, SessionSwitchHarness);
    act(() => {
      extractedCb!({ sessionId: 'a', count: 5 });
    });
    expect(querySelector('.memory-extracted-hint')).not.toBeNull();
    fireClick(querySelector('[data-tab-id="b"]'));
    await act(async () => {});
    expect(querySelector('.memory-extracted-hint')).toBeNull();
  });
});

describe('MainView files section', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('renders the sidebar file view when navigating to the files section', async () => {
    const { querySelector, querySelectorAll } = await renderMainView();
    const fileNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('文件'),
    );
    expect(fileNav?.getAttribute('aria-current')).toBeNull();
    fireClick(fileNav);
    expect(querySelector('.sidebar-file-view')).not.toBeNull();
    const fileNavAfter = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('文件'),
    );
    expect(fileNavAfter?.getAttribute('aria-current')).toBe('page');
  });
});

describe('MainView context stats', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  async function typeAndSend(querySelector: (sel: string) => Element | null, text: string) {
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
  }

  it('builds context stats from usage/tool_result/summary events and keeps them after done', async () => {
    const events = (async function* () {
      yield {
        type: 'usage',
        usage: { promptTokens: 4000, completionTokens: 600, estimated: true },
        totals: { promptTokens: 42000, completionTokens: 6000 },
        toolCounts: { read_file: 8, run_command: 6 },
      };
      yield { type: 'tool_result', toolResult: { name: 'run_command', result: { ok: true, meta: { kind: 'command', command: 'npm test', stdout: '', stderr: '', exitCode: 0, durationMs: 3200 } } } };
      yield { type: 'tool_result', toolResult: { name: 'edit_file', result: { ok: false } } };
      yield { type: 'summary', summary: '压缩摘要' };
      yield { type: 'done' };
    })();
    const chatStart = vi.fn().mockResolvedValue({ streamId: 's1', events });
    (window as any).electronAPI.chat.start = chatStart;
    const { container, querySelector } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj', contextWindow: 128000 },
    });
    await typeAndSend(querySelector, '写个测试');
    expect(container.textContent).toContain('42.0K / 128.0K（估算）');
    expect(container.textContent).toContain('输入 42.0K · 输出 6.0K');
    expect(container.textContent).toContain('读取');
    expect(container.textContent).toContain('工具调用 14 次');
    expect(container.textContent).toContain('3.2s');
    expect(container.textContent).toContain('成功');
    expect(container.textContent).toContain('失败');
    expect(container.textContent).toContain('已压缩 1 条消息');
  });

  it('keeps compressed count when the summary event arrives before any usage event', async () => {
    const events = (async function* () {
      yield { type: 'summary', summary: '压缩摘要' };
      yield {
        type: 'usage',
        usage: { promptTokens: 1000, completionTokens: 100, estimated: true },
        totals: { promptTokens: 3000, completionTokens: 100 },
        toolCounts: { read_file: 1 },
      };
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events });
    const { container, querySelector } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj', contextWindow: 128000 },
    });
    await typeAndSend(querySelector, '写个测试');
    expect(container.textContent).toContain('已压缩 1 条消息');
    expect(container.textContent).toContain('3.0K');
  });

  it('shows the empty hint before any usage data exists', async () => {
    const { container } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj', contextWindow: 128000 },
    });
    expect(container.textContent).toContain('暂无任务数据');
  });

  it('clears context stats when a new task starts', async () => {
    const firstEvents = (async function* () {
      yield {
        type: 'usage',
        usage: { promptTokens: 1000, completionTokens: 500, estimated: false },
        totals: { promptTokens: 5000, completionTokens: 500 },
        toolCounts: { read_file: 1 },
      };
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: firstEvents });
    const { container, querySelector } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj', contextWindow: 128000 },
    });
    await typeAndSend(querySelector, '第一个任务');
    expect(container.textContent).toContain('5.0K');
    const secondEvents = (async function* () {
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's2', events: secondEvents });
    await typeAndSend(querySelector, '第二个任务');
    expect(container.textContent).toContain('暂无任务数据');
  });
});

describe('MainView subagents', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  async function typeAndSend(querySelector: (sel: string) => Element | null, text: string) {
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
  }

  it('tracks subagent events as cards and renders the summary report', async () => {
    const events = (async function* () {
      yield { type: 'subagent_start', subagentId: 'sub-abc', subagentTask: '重构 fs 模块' };
      yield { type: 'subagent_progress', subagentId: 'sub-abc', subagentTool: 'read_file' };
      yield { type: 'subagent_done', subagentId: 'sub-abc', subagentOk: true, subagentSummary: '重构完成', subagentElapsedMs: 4200 };
      yield { type: 'subagent_start', subagentId: 'sub-def', subagentTask: '写测试' };
      yield { type: 'subagent_done', subagentId: 'sub-def', subagentOk: false, subagentSummary: '测试失败', subagentElapsedMs: 900 };
      yield {
        type: 'subagent_summary',
        subagentResults: [
          { id: 'sub-abc', summary: '重构完成', ok: true, elapsedMs: 4200 },
          { id: 'sub-def', summary: '测试失败', ok: false, elapsedMs: 900 },
        ],
      };
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events });
    const { container, querySelector, querySelectorAll } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj' },
    });
    await typeAndSend(querySelector, '写个测试');

    const cards = querySelectorAll('.subagent-card');
    expect(cards.length).toBe(2);
    expect(cards[0]?.querySelector('.subagent-badge')?.textContent).toBe('完成');
    expect(cards[0]?.textContent).toContain('sub-abc');
    expect(cards[0]?.textContent).toContain('读取');
    expect(cards[0]?.textContent).toContain('4.2s');
    expect(cards[1]?.querySelector('.subagent-badge')?.textContent).toBe('失败');

    act(() => {
      cards[0]!.querySelector('.subagent-card-head')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(cards[0]?.querySelector('.subagent-summary')?.textContent).toContain('重构完成');
    act(() => {
      cards[1]!.querySelector('.subagent-card-head')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(cards[1]?.querySelector('.subagent-summary')?.textContent).toContain('测试失败');

    const report = querySelector('.subagent-summary-report');
    expect(report).toBeTruthy();
    expect(container.textContent).toContain('子代理汇总');
    expect(container.textContent).toContain('重构完成');
  });

  it('clears subagent cards when a new task starts', async () => {
    const firstEvents = (async function* () {
      yield { type: 'subagent_start', subagentId: 'sub-abc', subagentTask: '任务一' };
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: firstEvents });
    const { querySelector, querySelectorAll } = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/proj' },
    });
    await typeAndSend(querySelector, '第一个任务');
    expect(querySelectorAll('.subagent-card').length).toBe(1);

    const secondEvents = (async function* () {
      yield { type: 'done' };
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's2', events: secondEvents });
    await typeAndSend(querySelector, '第二个任务');
    expect(querySelectorAll('.subagent-card').length).toBe(0);
    expect(querySelector('.subagent-summary-report')).toBeNull();
  });
});

describe('MainView without a configured model', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('renders with a null config and shows the home no-model banner', async () => {
    const { querySelector, querySelectorAll, container } = await renderMainView({ config: null, activeSessionId: null });
    const homeNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('首页'),
    );
    fireClick(homeNav);
    expect(querySelector('.dashboard--home')).not.toBeNull();
    expect(container.textContent).toContain('尚未配置模型，Agent 暂时无法执行任务');
  });

  it('prompts to configure a model when sending from home without a config', async () => {
    const onOpenSettings = vi.fn();
    const { querySelector, querySelectorAll, container } = await renderMainView({
      config: null,
      activeSessionId: null,
      onOpenSettings,
    });
    const homeNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('首页'),
    );
    fireClick(homeNav);
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '写个任务');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    await act(async () => {});
    expect(container.textContent).toContain('请先配置模型');
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('returns focus to the header model pill after settings closes when sending from home without a config', async () => {
    const { querySelector, querySelectorAll } = await renderMainView(
      { config: null, activeSessionId: null },
      SettingsCloseHarness,
    );
    const homeNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('首页'),
    );
    fireClick(homeNav);
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '写个任务');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = querySelector('.dashboard-send-button') as HTMLButtonElement;
    sendButton.focus({ preventScroll: true });
    fireClick(sendButton);
    await act(async () => {});
    expect(querySelector('.settings-modal')).not.toBeNull();
    fireClick(querySelector('.settings-close'));
    await act(async () => {});
    expect(document.activeElement).toBe(querySelector('.model-pill--missing'));
  });
});

describe('MainView slash skills reload on settings change', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('refetches slash skills and resets skillsLoaded when settings change', async () => {
    const skillsList = vi.fn().mockResolvedValue([]);
    (window as any).electronAPI.skills.list = skillsList;
    let settingsCb: (() => void) | null = null;
    (window as any).electronAPI.app.onSettingsChanged = vi.fn((cb: () => void) => {
      settingsCb = cb;
      return () => {};
    });
    const { querySelector } = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const textarea = querySelector('textarea')!;
    const typeIn = (value: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });

    // 首次输入 / 触发懒加载
    typeIn('/');
    await act(async () => {});
    expect(skillsList).toHaveBeenCalledTimes(1);

    // 已加载状态下再次输入 / 不重复请求
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    typeIn('/x');
    await act(async () => {});
    expect(skillsList).toHaveBeenCalledTimes(1);

    // 设置变更 → 重新拉取技能；pending 期间 skillsLoaded 保持 false
    skillsList.mockReturnValue(new Promise(() => {}));
    act(() => {
      settingsCb!();
    });
    await act(async () => {});
    expect(skillsList).toHaveBeenCalledTimes(2);

    // skillsLoaded 已重置 → 继续输入触发再次懒加载
    typeIn('/x2');
    await act(async () => {});
    expect(skillsList).toHaveBeenCalledTimes(3);
  });
});

describe('MainView home composer attachments', () => {
  const ADDED: AttachmentMeta[] = [
    { id: 'att-1', name: '需求文档.md', size: 2048, mimeType: 'text/markdown', kind: 'file', relPath: 'a/att-1' },
  ];

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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
      dialog: {
        getPathForFile: vi.fn((f: File) => `/tmp/${f.name}`),
        openAttachmentFiles: vi.fn(),
      },
      attachments: { add: vi.fn().mockResolvedValue({ attachments: ADDED }) },
    };
  });

  async function goHome(querySelectorAll: (sel: string) => NodeListOf<Element>) {
    act(() => {
      const homeNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent && el.textContent.includes('首页'),
      );
      homeNav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  function dropFileOn(picker: Element, name: string) {
    const file = new File(['x'], name);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    act(() => {
      picker.dispatchEvent(drop);
    });
  }

  it('adds dropped attachments from the home composer via attachments.add', async () => {
    const { querySelector, querySelectorAll } = await renderMainView({
      config: { ...CONFIG, workDir: 'D:/proj' },
    });
    await goHome(querySelectorAll);
    const picker = querySelector('.attach-picker')!;
    expect(picker).toBeTruthy();
    dropFileOn(picker, 'design.png');
    await act(async () => {});
    expect((window as any).electronAPI.attachments.add).toHaveBeenCalledWith('a', 'D:/proj', ['/tmp/design.png']);
    expect(querySelectorAll('.attach-chip').length).toBe(1);
    expect(querySelector('.attach-chip')?.textContent).toContain('需求文档.md');
  });

  it('adds files picked via the home composer attach button', async () => {
    (window as any).electronAPI.dialog.openAttachmentFiles = vi.fn().mockResolvedValue(['D:/proj/a.txt']);
    const { querySelector, querySelectorAll } = await renderMainView({
      config: { ...CONFIG, workDir: 'D:/proj' },
    });
    await goHome(querySelectorAll);
    const btn = querySelector('.attach-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireClick(btn);
    await act(async () => {});
    expect((window as any).electronAPI.attachments.add).toHaveBeenCalledWith('a', 'D:/proj', ['D:/proj/a.txt']);
    expect(querySelectorAll('.attach-chip').length).toBe(1);
  });

  it('prompts to create a project when adding attachments without a work dir', async () => {
    const { querySelector, container } = await renderMainView();
    const picker = querySelector('.attach-picker')!;
    dropFileOn(picker, 'design.png');
    await act(async () => {});
    expect(container.textContent).toContain('请先创建项目或设置工作目录，再添加附件。');
    expect((window as any).electronAPI.attachments.add).not.toHaveBeenCalled();
  });
});

describe('MainView panel presence', () => {
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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('retains both direct layout panels while closing and unmounts each on its root transition', async () => {
    const view = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/retained-workspace' },
    });
    const sidebar = view.container.querySelector('.main-layout > .sidebar')!;
    const inspector = view.container.querySelector('.main-layout > .workspace-panel')!;

    await view.rerender({ sidebarOpen: false, workspaceOpen: false, config: CONFIG });

    expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(inspector.getAttribute('data-motion-state')).toBe('closing');
    expect(inspector.getAttribute('aria-hidden')).toBe('true');
    expect(view.container.querySelector('.sidebar-toggle')?.getAttribute('aria-pressed')).toBe('false');

    act(() => sidebar.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.container.querySelector('.main-layout > .sidebar')).toBeNull();
    expect(view.container.querySelector('.main-layout > .workspace-panel')).toBe(inspector);

    act(() => inspector.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.container.querySelector('.main-layout > .workspace-panel')).toBeNull();
    view.unmount();
  });

  it('rejects child transition completion while both panel roots are closing', async () => {
    const view = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/workspace' },
    });
    const sidebar = view.container.querySelector('.main-layout > .sidebar')!;
    const inspector = view.container.querySelector('.main-layout > .workspace-panel')!;

    await view.rerender({ sidebarOpen: false, workspaceOpen: false });
    act(() => {
      sidebar.querySelector('.sidebar-primary')?.dispatchEvent(new Event('transitionend', { bubbles: true }));
      inspector.querySelector('.workspace-panel-header')?.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });

    expect(view.container.querySelector('.main-layout > .sidebar')).toBe(sidebar);
    expect(view.container.querySelector('.main-layout > .workspace-panel')).toBe(inspector);
    expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
    expect(inspector.getAttribute('data-motion-state')).toBe('closing');
    view.unmount();
  });

  it('cancels both exits when the panels rapidly reopen', async () => {
    const view = await renderMainView({
      workspaceOpen: true,
      config: { ...CONFIG, workDir: 'D:/workspace' },
    });
    const sidebar = view.container.querySelector('.main-layout > .sidebar')!;
    const inspector = view.container.querySelector('.main-layout > .workspace-panel')!;

    await view.rerender({ sidebarOpen: false, workspaceOpen: false });
    expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
    expect(inspector.getAttribute('data-motion-state')).toBe('closing');

    await view.rerender({ sidebarOpen: true, workspaceOpen: true });
    act(() => {
      sidebar.dispatchEvent(new Event('transitionend', { bubbles: true }));
      inspector.dispatchEvent(new Event('transitionend', { bubbles: true }));
    });

    expect(view.container.querySelector('.main-layout > .sidebar')).toBe(sidebar);
    expect(view.container.querySelector('.main-layout > .workspace-panel')).toBe(inspector);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(inspector.getAttribute('aria-hidden')).toBeNull();
    view.unmount();
  });
});

describe('MainView command and task modal presence', () => {
  const LOADED_MESSAGE = {
    sessionId: 'a',
    position: 0,
    role: 'user' as const,
    content: '保留的任务记录',
    createdAt: 0,
  };
  let view: Awaited<ReturnType<typeof renderMainView>> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = () => {};
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [LOADED_MESSAGE] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn().mockResolvedValue(undefined),
      },
      chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
      skills: { list: vi.fn().mockResolvedValue([]) },
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      projects: { create: vi.fn() },
      dialog: { selectProjectDir: vi.fn().mockResolvedValue({ workDir: 'D:/new-project' }) },
      fs: {
        listTree: vi.fn().mockResolvedValue({ name: 'proj', path: 'D:/proj', type: 'dir', children: [] }),
        readFile: vi.fn(),
        createFile: vi.fn(),
        mkdir: vi.fn(),
      },
    };
  });

  afterEach(() => {
    if (view?.container.isConnected) view.unmount();
    view = null;
  });

  function openPalette(opener: HTMLElement) {
    opener.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    return view!.querySelector('.command-palette-input') as HTMLInputElement;
  }

  function command(label: string): HTMLElement {
    const item = Array.from(view!.querySelectorAll('.command-palette-item'))
      .find((candidate) => candidate.textContent?.includes(label));
    if (!(item instanceof HTMLElement)) throw new Error(`Command not found: ${label}`);
    return item;
  }

  async function clickAndFlush(element: Element) {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('restores the palette opener on Escape and completes exit only from its root', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const input = openPalette(opener);
    const palette = view.querySelector('.command-palette') as HTMLElement;
    const backdrop = palette.closest('.modal-backdrop') as HTMLElement;

    expect(palette.getAttribute('role')).toBe('dialog');
    expect(palette.getAttribute('aria-modal')).toBe('true');
    expect(palette.getAttribute('aria-label')).toBe('命令面板');
    expect(document.activeElement).toBe(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.activeElement).toBe(opener);
    expect(view.querySelector('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);

    act(() => palette.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.command-palette')).toBe(palette);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.command-palette')).toBeNull();
  });

  it('cancels palette exit and refocuses its input when rapidly reopened', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const input = openPalette(opener);
    const backdrop = input.closest('.modal-backdrop') as HTMLElement;

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(backdrop.dataset.motionState).toBe('closing');

    const reopenedInput = openPalette(opener);
    expect(view.querySelector('.command-palette')?.closest('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(reopenedInput);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.command-palette')).not.toBeNull();
  });

  it('transfers the durable palette target to Settings without an intermediate restore', async () => {
    const settingsFocus = document.createElement('button');
    document.body.appendChild(settingsFocus);
    const onOpenSettings = vi.fn((_tab, _returnFocus) => settingsFocus.focus());
    view = await renderMainView({
      config: { ...CONFIG, workDir: 'D:/proj' },
      onOpenSettings,
    });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    openPalette(opener);
    const restoreSpy = vi.spyOn(opener, 'focus');
    const backdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('打开设置'));

    expect(onOpenSettings).toHaveBeenCalledWith(undefined, opener);
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(settingsFocus);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
  });

  it('transfers the palette target through FileTree and restores it when FileTree closes', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    openPalette(opener);
    const restoreSpy = vi.spyOn(opener, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('打开文件树'));

    const fileTree = view.querySelector('.file-tree-modal') as HTMLElement;
    const fileTreeBackdrop = fileTree.closest('.modal-backdrop') as HTMLElement;
    const closeButton = fileTree.querySelector('[aria-label="关闭文件浏览"]');
    expect(document.activeElement).toBe(closeButton);
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');
    expect(paletteBackdrop.hasAttribute('inert')).toBe(true);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(opener);
    expect(restoreSpy).toHaveBeenCalledOnce();
    expect(fileTreeBackdrop.dataset.motionState).toBe('closing');
    expect(fileTreeBackdrop.hasAttribute('inert')).toBe(true);

    act(() => fileTree.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.file-tree-modal')).toBe(fileTree);
    act(() => fileTreeBackdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.file-tree-modal')).toBeNull();
  });

  it('restores a direct FileTree trigger and cancels a stale exit on rapid reopen', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const trigger = view.querySelector('[aria-label="浏览文件"]') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    await act(async () => {});
    const fileTree = view.querySelector('.file-tree-modal') as HTMLElement;
    const backdrop = fileTree.closest('.modal-backdrop') as HTMLElement;

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);

    fireClick(trigger);
    expect(view.querySelector('.file-tree-modal')?.closest('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(fileTree.querySelector('[aria-label="关闭文件浏览"]'));

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.file-tree-modal')).not.toBeNull();
  });

  it('reinvokes already-open FileTree from Ctrl+K without replacing its original return target', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const trigger = view.querySelector('[aria-label="浏览文件"]') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    await act(async () => {});
    const fileTree = view.querySelector('.file-tree-modal') as HTMLElement;
    const closeButton = fileTree.querySelector('[aria-label="关闭文件浏览"]');
    const internalTrigger = fileTree.querySelector('.new-entry-menu__trigger') as HTMLButtonElement;
    const originalFocus = vi.spyOn(trigger, 'focus');
    openPalette(internalTrigger);
    const staleFocus = vi.spyOn(internalTrigger, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('打开文件树'));

    expect(document.activeElement).toBe(closeButton);
    expect(staleFocus).not.toHaveBeenCalled();
    expect(originalFocus).not.toHaveBeenCalled();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(originalFocus).toHaveBeenCalledOnce();
  });

  it('keeps Ctrl+K open and focused when FileTree has no workDir', async () => {
    view = await renderMainView({ config: CONFIG });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const input = openPalette(opener);
    const paletteBackdrop = input.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('打开文件树'));

    expect(view.querySelector('.file-tree-modal')).toBeNull();
    expect(paletteBackdrop.dataset.motionState).not.toBe('closing');
    expect(document.activeElement).toBe(input);
  });

  it('clears entries immediately while retaining the original confirmation count through exit', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    openPalette(opener);
    const restoreSpy = vi.spyOn(opener, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新任务（清空当前聊天）'));

    const confirmation = view.querySelector('.confirm-modal') as HTMLElement;
    const confirmationBackdrop = confirmation.closest('.modal-backdrop') as HTMLElement;
    const cancel = Array.from(confirmation.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'));
    const clear = Array.from(confirmation.querySelectorAll('button')).find((button) => button.textContent?.includes('清空'));
    expect(document.activeElement).toBe(cancel);
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');

    await clickAndFlush(clear!);

    expect(view.querySelector('.entry')).toBeNull();
    expect(confirmation.textContent).toContain('1 条工作记录');
    expect(document.activeElement).toBe(opener);
    expect(restoreSpy).toHaveBeenCalledOnce();
    expect(confirmationBackdrop.dataset.motionState).toBe('closing');
    expect(confirmationBackdrop.hasAttribute('inert')).toBe(true);

    act(() => confirmation.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.confirm-modal')).toBe(confirmation);
    act(() => confirmationBackdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.confirm-modal')).toBeNull();
  });

  it('cancels clear-confirmation exit when the durable header command rapidly reopens it', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const menuTrigger = view.querySelector('[aria-label="打开主菜单"]') as HTMLButtonElement;
    menuTrigger.focus();
    fireClick(menuTrigger);
    fireClick(view.getByText('新任务（清空当前）'));
    const confirmation = view.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = confirmation.closest('.modal-backdrop') as HTMLElement;
    const cancel = Array.from(confirmation.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;

    fireClick(cancel);
    expect(document.activeElement).toBe(menuTrigger);
    expect(backdrop.dataset.motionState).toBe('closing');

    fireClick(menuTrigger);
    fireClick(view.getByText('新任务（清空当前）'));
    expect(view.querySelector('.confirm-modal')?.closest('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(cancel);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.confirm-modal')).not.toBeNull();
  });

  it('reinvokes an already-open clear confirmation from Ctrl+K without replacing its original return target', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const menuTrigger = view.querySelector('[aria-label="打开主菜单"]') as HTMLButtonElement;
    menuTrigger.focus();
    fireClick(menuTrigger);
    fireClick(view.getByText('新任务（清空当前）'));
    const confirmation = view.querySelector('.confirm-modal') as HTMLElement;
    const cancel = Array.from(confirmation.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;
    const clear = Array.from(confirmation.querySelectorAll('button')).find((button) => button.textContent?.includes('清空'))!;
    const originalFocus = vi.spyOn(menuTrigger, 'focus');
    openPalette(clear);
    const staleFocus = vi.spyOn(clear, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新任务（清空当前聊天）'));

    expect(document.activeElement).toBe(cancel);
    expect(staleFocus).not.toHaveBeenCalled();
    expect(originalFocus).not.toHaveBeenCalled();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');

    await clickAndFlush(cancel);
    expect(document.activeElement).toBe(menuTrigger);
    expect(originalFocus).toHaveBeenCalledOnce();
  });

  it('keeps Ctrl+K open and focused when clear has no entries', async () => {
    (window as any).electronAPI.sessions.get.mockResolvedValue({ session: SESSIONS[0], messages: [] });
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const input = openPalette(opener);
    const paletteBackdrop = input.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新任务（清空当前聊天）'));

    expect(view.querySelector('.confirm-modal')).toBeNull();
    expect(paletteBackdrop.dataset.motionState).not.toBe('closing');
    expect(document.activeElement).toBe(input);
  });

  it('keeps Ctrl+K open and focused when clear is unavailable during a task', async () => {
    (window as any).electronAPI.chat.start.mockReturnValue(new Promise(() => {}));
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, '继续执行');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const input = openPalette(opener);
    const paletteBackdrop = input.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新任务（清空当前聊天）'));

    expect(view.querySelector('.confirm-modal')).toBeNull();
    expect(paletteBackdrop.dataset.motionState).not.toBe('closing');
    expect(document.activeElement).toBe(input);
  });

  it('transfers the durable palette opener through create-project when New Session has no project', async () => {
    view = await renderMainView({ activeSessionId: null, projects: [], sessions: [] });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    openPalette(opener);
    const restoreSpy = vi.spyOn(opener, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新建会话'));

    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');

    fireClick(cancel);

    expect(document.activeElement).toBe(opener);
    expect(restoreSpy).toHaveBeenCalledOnce();
  });

  it('closes the palette ordinarily when New Session only navigates to existing projects', async () => {
    view = await renderMainView({
      activeSessionId: null,
      projects: [{ id: 'p1', name: '现有项目', updatedAt: 1, sessionCount: 0 }],
      sessions: [],
    });
    const opener = view.querySelector('.sidebar-toggle') as HTMLButtonElement;
    openPalette(opener);
    const restoreSpy = vi.spyOn(opener, 'focus');
    const paletteBackdrop = view.querySelector('.command-palette')!.closest('.modal-backdrop') as HTMLElement;

    await clickAndFlush(command('新建会话'));

    expect(document.body.querySelector('.project-dialog')).toBeNull();
    expect(view.querySelector('#projects-page-title')).not.toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(restoreSpy).toHaveBeenCalledOnce();
    expect(paletteBackdrop.dataset.motionState).toBe('closing');
  });

  it('restores the durable Header menu trigger after New Session create-project cancellation', async () => {
    view = await renderMainView({ activeSessionId: null, projects: [], sessions: [] });
    const menuTrigger = view.querySelector('[aria-label="打开主菜单"]') as HTMLButtonElement;
    menuTrigger.focus();
    fireClick(menuTrigger);
    const menuItem = Array.from(view.querySelectorAll('.header-menu-item')).find(
      (item) => item.textContent?.includes('新建会话'),
    ) as HTMLButtonElement;
    const menu = menuItem.closest('.header-menu') as HTMLElement;
    menuItem.focus();
    const triggerFocus = vi.spyOn(menuTrigger, 'focus');

    fireClick(menuItem);

    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;
    expect(menuItem.isConnected).toBe(true);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));
    expect(triggerFocus).not.toHaveBeenCalled();

    fireClick(cancel);

    expect(document.activeElement).toBe(menuTrigger);
    act(() => menu.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(menuItem.isConnected).toBe(false);
  });

  it('falls back to the projects-page create button when New Session removes its TabBar trigger', async () => {
    view = await renderMainView({ projects: [] });
    const trigger = view.querySelector('[aria-label="新建会话标签页"]') as HTMLButtonElement;
    trigger.focus();

    fireClick(trigger);

    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));

    fireClick(cancel);

    expect(document.activeElement).toBe(view.querySelector('.dashboard-create-button'));
  });

  it('falls back to the projects-page create button for native-menu New Session', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    view = await renderMainView({ activeSessionId: null, projects: [], sessions: [] });
    const menuActionCall = [...addEventListener.mock.calls]
      .reverse()
      .find(([eventName]) => eventName === 'menu-action');
    if (!menuActionCall) throw new Error('MainView did not register its native menu listener');

    act(() => {
      (menuActionCall[1] as EventListener)(new CustomEvent('menu-action', { detail: 'new-session' }));
    });

    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.includes('取消'))!;
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));

    fireClick(cancel);

    expect(document.activeElement).toBe(view.querySelector('.dashboard-create-button'));
  });

  it('focuses the persistent create button before an empty-state project creation updates its parent', async () => {
    let resolveCreate!: (project: Project) => void;
    const createPromise = new Promise<Project>((resolve) => {
      resolveCreate = resolve;
    });
    (window as any).electronAPI.projects.create.mockReturnValue(createPromise);
    let focusAtParentUpdate: Element | null = null;
    let inertAtParentUpdate: boolean | null = null;
    const onProjectCreated = vi.fn(() => {
      focusAtParentUpdate = document.activeElement;
      inertAtParentUpdate = document.body.querySelector('.project-dialog-backdrop')?.hasAttribute('inert') ?? null;
    });
    view = await renderMainView(
      { projects: [], onProjectCreated },
      ProjectCreationHarness,
    );
    const projectsNav = Array.from(view.querySelectorAll('.sidebar-primary-item')).find(
      (item) => item.textContent?.includes('项目'),
    );
    fireClick(projectsNav);
    const emptyTrigger = view.getByText('创建第一个项目')?.closest('button') as HTMLButtonElement;
    fireClick(emptyTrigger);
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    const name = dialog.querySelector('#project-dialog-name') as HTMLInputElement;
    const selectWorkDir = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('选择文件夹或文件'),
    );
    fireClick(selectWorkDir);
    await act(async () => {});
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(name, '新项目');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '创建项目')!;
    fireClick(submit);
    const persistentCreate = view.querySelector('.dashboard-create-button') as HTMLButtonElement;

    await act(async () => {
      resolveCreate({
        id: 'p-new',
        name: '新项目',
        workDir: 'D:/new-project',
        createdAt: 1,
        updatedAt: 1,
      });
      await createPromise;
    });

    expect(focusAtParentUpdate).toBe(persistentCreate);
    expect(inertAtParentUpdate).toBe(false);
    expect(document.activeElement).toBe(persistentCreate);
    expect(emptyTrigger.isConnected).toBe(false);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
  });

  it('keeps create-project focus and payload in place when project creation is rejected', async () => {
    let rejectCreate!: (reason?: unknown) => void;
    const createPromise = new Promise<Project>((_resolve, reject) => {
      rejectCreate = reject;
    });
    (window as any).electronAPI.projects.create.mockReturnValue(createPromise);
    let focusFrame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      focusFrame = callback;
      return 1;
    }));
    view = await renderMainView({ projects: [] });
    const projectsNav = Array.from(view.querySelectorAll('.sidebar-primary-item')).find(
      (item) => item.textContent?.includes('项目'),
    );
    fireClick(projectsNav);
    fireClick(view.getByText('创建第一个项目'));
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    const name = dialog.querySelector('#project-dialog-name') as HTMLInputElement;
    const selectWorkDir = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('选择文件夹或文件'),
    );
    fireClick(selectWorkDir);
    await act(async () => {});
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(name, '保留的项目草稿');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const submit = Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === '创建项目') as HTMLButtonElement;
    submit.focus();
    fireClick(submit);

    await act(async () => {
      rejectCreate(new Error('disk full'));
      await createPromise.catch(() => undefined);
    });
    act(() => {
      focusFrame?.(0);
    });

    expect(document.body.querySelector('.project-dialog')).toBe(dialog);
    expect(backdrop.dataset.motionState).not.toBe('closing');
    expect(document.activeElement).toBe(name);
    expect(name.value).toBe('保留的项目草稿');
    expect(dialog.textContent).toContain('new-project');
    expect(dialog.textContent).toContain('项目创建失败：disk full');
  });

  it('restores the dashboard create trigger before the retained form becomes inert', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const projectsNav = Array.from(view.querySelectorAll('.sidebar-primary-item')).find(
      (item) => item.textContent?.includes('项目'),
    );
    fireClick(projectsNav);
    const trigger = view.querySelector('.dashboard-create-button') as HTMLButtonElement;

    fireClick(trigger);

    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));
    let inertWhenRestored: boolean | null = null;
    const restoreTriggerFocus = trigger.focus.bind(trigger);
    vi.spyOn(trigger, 'focus').mockImplementation((options?: FocusOptions) => {
      inertWhenRestored = backdrop.hasAttribute('inert');
      restoreTriggerFocus(options);
    });

    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));

    expect(inertWhenRestored).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
  });

  it('restores the create-project trigger before the retained form becomes inert', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const trigger = view.querySelector('[aria-label="新建项目"]') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    expect(document.activeElement).toBe(dialog.querySelector('#project-dialog-name'));
    let inertWhenRestored: boolean | null = null;
    const restoreTriggerFocus = trigger.focus.bind(trigger);
    vi.spyOn(trigger, 'focus').mockImplementation((options?: FocusOptions) => {
      inertWhenRestored = backdrop.hasAttribute('inert');
      restoreTriggerFocus(options);
    });

    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));

    expect(inertWhenRestored).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
  });

  it('retains the create-project form through root-only exit and resets it on rapid reopen', async () => {
    view = await renderMainView({ config: { ...CONFIG, workDir: 'D:/proj' } });
    const trigger = view.querySelector('[aria-label="新建项目"]') as HTMLButtonElement;
    fireClick(trigger);
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    const name = dialog.querySelector('#project-dialog-name') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(name, '关闭前的草稿');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });

    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));

    expect(document.body.querySelector('.project-dialog-backdrop')).toBe(backdrop);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(name.value).toBe('关闭前的草稿');

    act(() => dialog.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);

    fireClick(trigger);

    expect(document.body.querySelector('.project-dialog-backdrop')).toBe(backdrop);
    expect(backdrop.dataset.motionState).toBe('entering');
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);

    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));
    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBeNull();
  });
});

describe('MainView page entrance markers', () => {
  const LOADED_MESSAGE = {
    sessionId: 'a',
    position: 0,
    role: 'user' as const,
    content: '保留的任务记录',
    createdAt: 0,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = () => {};
    (window as any).electronAPI = {
      models: { getAll: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue({ presets: [], configured: null }) },
      sessions: {
        get: vi.fn().mockResolvedValue({ session: SESSIONS[0], messages: [LOADED_MESSAGE] }),
        delete: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        saveMessages: vi.fn().mockResolvedValue(undefined),
      },
      chat: { start: vi.fn(), abort: vi.fn(), approve: vi.fn() },
      skills: { list: vi.fn().mockResolvedValue([]) },
      memory: {
        list: vi.fn().mockResolvedValue([]),
        stats: vi.fn().mockResolvedValue({ total: 0, byScope: {}, byKind: {}, recentCount: 0 }),
        search: vi.fn().mockResolvedValue([]),
        onExtracted: vi.fn().mockReturnValue(() => {}),
      },
      projects: { list: vi.fn().mockResolvedValue([]) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  it('keeps task history static without any page-enter marker', async () => {
    const { querySelector, querySelectorAll } = await renderMainView();
    expect(querySelector('.tab-bar')).not.toBeNull();
    expect(querySelector('.main-chat')).not.toBeNull();
    expect(querySelector('.main-input')).not.toBeNull();
    expect(querySelector('.messages')).not.toBeNull();
    expect(querySelectorAll('.entry').length).toBeGreaterThan(0);
    expect(querySelector('[data-motion="page-enter"]')).toBeNull();
    for (const root of querySelectorAll('.tab-bar, .main-chat, .messages, .entry, .main-input')) {
      expect(root.hasAttribute('data-motion')).toBe(false);
    }
  });

  it('marks home and projects roots and replaces the host root on section switch', async () => {
    const { querySelector, querySelectorAll } = await renderMainView();
    act(() => {
      const homeNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent?.includes('首页'),
      );
      homeNav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const homeRoot = querySelector('main.dashboard--home') as HTMLElement;
    expect(homeRoot).toBeTruthy();
    expect(homeRoot.dataset.motion).toBe('page-enter');
    expect(homeRoot.dataset.page).toBe('home');

    act(() => {
      const projectsNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent?.includes('项目'),
      );
      projectsNav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const projectsRoot = querySelector('main.dashboard--projects') as HTMLElement;
    expect(projectsRoot).toBeTruthy();
    expect(projectsRoot.dataset.motion).toBe('page-enter');
    expect(projectsRoot.dataset.page).toBe('projects');
    expect(homeRoot.isConnected).toBe(false);
  });

  it('marks the memory and files roots with page markers', async () => {
    const { querySelector, querySelectorAll } = await renderMainView();
    act(() => {
      const memoryNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent?.includes('记忆'),
      );
      memoryNav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    const memoryRoot = querySelector('.memory-center') as HTMLElement;
    expect(memoryRoot).toBeTruthy();
    expect(memoryRoot.dataset.motion).toBe('page-enter');
    expect(memoryRoot.dataset.page).toBe('memory');

    act(() => {
      const filesNav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent?.includes('文件'),
      );
      filesNav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    const filesRoot = querySelector('.sidebar-file-view') as HTMLElement;
    expect(filesRoot).toBeTruthy();
    expect(filesRoot.dataset.motion).toBe('page-enter');
    expect(filesRoot.dataset.page).toBe('files');
  });
});

describe('MainView live entry motion', () => {
  type StreamControl = {
    events: AsyncGenerator<import('../../shared/ipc').ChatStreamEvent>;
    push: (ev: import('../../shared/ipc').ChatStreamEvent) => void;
  };

  function controlledStream(): StreamControl {
    const queue: import('../../shared/ipc').ChatStreamEvent[] = [];
    const waiters: Array<(ev: import('../../shared/ipc').ChatStreamEvent) => void> = [];
    const events = (async function* () {
      for (;;) {
        const ev = queue.length > 0
          ? queue.shift()!
          : await new Promise<import('../../shared/ipc').ChatStreamEvent>((resolve) => waiters.push(resolve));
        yield ev;
        if (ev.type === 'done') return;
      }
    })();
    return {
      events,
      push: (ev) => {
        if (waiters.length > 0) waiters.shift()!(ev);
        else queue.push(ev);
      },
    };
  }

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
      memory: { onExtracted: vi.fn().mockReturnValue(() => {}) },
      app: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
      fs: { listTree: vi.fn().mockResolvedValue(null) },
    };
  });

  async function typeAndSend(querySelector: (sel: string) => Element | null, text: string) {
    const textarea = querySelector('textarea')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    });
    await act(async () => {});
  }

  function clickSidebar(querySelectorAll: (sel: string) => NodeListOf<Element>, label: string) {
    act(() => {
      const nav = Array.from(querySelectorAll('.sidebar-primary-item')).find(
        (el) => el.textContent && el.textContent.includes(label),
      );
      nav?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('loads history with stable data-entry-key and no live class', async () => {
    (window as any).electronAPI.sessions.get.mockResolvedValue({
      session: SESSIONS[0],
      messages: [
        { sessionId: 'a', position: 0, role: 'user', content: '历史任务', createdAt: 0 },
        { sessionId: 'a', position: 1, role: 'assistant', content: '历史回复', createdAt: 0 },
      ],
    });
    const { querySelectorAll } = await renderMainView();
    const wrappers = querySelectorAll('.entry');
    expect(wrappers.length).toBe(2);
    for (const w of Array.from(wrappers)) {
      expect(w.getAttribute('data-entry-key')).toMatch(/^history:a:\d+:/);
      expect(w.classList.contains('entry--live')).toBe(false);
      expect(w.classList.contains('entry--status-live')).toBe(false);
    }
  });

  it('adds exactly two discrete live wrappers on send', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { querySelector, querySelectorAll } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    const live = querySelectorAll('.entry--live');
    expect(live.length).toBe(2);
    expect(Array.from(live).map((w) => w.getAttribute('data-entry-key'))).toEqual(['live:a:1', 'live:a:2']);
    stream.push({ type: 'done' });
    await act(async () => {});
  });

  it('preserves the assistant wrapper and key across content tokens', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { container, querySelector } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    const before = container.querySelector('[data-entry-key="live:a:2"]') as HTMLElement;
    expect(before).toBeTruthy();
    stream.push({ type: 'content', content: '逐步输出' });
    await act(async () => {});
    const after = container.querySelector('[data-entry-key="live:a:2"]') as HTMLElement;
    expect(after).toBe(before);
    expect(after.classList.contains('entry--live')).toBe(true);
    expect(after.textContent).toContain('逐步输出');
    stream.push({ type: 'done' });
    await act(async () => {});
  });

  it('wraps tool call, tool result and final report as discrete live entries', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { container, querySelector, querySelectorAll } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    stream.push({ type: 'content', content: '已完成' });
    await act(async () => {});
    stream.push({ type: 'tool_call', toolCall: { id: 'tc-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } } });
    await act(async () => {});
    stream.push({ type: 'tool_result', toolResult: { name: 'read_file', toolCallId: 'tc-1', result: { ok: true, output: 'file body' } } });
    await act(async () => {});
    stream.push({ type: 'task_complete' });
    await act(async () => {});
    stream.push({ type: 'done' });
    await act(async () => {});
    const live = querySelectorAll('.entry--live');
    expect(live.length).toBe(5);
    expect(Array.from(live).map((w) => w.getAttribute('data-entry-key'))).toEqual(
      ['live:a:1', 'live:a:2', 'live:a:4', 'live:a:5', 'live:a:7'],
    );
    expect(querySelectorAll('.tool-card-call').length).toBe(1);
    expect(container.textContent).toContain('任务完成');
  });

  it('wraps verify and error entries as status live entries', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { container, querySelector, querySelectorAll } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    stream.push({ type: 'verify', phase: 'post_edit', target: 'a.ts' });
    await act(async () => {});
    stream.push({ type: 'error', error: '连接中断' });
    await act(async () => {});
    stream.push({ type: 'done' });
    await act(async () => {});
    const status = querySelectorAll('.entry--status-live');
    expect(status.length).toBe(2);
    for (const w of Array.from(status)) {
      expect(w.getAttribute('data-entry-key')).toMatch(/^live:a:\d+$/);
    }
    expect(querySelectorAll('.verify-chip').length).toBe(1);
    expect(container.textContent).toContain('连接中断');
  });

  it('shows only static entries for the new session after a switch', async () => {
    (window as any).electronAPI.sessions.get.mockImplementation((id: string) =>
      Promise.resolve({
        session: id === 'a' ? SESSIONS[0] : SESSIONS[1],
        messages: id === 'a'
          ? [{ sessionId: 'a', position: 0, role: 'user', content: 'A 的任务', createdAt: 0 }]
          : [
              { sessionId: 'b', position: 0, role: 'user', content: 'B 的任务', createdAt: 0 },
              { sessionId: 'b', position: 1, role: 'assistant', content: 'B 的回复', createdAt: 0 },
            ],
      }),
    );
    const { container, querySelector, querySelectorAll } = await renderMainView({}, SessionSwitchHarness);
    expect(container.textContent).toContain('A 的任务');
    fireClick(querySelector('[data-tab-id="b"]'));
    await act(async () => {});
    expect(container.textContent).toContain('B 的任务');
    const wrappers = querySelectorAll('.entry');
    expect(wrappers.length).toBe(2);
    for (const w of Array.from(wrappers)) {
      expect(w.getAttribute('data-entry-key')).toMatch(/^history:b:\d+:/);
      expect(w.classList.contains('entry--live')).toBe(false);
      expect(w.classList.contains('entry--status-live')).toBe(false);
    }
  });

  it('removes all live classes after navigating away and back to tasks', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { querySelector, querySelectorAll } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    expect(querySelectorAll('.entry--live').length).toBe(2);
    clickSidebar(querySelectorAll, '首页');
    clickSidebar(querySelectorAll, '工作记录');
    const wrappers = querySelectorAll('.entry');
    expect(wrappers.length).toBe(2);
    for (const w of Array.from(wrappers)) {
      expect(w.classList.contains('entry--live')).toBe(false);
      expect(w.classList.contains('entry--status-live')).toBe(false);
      expect(w.getAttribute('data-entry-key')).toMatch(/^live:a:\d+$/);
    }
    stream.push({ type: 'done' });
    await act(async () => {});
  });

  it('keeps stream events received while another page is active static', async () => {
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { querySelector, querySelectorAll } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    clickSidebar(querySelectorAll, '首页');
    stream.push({ type: 'content', content: '后台输出' });
    stream.push({ type: 'tool_call', toolCall: { id: 'tc-1', type: 'function', function: { name: 'read_file', arguments: '{}' } } });
    await act(async () => {});
    clickSidebar(querySelectorAll, '工作记录');
    expect(querySelectorAll('.entry--live').length).toBe(0);
    expect(querySelectorAll('.entry--status-live').length).toBe(0);
    expect(querySelectorAll('.entry').length).toBe(3);
    expect(querySelectorAll('.tool-card-call').length).toBe(1);
    stream.push({ type: 'done' });
    await act(async () => {});
  });

  it('renders stream events from a switched-away session static with stable keys', async () => {
    (window as any).electronAPI.sessions.get.mockImplementation((id: string) =>
      Promise.resolve({
        session: id === 'a' ? SESSIONS[0] : SESSIONS[1],
        messages: id === 'a'
          ? []
          : [{ sessionId: 'b', position: 0, role: 'user', content: 'B 的任务', createdAt: 0 }],
      }),
    );
    const stream = controlledStream();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events: stream.events });
    const { container, querySelector, querySelectorAll } = await renderMainView({}, SessionSwitchHarness);
    await typeAndSend(querySelector, '写个测试');
    expect(querySelectorAll('.entry--live').length).toBe(2);
    fireClick(querySelector('[data-tab-id="b"]'));
    await act(async () => {});
    expect(container.textContent).toContain('B 的任务');
    stream.push({ type: 'content', content: '残留输出' });
    stream.push({ type: 'tool_call', toolCall: { id: 'tc-1', type: 'function', function: { name: 'read_file', arguments: '{}' } } });
    await act(async () => {});
    stream.push({ type: 'tool_result', toolResult: { name: 'read_file', toolCallId: 'tc-1', result: { ok: true, output: 'body' } } });
    await act(async () => {});
    expect(querySelectorAll('.entry--live').length).toBe(0);
    expect(querySelectorAll('.entry--status-live').length).toBe(0);
    const wrappers = querySelectorAll('.entry');
    expect(wrappers.length).toBe(3);
    const callKey = wrappers[1]?.getAttribute('data-entry-key');
    expect(callKey).toMatch(/^live:/);
    const callEl = container.querySelector(`[data-entry-key="${callKey}"]`);
    stream.push({ type: 'subagent_summary', subagentResults: [{ id: 's-1', summary: 'x', ok: true, elapsedMs: 1 }] });
    await act(async () => {});
    expect(container.querySelector(`[data-entry-key="${callKey}"]`)).toBe(callEl);
    stream.push({ type: 'done' });
    await act(async () => {});
  });

  it('routes a chat.start rejection through the reducer as a status error entry', async () => {
    (window as any).electronAPI.chat.start = vi.fn().mockRejectedValue(new Error('start failed'));
    const { container, querySelector } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    const errorWrapper = container.querySelector('[data-entry-key="live:a:3"]') as HTMLElement;
    expect(errorWrapper).toBeTruthy();
    expect(errorWrapper.classList.contains('entry--status-live')).toBe(true);
    expect(errorWrapper.querySelector('.error-banner')?.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('start failed');
    expect(container.textContent).not.toContain('[连接错误]');
    expect(container.querySelector('[data-entry-key="live:a:2"]')).toBeNull();
  });

  it('keeps a nonempty assistant unchanged and appends a following error entry when the stream throws', async () => {
    const events = (async function* () {
      yield { type: 'content', content: '部分输出' };
      throw new Error('stream boom');
    })();
    (window as any).electronAPI.chat.start = vi.fn().mockResolvedValue({ streamId: 's1', events });
    const { container, querySelector } = await renderMainView();
    await typeAndSend(querySelector, '写个测试');
    const assistant = container.querySelector('[data-entry-key="live:a:2"]') as HTMLElement;
    expect(assistant.textContent).toContain('部分输出');
    expect(assistant.textContent).not.toContain('[连接错误]');
    // 流事件（content）消耗了 live:a:3；catch 在状态更新前分配下一个 key
    const errorWrapper = container.querySelector('[data-entry-key="live:a:4"]') as HTMLElement;
    expect(errorWrapper).toBeTruthy();
    expect(errorWrapper.classList.contains('entry--status-live')).toBe(true);
    expect(errorWrapper.querySelector('.error-banner')?.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('stream boom');
    expect(container.textContent).not.toContain('[连接错误]');
  });

  it('surfaces a visible fallback message and a retry affordance when the rejection message is empty', async () => {
    for (const rejection of [new Error(''), '']) {
      (window as any).electronAPI.chat.start = vi.fn().mockRejectedValue(rejection);
      const { container, querySelector } = await renderMainView();
      await typeAndSend(querySelector, '写个测试');
      const errorWrapper = container.querySelector('[data-entry-key="live:a:3"]') as HTMLElement;
      expect(errorWrapper).toBeTruthy();
      expect(errorWrapper.classList.contains('entry--status-live')).toBe(true);
      const banner = errorWrapper.querySelector('.error-banner');
      expect(banner?.getAttribute('role')).toBe('alert');
      expect(banner?.textContent).toContain('请求失败');
      expect(errorWrapper.querySelector('.btn-retry')).not.toBeNull();
      expect(container.querySelector('[data-entry-key="live:a:2"]')).toBeNull();
      document.body.innerHTML = '';
    }
  });
});
