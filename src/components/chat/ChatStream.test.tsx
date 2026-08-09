import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { ChatStream } from './ChatStream';
import type { DisplayEntry } from '../../lib/chat-utils';

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  const chatRef = { current: container };
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    chatRef,
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

const EMPTY_ENTRIES: DisplayEntry[] = [];

describe('ChatStream', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders without throwing (empty state)', () => {
    expect(() =>
      render(
        <ChatStream
          entries={EMPTY_ENTRIES}
          busy={false}
          streamId={null}
          chatRef={null as any}
          lastUserForRetry={null}
          modelMissing={false}
          onOpenSettings={vi.fn()}
          onRetry={vi.fn()}
          onAbort={vi.fn()}
          onApprove={vi.fn()}
          pendingApproval={null}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name main-chat', () => {
    const { querySelector } = render(
      <ChatStream
        entries={EMPTY_ENTRIES}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    const main = querySelector('.main-chat');
    expect(main).toBeTruthy();
  });

  it('does not use emoji glyphs in rendered HTML (empty state)', () => {
    const { container } = render(
      <ChatStream
        entries={EMPTY_ENTRIES}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('wraps report file paths in hoverable-path when workDir provided', () => {
    const { querySelectorAll } = render(
      <ChatStream
        entries={[{
          kind: 'report',
          summary: '完成',
          files: [{ path: 'src/a.ts', kind: 'edit' }],
          commands: [],
        }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        workDir="/w"
      />,
    );
    expect(querySelectorAll('.report-file-path .hoverable-path').length).toBe(1);
  });

  it('renders report file paths plain without workDir', () => {
    const { querySelectorAll } = render(
      <ChatStream
        entries={[{
          kind: 'report',
          summary: '完成',
          files: [{ path: 'src/a.ts', kind: 'edit' }],
          commands: [],
        }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    expect(querySelectorAll('.report-file-path').length).toBe(1);
    expect(querySelectorAll('.report-file-path .hoverable-path').length).toBe(0);
  });

  it('renders a plan entry with approve buttons when approval pending', () => {
    const onApprovePlan = vi.fn();
    const { getByText, querySelector } = render(
      <ChatStream
        entries={[{ kind: 'plan', steps: [{ description: '写 README', status: 'pending' }] }]}
        busy={true}
        streamId="s1"
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        pendingPlanApproval={{ id: 'plan-1', plan: ['写 README'] }}
        onApprovePlan={onApprovePlan}
        onRejectPlan={vi.fn()}
      />,
    );
    expect(getByText('执行计划')).not.toBeNull();
    expect(querySelector('.plan-actions')).not.toBeNull();
  });
});
