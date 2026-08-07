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
