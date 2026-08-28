import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { WorkspacePanel } from './WorkspacePanel';
import type { Goal, Progress, Deliverable, MemoryContextItem } from './WorkspacePanel';
import type { ContextStateView } from '../../shared/ipc';

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
    rerender: (nextUi: React.ReactElement) => {
      act(() => {
        root!.render(nextUi);
      });
    },
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

afterEach(() => {
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

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

  it('animates the progress fill with a scaleX transform instead of inline width', () => {
    const { container, querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={[]}
        touchedFiles={new Set()}
      />,
    );
    const taskFill = container.querySelector('.progress-bar') as HTMLElement;
    const taskProgress = querySelector('[role="progressbar"]');
    expect(taskFill.style.width).toBe('');
    expect(taskFill.style.transform).toBe('scaleX(0.33)');
    expect(taskProgress?.getAttribute('aria-valuenow')).toBe('33');
  });

  it('forwards closing presence semantics and root transition completion to the aside', () => {
    const completeExit = vi.fn();
    const { querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const panel = querySelector('.workspace-panel')!;
    expect(panel.getAttribute('data-motion-state')).toBe('closing');
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');

    act(() => panel.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it('ends an active resize and removes document interactions when closing begins', () => {
    const completeExit = vi.fn();
    const onWidthChange = vi.fn();
    const view = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        onWidthChange={onWidthChange}
        presence={{ state: 'open', completeExit }}
      />,
    );
    const handle = view.querySelector('.workspace-resize-handle')!;
    act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300 })));
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 })));
    expect(document.body.style.cursor).toBe('ew-resize');
    expect(document.body.style.userSelect).toBe('none');
    const callsBeforeClose = onWidthChange.mock.calls.length;

    view.rerender(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        onWidthChange={onWidthChange}
        presence={{ state: 'closing', completeExit }}
      />,
    );

    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 })));
    expect(onWidthChange).toHaveBeenCalledTimes(callsBeforeClose);
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

  it('renders the context usage fill as a scaleX transform instead of inline width', () => {
    const { container } = render(
      <WorkspacePanel
        {...BASE}
        contextStats={{
          promptTokens: 100000,
          completionTokens: 0,
          toolCounts: {},
          recentCalls: [],
          compressedCount: 0,
          inputUsageRatio: 0.8,
        }}
      />,
    );
    const contextFill = container.querySelector('.context-stats__bar-fill') as HTMLElement;
    expect(contextFill.style.width).toBe('');
    expect(contextFill.style.transform).toBe('scaleX(0.8)');
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

describe('WorkspacePanel subagents', () => {
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
  };

  const SUBAGENTS = [
    { id: 'sub-abc', task: '重构 fs 模块', status: 'running', lastTool: 'read_file' },
    { id: 'sub-def', task: '写测试', status: 'done', elapsedMs: 4200, summary: '完成 3 个测试' },
    { id: 'sub-ghi', task: '坏任务', status: 'failed', elapsedMs: 900 },
    { id: 'sub-jkl', task: '排队中', status: 'queued' },
  ] as const;

  it('renders the 子代理 section with cards, badges, last tool and elapsed time', () => {
    const { container, querySelector, querySelectorAll } = render(
      <WorkspacePanel {...BASE} subagents={[...SUBAGENTS]} />,
    );
    expect(querySelector('.subagent-list')).toBeTruthy();
    expect(container.textContent).toContain('子代理');
    const cards = querySelectorAll('.subagent-card');
    expect(cards.length).toBe(4);
    expect(cards[0]?.querySelector('.subagent-badge')?.textContent).toBe('执行中');
    expect(cards[1]?.querySelector('.subagent-badge')?.textContent).toBe('完成');
    expect(cards[2]?.querySelector('.subagent-badge')?.textContent).toBe('失败');
    expect(cards[3]?.querySelector('.subagent-badge')?.textContent).toBe('排队');
    expect(cards[0]?.textContent).toContain('sub-abc');
    expect(cards[0]?.textContent).toContain('读取');
    expect(cards[1]?.textContent).toContain('4.2s');
  });

  it('expands the summary when the card head is clicked', () => {
    const { container } = render(
      <WorkspacePanel {...BASE} subagents={[...SUBAGENTS]} />,
    );
    expect(container.textContent).not.toContain('完成 3 个测试');
    const heads = container.querySelectorAll('.subagent-card-head');
    act(() => {
      heads[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('完成 3 个测试');
  });

  it('does not render the section when subagents is empty or missing', () => {
    const { container } = render(<WorkspacePanel {...BASE} subagents={[]} />);
    expect(container.textContent).not.toContain('子代理');
    expect(container.querySelector('.subagent-list')).toBeNull();
  });
});

describe('WorkspacePanel task gate', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).electronAPI = {
      fs: {
        listTree: vi.fn().mockResolvedValue(null),
      },
    };
  });

  function taskGateState(taskGate: { ok: boolean; reasons: string[] }): ContextStateView {
    return {
      sessionId: 'a',
      revision: 1,
      workspaceRevision: 1,
      objective: 'task',
      planSteps: [],
      usage: {
        inputUsageRatio: 0,
        softThreshold: 0.8,
        hardThreshold: 0.95,
        nearLimit: false,
        hardLimited: false,
        currentInputTokens: 0,
        usableInputBudget: 1000,
      },
      checkpoint: null,
      modifiedFiles: [],
      unverifiedFiles: [],
      staleEvidence: [],
      taskGate,
      subagents: [],
    };
  }

  it('announces the blocked task gate with role=alert and one-shot entry motion', () => {
    const { querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        contextState={taskGateState({ ok: false, reasons: ['存在未验证文件'] })}
      />,
    );
    const gate = querySelector('.task-gate');
    expect(gate?.getAttribute('role')).toBe('alert');
    expect(gate?.classList.contains('motion-feedback-enter')).toBe(true);
    expect(gate?.textContent).toContain('任务阻塞');
  });

  it('announces the ready task gate with role=status and one-shot entry motion', () => {
    const { querySelector } = render(
      <WorkspacePanel
        workDir="D:/test"
        goal={GOAL}
        progress={PROGRESS}
        deliverables={DELIVERABLES}
        touchedFiles={new Set()}
        contextState={taskGateState({ ok: true, reasons: [] })}
      />,
    );
    const gate = querySelector('.task-gate');
    expect(gate?.getAttribute('role')).toBe('status');
    expect(gate?.classList.contains('motion-feedback-enter')).toBe(true);
    expect(gate?.textContent).toContain('任务可完成');
  });
});
