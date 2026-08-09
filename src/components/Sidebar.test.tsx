import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
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

const PROJECT_PROPS = {
  projects: [],
  onProjectCreate: vi.fn(),
  onProjectDelete: vi.fn(),
  onProjectRename: vi.fn(),
  onNewSessionInProject: vi.fn(),
};

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root!.unmount();
      });
      document.body.removeChild(container);
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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
    const el = getByText(/new session|新建会话/i);
    fireClick(el);
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('exposes one persistent settings control in the primary navigation', () => {
    const onOpenSettings = vi.fn();
    const { querySelectorAll } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} {...PROJECT_PROPS} onOpenSettings={onOpenSettings} />);
    const settingsButtons = querySelectorAll('.sidebar-settings-link');
    expect(settingsButtons.length).toBe(1);
    fireClick(settingsButtons[0]!);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('switches between home, projects and work records from primary navigation', () => {
    const onNavigateHome = vi.fn();
    const onNavigateProjects = vi.fn();
    const onNavigateTasks = vi.fn();
    const { getByText } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        activeSection="home"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        {...PROJECT_PROPS}
        onNavigateHome={onNavigateHome}
        onNavigateProjects={onNavigateProjects}
        onNavigateTasks={onNavigateTasks}
      />,
    );
    fireClick(getByText('首页'));
    fireClick(getByText('项目'));
    fireClick(getByText('工作记录'));
    expect(onNavigateHome).toHaveBeenCalledOnce();
    expect(onNavigateProjects).toHaveBeenCalledOnce();
    expect(onNavigateTasks).toHaveBeenCalledOnce();
  });

  it('navigates to the files section from primary navigation', () => {
    const onNavigateFiles = vi.fn();
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
        onNavigateFiles={onNavigateFiles}
      />,
    );
    fireClick(getByText('文件'));
    expect(onNavigateFiles).toHaveBeenCalledOnce();
  });

  it('marks the files nav item as the active section', () => {
    const { querySelectorAll } = render(
      <Sidebar
        sessions={SESSIONS}
        activeId={null}
        activeSection="files"
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onExport={vi.fn()}
        {...PROJECT_PROPS}
      />,
    );
    const fileBtn = Array.from(querySelectorAll('.sidebar-primary-item')).find(
      (el) => el.textContent && el.textContent.includes('文件'),
    );
    expect(fileBtn?.getAttribute('aria-current')).toBe('page');
    expect(fileBtn?.className).toContain('sidebar-primary-item--active');
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

  it('renders session actions in a fixed body portal and flips away from viewport edges', () => {
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
    expect(row.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('.session-menu')).toBeNull();
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
    fireClick(querySelector('button[aria-label="新建项目"]'));
    expect(onProjectCreate).toHaveBeenCalledOnce();
    expect(onProjectCreate).toHaveBeenCalledWith();
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
});
