import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { Sidebar } from './Sidebar';
import type { SessionSummary } from '../../shared/ipc';

const SESSIONS: SessionSummary[] = [
  { id: 'a', title: '给 main.tsx 加日志', modelId: 'deepseek', messageCount: 3, updatedAt: Date.now() - 60_000 },
  { id: 'b', title: 'review code', modelId: 'deepseek', messageCount: 1, updatedAt: Date.now() - 600_000 },
];

const PROJECTS = [
  { id: 'p1', name: 'Alpha', updatedAt: Date.now(), sessionCount: 1 },
];

const TWO_PROJECTS = [
  ...PROJECTS,
  { id: 'p2', name: 'Beta', updatedAt: Date.now(), sessionCount: 0 },
];

const PROJECT_PROPS = {
  projects: [],
  onNavigate: vi.fn(),
  onProjectCreate: vi.fn(),
  onProjectDelete: vi.fn(),
  onProjectRename: vi.fn(),
  onNewSessionInProject: vi.fn(),
};

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (nextUi: React.ReactElement) => {
      act(() => {
        root.render(nextUi);
      });
    },
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => {
        root.unmount();
      });
      container.remove();
    },
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
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function fireContextMenu(el: Element | null, clientX: number, clientY: number) {
  if (!el) throw new Error('Element not found for context menu');
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }));
  });
}

