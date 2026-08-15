import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useState } from 'react';
import { MainView } from './MainView';
import type { AppInfo, AttachmentMeta, ConfiguredModel, SessionSummary } from '../../shared/ipc';

const CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro', label: 'DeepSeek-v4-Pro', baseUrl: 'https://x', model: 'd', isCustom: false, hasKey: true,
};
const INFO: AppInfo = { version: '0.9.0', platform: 'win32', appDataPath: 'C:/stellara', envPath: 'C:/stellara/.env' };
const SESSIONS: SessionSummary[] = [
  { id: 'a', title: '会话 A', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
  { id: 'b', title: '会话 B', modelId: 'deepseek-v4-pro', messageCount: 1, updatedAt: 0 },
];

async function renderMainView(
  overrides: Partial<React.ComponentProps<typeof MainView>> = {},
  Component: React.ComponentType<React.ComponentProps<typeof MainView>> = MainView,
) {
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
    expect(querySelector('.model-missing-banner')).not.toBeNull();
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
