import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { WorkspacePanel } from './WorkspacePanel';
import type { Goal, Progress, Deliverable, MemoryContextItem } from './WorkspacePanel';

const GOAL: Goal = { kind: 'userMessage' as const, content: 'Test goal' };
const PROGRESS: Progress = { completed: 1, total: 3, currentName: 'read_file' };
const DELIVERABLES: Deliverable[] = [
  { path: 'src/test.ts', kind: 'write', ts: Date.now() },
];

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

describe('WorkspacePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).electronAPI = {
      fs: {
        listTree: vi.fn().mockResolvedValue(null),
      },
    };
  });

  it('renders without throwing', () => {
    expect(() =>
      render(
        <WorkspacePanel
          workDir="D:/test"
          goal={GOAL}
          progress={PROGRESS}
          deliverables={DELIVERABLES}
          touchedFiles={new Set(['src/test.ts'])}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name workspace-panel', () => {
    const { querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
      />,
    );
    const panel = querySelector('.workspace-panel');
    expect(panel).toBeTruthy();
    expect(panel?.id).toBe('workspace-panel');
  });

  it('shows section header labels without emoji', () => {
    const { container } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('renders goal text when goal is user message', () => {
    const { getByText } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={[]}
        touchedFiles={new Set()}
      />,
    );
    expect(getByText('Test goal')).toBeTruthy();
  });

  it('announces progress with native progressbar semantics', () => {
    const { querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={[]}
        touchedFiles={new Set()}
      />,
    );
    const progressbar = querySelector('[role="progressbar"]');
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('33');
    expect(progressbar?.getAttribute('aria-valuemax')).toBe('100');
  });
});

describe('WorkspacePanel context stats', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).electronAPI = {
      fs: {
        listTree: vi.fn().mockResolvedValue(null),
      },
    };
  });

  const BASE = {
    workDir: 'D:/test',
    goal: GOAL,
    progress: PROGRESS,
    deliverables: DELIVERABLES,
    touchedFiles: new Set<string>(),
    contextWindow: 128000,
  };

  it('renders context stats: progress, token totals, tool counts, recent calls', () => {
    const { container } = render(
      <WorkspacePanel
        {...BASE}
        contextStats={{
          promptTokens: 42000,
          completionTokens: 6000,
          toolCounts: { read_file: 8, run_command: 6 },
          recentCalls: [
            { name: 'run_command', ok: true, durationMs: 3200 },
            { name: 'edit_file', ok: false },
          ],
          compressedCount: 1,
        }}
      />,
    );
    expect(container.querySelector('.context-stats')).toBeTruthy();
    expect(container.textContent).toContain('42.0K');
    expect(container.textContent).toContain('读取');
    expect(container.textContent).toContain('命令');
    expect(container.textContent).toContain('已压缩 1 条消息');
    expect(container.textContent).toContain('3.2s');
    expect(container.textContent).toContain('成功');
    expect(container.textContent).toContain('失败');
  });

  it('shows warning color when usage exceeds 80%', () => {
    const { container } = render(
      <WorkspacePanel
        {...BASE}
        contextStats={{
          promptTokens: 110000,
          completionTokens: 0,
          toolCounts: {},
          recentCalls: [],
          compressedCount: 0,
        }}
      />,
    );
    const fill = container.querySelector('.context-stats__bar-fill');
    expect(fill?.classList.contains('warn')).toBe(true);
  });

  it('shows empty state when contextStats is null', () => {
    const { container } = render(<WorkspacePanel {...BASE} contextStats={null} />);
    expect(container.textContent).toContain('暂无任务数据');
    expect(container.querySelector('.context-stats')).toBeNull();
  });
});

describe('WorkspacePanel memory context', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).electronAPI = {
      fs: {
        listTree: vi.fn().mockResolvedValue(null),
      },
    };
  });

  const MEMORIES: MemoryContextItem[] = [
    { kind: 'fact', content: '项目使用 npm workspaces', importance: 0.9, source: 'task' },
    { kind: 'preference', content: '用户偏好中文界面', importance: 0.4 },
  ];

  it('renders the 本次记忆 section under 交付物 with kind, content and star', () => {
    const { container, querySelector, querySelectorAll } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        memoryContext={MEMORIES}
      />,
    );
    expect(querySelector('.memory-inject-list')).toBeTruthy();
    const items = querySelectorAll('.memory-inject-item');
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector('.memory-inject-kind')?.textContent).toBe('fact');
    expect(items[0]?.querySelector('.memory-inject-content')?.textContent).toBe('项目使用 npm workspaces');
    expect(items[0]?.querySelector('.memory-inject-star')).toBeTruthy();
    expect(items[1]?.querySelector('.memory-inject-star')).toBeNull();
    const html = container.innerHTML;
    expect(html.indexOf('本次记忆')).toBeGreaterThan(html.indexOf('交付物'));
    expect(html.indexOf('本次记忆')).toBeLessThan(html.indexOf('文件'));
  });

  it('hides the section when memoryContext is empty or missing', () => {
    const { container } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        memoryContext={[]}
      />,
    );
    expect(container.innerHTML).not.toContain('本次记忆');
  });
});
