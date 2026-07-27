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
});