function fireInput(el: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    document.body.replaceChildren();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders the project-and-session library heading', () => {
    const { getByText } = render(<Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    expect(getByText(/项目与会话/i)).toBeTruthy();
  });

  it('marks the active session with an accent border + soft background', () => {
    const { querySelector } = render(<Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const active = querySelector('[data-session-id="a"]')!;
    expect(active.className).toMatch(/active|accent/);
  });

  it('does not use any emoji glyphs (monochrome icons only)', () => {
    const { container } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('invokes onSelect when a session row is clicked', () => {
    const onSelect = vi.fn();
    const { getByText } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={onSelect} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const el = getByText('给 main.tsx 加日志');
    fireClick(el);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('invokes onNew when the new-session button is clicked', () => {
    const onNew = vi.fn();
    const { getByText } = render(<Sidebar sessions={[]} activeId={null} onSelect={vi.fn()} onNew={onNew} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const button = getByText(/new session|新建会话/i)?.closest('button') as HTMLButtonElement;
    fireClick(button);
    expect(onNew).toHaveBeenCalledOnce();
    expect(onNew).toHaveBeenCalledWith(button);
  });

  it('exposes one persistent settings control in the sidebar tools', () => {
    const onOpenSettings = vi.fn();
    const { querySelectorAll } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} onOpenSettings={onOpenSettings} />);
    const settingsButtons = Array.from(querySelectorAll('.sidebar-tool')).filter((el) => el.textContent === '设置');
    expect(settingsButtons.length).toBe(1);
    fireClick(settingsButtons[0]!);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('renders the primary navigation as 新对话, Pull Request and 已安排 without 插件', () => {
    const { querySelectorAll } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const labels = Array.from(querySelectorAll('.sidebar-primary-item')).map((el) => el.textContent);
    expect(labels).toEqual(['新对话', 'Pull Request', '已安排']);
    expect(labels.some((label) => label?.includes('插件'))).toBe(false);
  });

  it('invokes onNew from the 新对话 primary action', () => {
    const onNew = vi.fn();
    const { getByText } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={onNew} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const button = getByText('新对话')?.closest('button') as HTMLButtonElement;
    fireClick(button);
    expect(onNew).toHaveBeenCalledOnce();
    expect(onNew).toHaveBeenCalledWith(button);
  });

  it('navigates to Pull Request and 已安排 from the primary navigation', () => {
    const onNavigate = vi.fn();
    const { getByText } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        {...PROJECT_PROPS}
        onNavigate={onNavigate}
      />,
    );
    fireClick(getByText('Pull Request'));
    expect(onNavigate).toHaveBeenCalledWith('pull-requests');
    fireClick(getByText('已安排'));
    expect(onNavigate).toHaveBeenCalledWith('scheduled');
  });

  it('marks the pull request nav item as the active section', () => {
    const { querySelectorAll } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        activeSection="pull-requests"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        {...PROJECT_PROPS}
      />,
    );
    const btn = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('Pull Request'),
    );
    expect(btn?.getAttribute('aria-current')).toBe('page');
    expect(btn?.className).toContain('sidebar-primary-item--active');
  });

  it('renders the bottom tools with 记忆, 文件 and 设置', () => {
    const onNavigate = vi.fn();
    const onOpenSettings = vi.fn();
    const { querySelectorAll } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        {...PROJECT_PROPS}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
      />,
    );
    const tools = Array.from(querySelectorAll('.sidebar-tool'));
    expect(tools.map((el) => el.textContent)).toEqual(['记忆', '文件', '设置']);
    fireClick(tools[0]!);
    expect(onNavigate).toHaveBeenCalledWith('memory');
    fireClick(tools[1]!);
    expect(onNavigate).toHaveBeenCalledWith('files');
    fireClick(tools[2]!);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('lists unassigned recent sessions by updatedAt and caps at five', () => {
    const sessions: SessionSummary[] = Array.from({ length: 6 }, (_, index) => ({
      id: `recent-${index}`,
      title: `最近会话 ${index}`,
      modelId: 'deepseek',
      messageCount: 1,
      updatedAt: index * 1000,
    }));
    const onSelect = vi.fn();
    const { querySelector, querySelectorAll, getByText } = render(
      <Sidebar sessions={sessions} activeId={null} onSelect={onSelect} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    expect(getByText('最近')).toBeTruthy();
    const rows = querySelectorAll('.sidebar-recent .session-row');
    expect(rows.length).toBe(5);
    expect(Array.from(rows).map((el) => el.getAttribute('data-session-id'))).toEqual([
      'recent-5', 'recent-4', 'recent-3', 'recent-2', 'recent-1',
    ]);
    fireClick(rows[0]!);
    expect(onSelect).toHaveBeenCalledWith('recent-5');
    expect(querySelector('.sidebar-recent .session-row[data-session-id="recent-0"]')).toBeNull();
  });

  it('excludes project sessions from the recent group', () => {
    const sessions: SessionSummary[] = [
      { id: 'loose', title: '无项目会话', modelId: 'deepseek', messageCount: 1, updatedAt: 2 },
      { id: 'pinned', title: '项目会话', modelId: 'deepseek', messageCount: 1, updatedAt: 3, projectId: 'p1' },
    ];
    const { querySelectorAll } = render(<Sidebar sessions={sessions} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} />);
    const recentIds = Array.from(querySelectorAll('.sidebar-recent .session-row')).map((el) => el.getAttribute('data-session-id'));
    expect(recentIds).toEqual(['loose']);
  });

  it('does not render the recent group when every session belongs to a project', () => {
    const sessions: SessionSummary[] = [
      { id: 'pinned', title: '项目会话', modelId: 'deepseek', messageCount: 1, updatedAt: 3, projectId: 'p1' },
    ];
    const { container, querySelector } = render(<Sidebar sessions={sessions} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} />);
    expect(querySelector('.sidebar-recent')).toBeNull();
    expect(Array.from(container.querySelectorAll('.sidebar-section-title')).some((el) => el.textContent === '最近')).toBe(false);
  });

  it('opens a session from the keyboard', () => {
    const onSelect = vi.fn();
    const { querySelector } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={onSelect} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />);
    const row = querySelector('[data-session-id="b"]')!;
    act(() => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(row.getAttribute('role')).toBe('button');
  });

  it('renders constrained session actions above the trigger in a fixed body portal', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('session-menu')) {
        return {
          x: 0, y: 0, left: 0, top: 0,
          right: 150, bottom: 104,
          width: 150, height: 104,
          toJSON: () => ({}),
        };
      }
      if (this.classList.contains('session-list')) {
        return {
          x: 0, y: 40, left: 0, top: 40,
          right: 220, bottom: 292,
          width: 220, height: 252,
          toJSON: () => ({}),
        };
      }
      if (this.classList.contains('session-row')) {
        return {
          x: 10, y: 250, left: 10, top: 250,
          right: 200, bottom: 284,
          width: 190, height: 34,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0, y: 0, left: 0, top: 0,
        right: 200, bottom: 40,
        width: 200, height: 40,
        toJSON: () => ({}),
      };
    });

    const { querySelector } = render(
      <Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = querySelector('[data-session-id="a"]')!;
    fireContextMenu(row, 300, 270);

    const menu = document.body.querySelector('.session-menu') as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu?.parentElement).toBe(document.body);
    expect(row.contains(menu)).toBe(false);
    expect(menu?.style.left).toBe('62px');
    expect(menu?.style.top).toBe('142px');
    expect(menu?.dataset.motion).toBe('menu');
    expect(menu?.dataset.motionState).toBe('entering');
    expect(menu?.dataset.side).toBe('top');
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders roomy session actions below the trigger', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(640);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('session-menu')) {
        return {
          x: 0, y: 0, left: 0, top: 0,
          right: 150, bottom: 104,
          width: 150, height: 104,
          toJSON: () => ({}),
        };
      }
      if (this.classList.contains('session-list')) {
        return {
          x: 0, y: 40, left: 0, top: 40,
          right: 420, bottom: 560,
          width: 420, height: 520,
          toJSON: () => ({}),
        };
      }
      if (this.classList.contains('session-row')) {
        return {
          x: 10, y: 90, left: 10, top: 90,
          right: 200, bottom: 124,
          width: 190, height: 34,
          toJSON: () => ({}),
        };
      }
      return {
        x: 0, y: 0, left: 0, top: 0,
        right: 200, bottom: 40,
        width: 200, height: 40,
        toJSON: () => ({}),
      };
    });

    const { querySelector } = render(
      <Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = querySelector('[data-session-id="a"]')!;
    fireContextMenu(row, 100, 120);

    const menu = document.body.querySelector('.session-menu') as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu?.style.left).toBe('100px');
    expect(menu?.style.top).toBe('120px');
    expect(menu?.dataset.side).toBe('bottom');
  });

  it('retains a closing session menu and restores Escape focus to its durable row', () => {
    const { querySelector } = render(
      <Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = querySelector('[data-session-id="a"]') as HTMLElement;
    row.focus();
    fireContextMenu(row, 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    const menuItem = menu.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(document.activeElement).toBe(menuItem);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(row);

    act(() => menuItem.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.session-menu')).toBe(menu);

    act(() => menu.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.session-menu')).toBeNull();
  });

  it('transfers rename focus without restoring the session row', () => {
    const { querySelector } = render(
      <Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = querySelector('[data-session-id="a"]') as HTMLElement;
    row.focus();
    fireContextMenu(row, 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    const rename = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === '重命名')!;
    const rowFocus = vi.spyOn(row, 'focus');
    rename.focus();

    fireClick(rename);

    const input = querySelector('.session-title-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(rowFocus).not.toHaveBeenCalled();
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
  });

  it('keeps session and project menu owners independent during ownership transfer', () => {
    const view = render(
      <Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} />,
    );
    const firstRow = view.querySelector('[data-session-id="a"]') as HTMLElement;
    firstRow.focus();
    fireContextMenu(firstRow, 40, 40);
    const sessionMenu = document.body.querySelector('.session-menu') as HTMLElement;
    const firstRowFocus = vi.spyOn(firstRow, 'focus');
    const projectActions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    projectActions.focus();

    fireClick(projectActions);

    const projectMenu = view.querySelector('.project-action-panel') as HTMLElement;
    expect(document.body.querySelector('.session-menu')).toBe(sessionMenu);
    expect(sessionMenu.dataset.motionState).toBe('closing');
    expect(sessionMenu.hasAttribute('inert')).toBe(true);
    expect(firstRow.getAttribute('aria-expanded')).toBe('false');
    expect(firstRowFocus).not.toHaveBeenCalled();
    expect(projectActions.getAttribute('aria-expanded')).toBe('true');
    expect(projectMenu.hasAttribute('inert')).toBe(false);

    const projectActionsFocus = vi.spyOn(projectActions, 'focus');
    const secondRow = view.querySelector('[data-session-id="b"]') as HTMLElement;
    secondRow.focus();
    fireContextMenu(secondRow, 80, 80);

    expect(document.body.querySelector('.session-menu')).toBe(sessionMenu);
    expect(sessionMenu.dataset.motionState).toBe('entering');
    expect(sessionMenu.getAttribute('aria-label')).toBe('review code 会话操作');
    expect(secondRow.getAttribute('aria-expanded')).toBe('true');
    expect(view.querySelector('.project-action-panel')).toBe(projectMenu);
    expect(projectMenu.dataset.motionState).toBe('closing');
    expect(projectMenu.hasAttribute('inert')).toBe(true);
    expect(projectActions.getAttribute('aria-expanded')).toBe('false');
    expect(projectActionsFocus).not.toHaveBeenCalled();
  });

  it('retains the session payload through exit and guards commands after logical close', () => {
    const onDelete = vi.fn();
    const sidebar = (sessions: SessionSummary[]) => (
      <Sidebar sessions={sessions} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={onDelete} onRename={vi.fn()} {...PROJECT_PROPS} />
    );
    const view = render(sidebar(SESSIONS));
    fireContextMenu(view.querySelector('[data-session-id="a"]'), 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    const deleteButton = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === '删除')!;

    fireClick(deleteButton);

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.getAttribute('aria-label')).toBe('给 main.tsx 加日志 会话操作');
    expect(menu.dataset.motionState).toBe('closing');

    view.rerender(sidebar(SESSIONS.filter((session) => session.id !== 'a')));
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.getAttribute('aria-label')).toBe('给 main.tsx 加日志 会话操作');
    fireClick(deleteButton);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('claims a session destructive command before same-stack redispatch', () => {
    let deleteButton!: HTMLButtonElement;
    const onDelete = vi.fn(() => {
      if (onDelete.mock.calls.length === 1) {
        deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    const view = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={onDelete} onRename={vi.fn()} {...PROJECT_PROPS} />,
    );
    fireContextMenu(view.querySelector('[data-session-id="a"]'), 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    deleteButton = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === '删除')!;

    fireClick(deleteButton);

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
  });

  it('restores the session row before an ordinary callback and inert commit', () => {
    let menu!: HTMLElement;
    let callbackActive: Element | null = null;
    let callbackInert: boolean | null = null;
    const onDelete = vi.fn(() => {
      callbackActive = document.activeElement;
      callbackInert = menu.hasAttribute('inert');
    });
    const view = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={onDelete} onRename={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = view.querySelector('[data-session-id="a"]') as HTMLElement;
    fireContextMenu(row, 40, 40);
    menu = document.body.querySelector('.session-menu') as HTMLElement;
    const deleteButton = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === '删除')!;
    const rowFocus = vi.spyOn(row, 'focus');
    deleteButton.focus();

    fireClick(deleteButton);

    expect(onDelete).toHaveBeenCalledOnce();
    expect(callbackActive).toBe(row);
    expect(callbackInert).toBe(false);
    expect(rowFocus).toHaveBeenCalledOnce();
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
  });

  it('closes a removed session source and retains its exact portal payload through exit', () => {
    const onDelete = vi.fn();
    const sidebar = (sessions: SessionSummary[]) => (
      <Sidebar sessions={sessions} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={onDelete} onRename={vi.fn()} {...PROJECT_PROPS} />
    );
    const view = render(sidebar(SESSIONS));
    const row = view.querySelector('[data-session-id="a"]') as HTMLElement;
    row.focus();
    fireContextMenu(row, 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    const deleteButton = Array.from(menu.querySelectorAll('button')).find((button) => button.textContent === '删除')!;
    deleteButton.focus();
    const rowFocus = vi.spyOn(row, 'focus');

    view.rerender(sidebar(SESSIONS.filter((session) => session.id !== 'a')));

    expect(row.isConnected).toBe(false);
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.getAttribute('aria-label')).toBe('给 main.tsx 加日志 会话操作');
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(rowFocus).not.toHaveBeenCalled();

    const returned = { ...SESSIONS[0]!, title: 'Returned session' };
    view.rerender(sidebar([returned, SESSIONS[1]!]));
    const returnedRow = view.querySelector('[data-session-id="a"]') as HTMLElement;
    expect(returnedRow).not.toBe(row);
    expect(returnedRow.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.getAttribute('aria-label')).toBe('给 main.tsx 加日志 会话操作');

    fireClick(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
    act(() => deleteButton.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    act(() => menu.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.session-menu')).toBeNull();
  });

  it('cancels a stale exit on rapid reopen and cleans up the fallback and listener', () => {
    const view = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} {...PROJECT_PROPS} />,
    );
    const firstRow = view.querySelector('[data-session-id="a"]') as HTMLElement;
    fireContextMenu(firstRow, 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const secondRow = view.querySelector('[data-session-id="b"]') as HTMLElement;
    fireContextMenu(secondRow, 80, 80);

    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.dataset.motionState).toBe('entering');
    expect(menu.getAttribute('aria-label')).toBe('review code 会话操作');
    act(() => vi.advanceTimersByTime(170));
    expect(document.body.querySelector('.session-menu')).toBe(menu);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    act(() => vi.advanceTimersByTime(169));
    expect(document.body.querySelector('.session-menu')).toBe(menu);
    act(() => vi.advanceTimersByTime(1));
    expect(document.body.querySelector('.session-menu')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const secondRowFocus = vi.spyOn(secondRow, 'focus');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(secondRowFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  it('does not override a focusable outside pointer target when dismissing a session menu', () => {
    const view = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} {...PROJECT_PROPS} />,
    );
    const row = view.querySelector('[data-session-id="a"]') as HTMLElement;
    fireContextMenu(row, 40, 40);
    const menu = document.body.querySelector('.session-menu') as HTMLElement;
    const rowFocus = vi.spyOn(row, 'focus');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    fireClick(outside);

    expect(document.body.querySelector('.session-menu')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(document.activeElement).toBe(outside);
    expect(rowFocus).not.toHaveBeenCalled();
  });

  it('exposes project actions without requiring a context click', () => {
    const { querySelector, getByText } = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} />,
    );
    const actions = querySelector('button[aria-label="项目操作：Alpha"]');
    expect(actions).toBeTruthy();
    fireClick(actions);
    expect(getByText('编辑项目')).toBeTruthy();
    expect(getByText('删除项目')).toBeTruthy();
  });

  it('renders a bottom project panel and retains it through Escape until its root completes', () => {
    const view = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} />,
    );
    const actions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    actions.focus();
    fireClick(actions);
    const panel = view.querySelector('.project-action-panel') as HTMLElement;
    const edit = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === '编辑项目')!;
    expect(panel.dataset.motion).toBe('menu');
    expect(panel.dataset.motionState).toBe('entering');
    expect(panel.dataset.side).toBe('bottom');
    edit.focus();

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(actions.getAttribute('aria-expanded')).toBe('false');
    expect(panel.dataset.motionState).toBe('closing');
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(actions);

    act(() => edit.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    act(() => panel.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('.project-action-panel')).toBeNull();
  });

  it('claims a project command before same-stack redispatch', () => {
    let newSession!: HTMLButtonElement;
    const onNewSessionInProject = vi.fn(() => {
      if (onNewSessionInProject.mock.calls.length === 1) {
        newSession.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    const view = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        onNewSessionInProject={onNewSessionInProject}
      />,
    );
    fireClick(view.querySelector('button[aria-label="项目操作：Alpha"]'));
    const panel = view.querySelector('.project-action-panel') as HTMLElement;
    newSession = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === '新建会话')!;

    fireClick(newSession);

    expect(onNewSessionInProject).toHaveBeenCalledOnce();
    expect(onNewSessionInProject).toHaveBeenCalledWith('p1');
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(panel.dataset.motionState).toBe('closing');
  });

  it('restores project actions before an ordinary callback and inert commit', () => {
    let panel!: HTMLElement;
    let callbackActive: Element | null = null;
    let callbackInert: boolean | null = null;
    const onNewSessionInProject = vi.fn(() => {
      callbackActive = document.activeElement;
      callbackInert = panel.hasAttribute('inert');
    });
    const view = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        onNewSessionInProject={onNewSessionInProject}
      />,
    );
    const actions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    actions.focus();
    fireClick(actions);
    panel = view.querySelector('.project-action-panel') as HTMLElement;
    const newSession = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === '新建会话')!;
    const actionsFocus = vi.spyOn(actions, 'focus');
    newSession.focus();

    fireClick(newSession);

    expect(onNewSessionInProject).toHaveBeenCalledOnce();
    expect(callbackActive).toBe(actions);
    expect(callbackInert).toBe(false);
    expect(actionsFocus).toHaveBeenCalledOnce();
    expect(panel.dataset.motionState).toBe('closing');
    expect(panel.hasAttribute('inert')).toBe(true);
  });

  it('retains an open project menu in its exact source-less group until root completion', () => {
    const onNewSessionInProject = vi.fn();
    const sidebar = (projects: typeof TWO_PROJECTS) => (
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={projects}
        onNewSessionInProject={onNewSessionInProject}
      />
    );
    const view = render(sidebar(TWO_PROJECTS));
    const actions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    actions.focus();
    fireClick(actions);
    const group = actions.closest('.project-group') as HTMLElement;
    const panel = group.querySelector('.project-action-panel') as HTMLElement;
    const newSession = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent === '新建会话')!;
    const actionsFocus = vi.spyOn(actions, 'focus');

    view.rerender(sidebar(TWO_PROJECTS.filter((project) => project.id !== 'p1')));

    const retainedHeader = view.querySelector('[data-project-id="p1"]') as HTMLElement;
    const retainedGroup = retainedHeader?.closest('.project-group') as HTMLElement | null;
    expect(retainedGroup).toBe(group);
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(group.hasAttribute('inert')).toBe(true);
    expect(group.getAttribute('aria-hidden')).toBe('true');
    expect(panel.dataset.motionState).toBe('closing');
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(actionsFocus).not.toHaveBeenCalled();

    fireClick(newSession);
    expect(onNewSessionInProject).not.toHaveBeenCalled();
    act(() => newSession.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('[data-project-id="p1"]')?.closest('.project-group')).toBe(group);
    expect(view.querySelector('.project-action-panel')).toBe(panel);

    act(() => panel.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(view.querySelector('[data-project-id="p1"]')).toBeNull();
    expect(view.querySelector('.project-action-panel')).toBeNull();
  });

  it('keeps an already-closing project host fixed and closed through same-id return and fallback', () => {
    const sidebar = (projects: typeof TWO_PROJECTS) => (
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={projects}
      />
    );
    const view = render(sidebar(TWO_PROJECTS));
    const actions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    actions.focus();
    fireClick(actions);
    const group = actions.closest('.project-group') as HTMLElement;
    const panel = group.querySelector('.project-action-panel') as HTMLElement;
    const menuItem = panel.querySelector('[role="menuitem"]') as HTMLButtonElement;
    menuItem.focus();

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(actions);
    const actionsFocus = vi.spyOn(actions, 'focus');

    view.rerender(sidebar(TWO_PROJECTS.filter((project) => project.id !== 'p1')));
    expect(view.querySelector('[data-project-id="p1"]')?.closest('.project-group')).toBe(group);
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(group.hasAttribute('inert')).toBe(true);
    expect(group.getAttribute('aria-hidden')).toBe('true');
    expect(actionsFocus).not.toHaveBeenCalled();

    const returnedProjects = [TWO_PROJECTS[1]!, TWO_PROJECTS[0]!];
    view.rerender(sidebar(returnedProjects));

    const groups = view.querySelectorAll('.session-list > .project-group');
    expect(groups[0]).toBe(group);
    expect(view.querySelector('button[aria-label="项目操作：Alpha"]')).toBe(actions);
    expect(actions.getAttribute('aria-expanded')).toBe('false');
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(panel.dataset.motionState).toBe('closing');
    expect(panel.hasAttribute('inert')).toBe(true);

    act(() => vi.advanceTimersByTime(169));
    expect(view.querySelector('.project-action-panel')).toBe(panel);
    expect(view.querySelectorAll('.session-list > .project-group')[0]).toBe(group);
    act(() => vi.advanceTimersByTime(1));
    expect(view.querySelector('.project-action-panel')).toBeNull();
    expect(view.querySelector('button[aria-label="项目操作：Alpha"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles an existing project from its row without opening the setup window', () => {
    const projectSessions = [{ ...SESSIONS[0]!, projectId: 'p1' }];
    const { querySelector } = render(
      <Sidebar sessions={projectSessions} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} defaultWorkDir="D:/workspace" />,
    );
    fireClick(querySelector('button[aria-label="收起项目：Alpha"]'));
    expect(querySelector('button[aria-label="展开项目：Alpha"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(querySelector('[aria-label="打开会话：给 main.tsx 加日志"]')).toBeNull();
    expect(document.body.querySelector('#project-dialog-name')).toBeNull();
  });

  it('routes the new-project button to setup without supplying a placeholder name', () => {
    const onProjectCreate = vi.fn();
    const { querySelector } = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} onProjectCreate={onProjectCreate} projects={PROJECTS} />,
    );
    const button = querySelector('button[aria-label="新建项目"]') as HTMLButtonElement;
    fireClick(button);
    expect(onProjectCreate).toHaveBeenCalledOnce();
    expect(onProjectCreate).toHaveBeenCalledWith(button);
  });

  it('renames a project from the project window and waits for the mutation to succeed', async () => {
    const onProjectRename = vi.fn().mockResolvedValue(undefined);
    const { querySelector, getByText } = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} onProjectRename={onProjectRename} />,
    );
    fireClick(querySelector('button[aria-label="项目操作：Alpha"]'));
    fireClick(getByText('编辑项目'));
    const input = document.body.querySelector('#project-dialog-name') as HTMLInputElement;
    fireInput(input, 'Renamed');
    await act(async () => {
      const save = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('保存名称'));
      fireClick(save ?? null);
      await Promise.resolve();
    });
    expect(onProjectRename).toHaveBeenCalledWith('p1', 'Renamed');
    expect(document.body.textContent).toContain('项目名称已保存');
  });

  it('confirms project deletion and reports mutation errors', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onProjectDelete = vi.fn().mockRejectedValue(new Error('数据库被占用'));
    const { querySelector, getByText } = render(
      <Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} projects={PROJECTS} onProjectDelete={onProjectDelete} />,
    );
    fireClick(querySelector('button[aria-label="项目操作：Alpha"]'));
    await act(async () => {
      fireClick(getByText('删除项目'));
      await Promise.resolve();
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(onProjectDelete).toHaveBeenCalledWith('p1');
    expect(querySelector('[role="alert"]')?.textContent).toContain('删除失败：数据库被占用');
  });

  it('does not close a newly opened project when an earlier project deletion completes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deletion = deferred<void>();
    const onProjectDelete = vi.fn(() => deletion.promise);
    const view = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={TWO_PROJECTS}
        onProjectDelete={onProjectDelete}
      />,
    );

    fireClick(view.querySelector('button[aria-label="项目操作：Alpha"]'));
    fireClick(view.getByText('编辑项目'));
    expect((document.body.querySelector('#project-dialog-name') as HTMLInputElement).value).toBe('Alpha');

    fireClick(view.querySelector('button[aria-label="项目操作：Alpha"]'));
    fireClick(view.getByText('删除项目'));
    expect(onProjectDelete).toHaveBeenCalledWith('p1');

    fireClick(view.querySelector('button[aria-label="项目操作：Beta"]'));
    fireClick(view.getByText('编辑项目'));
    expect((document.body.querySelector('#project-dialog-name') as HTMLInputElement).value).toBe('Beta');

    await act(async () => {
      deletion.resolve(undefined);
      await deletion.promise;
    });

    const backdrop = document.body.querySelector('.project-dialog-backdrop') as HTMLElement;
    expect((backdrop.querySelector('#project-dialog-name') as HTMLInputElement).value).toBe('Beta');
    expect(backdrop.dataset.motionState).not.toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(false);
  });

  it('keeps sessions from previously deleted projects visible as unassigned', () => {
    const orphaned: SessionSummary[] = [
      { id: 'orphan', title: 'Recovered task', modelId: 'deepseek', messageCount: 1, updatedAt: Date.now(), projectId: 'deleted-project' },
    ];
    const { getByText } = render(
      <Sidebar sessions={orphaned} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} />,
    );
    expect(getByText('未分组')).toBeTruthy();
    expect(getByText('Recovered task')).toBeTruthy();
  });

  it('forwards closing presence semantics and root transition completion to the aside', () => {
    const completeExit = vi.fn();
    const { querySelector } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const sidebar = querySelector('.sidebar')!;
    expect(sidebar.getAttribute('data-motion-state')).toBe('closing');
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');

    act(() => sidebar.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it('closes both retained menu owners without restoring focus into a closing Sidebar', () => {
    const completeExit = vi.fn();
    const open = (
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        presence={{ state: 'open', completeExit }}
      />
    );
    const view = render(open);
    const row = view.querySelector('[data-session-id="a"]') as HTMLElement;
    fireContextMenu(row, 40, 40);
    const sessionMenu = document.body.querySelector('.session-menu') as HTMLElement;
    const actions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    actions.focus();
    fireClick(actions);
    const projectMenu = view.querySelector('.project-action-panel') as HTMLElement;
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const rowFocus = vi.spyOn(row, 'focus');
    const actionsFocus = vi.spyOn(actions, 'focus');

    view.rerender(
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        presence={{ state: 'closing', completeExit }}
      />,
    );

    expect(document.body.querySelector('.session-menu')).toBe(sessionMenu);
    expect(view.querySelector('.project-action-panel')).toBe(projectMenu);
    expect(sessionMenu.dataset.motionState).toBe('closing');
    expect(sessionMenu.hasAttribute('inert')).toBe(true);
    expect(projectMenu.dataset.motionState).toBe('closing');
    expect(projectMenu.hasAttribute('inert')).toBe(true);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(actions.getAttribute('aria-expanded')).toBe('false');
    expect(rowFocus).not.toHaveBeenCalled();
    expect(actionsFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  it('starts closing the body-portaled project dialog when Sidebar closing begins', () => {
    const completeExit = vi.fn();
    const view = render(
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        presence={{ state: 'open', completeExit }}
      />,
    );
    fireClick(view.querySelector('button[aria-label="项目操作：Alpha"]'));
    fireClick(view.getByText('编辑项目'));
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;

    view.rerender(
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={PROJECTS}
        presence={{ state: 'closing', completeExit }}
      />,
    );

    expect(document.body.querySelector('.project-dialog')).toBe(dialog);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
  });

  it('retains edit identity, restores the durable actions trigger, and resets a rapid reopen', () => {
    const view = render(
      <Sidebar
        sessions={SESSIONS}
        activeId="a"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={TWO_PROJECTS}
      />,
    );
    const alphaActions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    alphaActions.focus();
    const alphaActionsFocus = vi.spyOn(alphaActions, 'focus');
    fireClick(alphaActions);
    const alphaPanel = view.querySelector('.project-action-panel') as HTMLElement;
    const alphaEdit = view.getByText('编辑项目') as HTMLButtonElement;
    alphaEdit.focus();
    fireClick(alphaEdit);
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    const name = dialog.querySelector('#project-dialog-name') as HTMLInputElement;
    expect(name.value).toBe('Alpha');
    expect(document.activeElement).toBe(name);
    expect(view.querySelector('.project-action-panel')).toBe(alphaPanel);
    expect(alphaPanel.dataset.motionState).toBe('closing');
    expect(alphaPanel.hasAttribute('inert')).toBe(true);
    expect(alphaActionsFocus).not.toHaveBeenCalled();

    fireInput(name, '离开中的 Alpha 草稿');
    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));

    expect(document.activeElement).toBe(alphaActions);
    expect(alphaActionsFocus).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);
    expect(name.value).toBe('离开中的 Alpha 草稿');
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');

    act(() => dialog.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);

    const betaActions = view.querySelector('button[aria-label="项目操作：Beta"]') as HTMLButtonElement;
    fireClick(betaActions);
    const betaEdit = view.getByText('编辑项目') as HTMLButtonElement;
    betaEdit.focus();
    fireClick(betaEdit);

    expect(document.body.querySelector('.project-dialog-backdrop')).toBe(backdrop);
    expect(backdrop.dataset.motionState).toBe('entering');
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(name.value).toBe('Beta');
    expect(document.activeElement).toBe(name);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);

    fireClick(dialog.querySelector('[aria-label="关闭项目窗口"]'));
    expect(document.activeElement).toBe(betaActions);
    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBeNull();
  });

  it('retains a removed project only through exit and cannot reopen it when the id returns', () => {
    const sidebar = (projects: typeof TWO_PROJECTS) => (
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        {...PROJECT_PROPS}
        projects={projects}
      />
    );
    const view = render(sidebar(TWO_PROJECTS));
    const alphaActions = view.querySelector('button[aria-label="项目操作：Alpha"]') as HTMLButtonElement;
    fireClick(alphaActions);
    fireClick(view.getByText('编辑项目'));
    const dialog = document.body.querySelector('.project-dialog') as HTMLElement;
    const backdrop = dialog.closest('.project-dialog-backdrop') as HTMLElement;
    const focusSpy = vi.spyOn(alphaActions, 'focus');

    view.rerender(sidebar(TWO_PROJECTS.filter((project) => project.id !== 'p1')));

    expect(document.body.querySelector('.project-dialog')).toBe(dialog);
    expect((dialog.querySelector('#project-dialog-name') as HTMLInputElement).value).toBe('Alpha');
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(focusSpy).not.toHaveBeenCalled();

    view.rerender(sidebar(TWO_PROJECTS));
    expect(document.body.querySelector('.project-dialog')).toBe(dialog);
    expect(backdrop.dataset.motionState).toBe('closing');

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(document.body.querySelector('.project-dialog')).toBeNull();
  });
});
