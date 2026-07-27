import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Sidebar } from './Sidebar';
import type { SessionSummary } from '../../shared/ipc';

const SESSIONS: SessionSummary[] = [
  { id: 'a', title: '给 main.tsx 加日志', modelId: 'deepseek', messageCount: 3, updatedAt: Date.now() - 60_000 },
  { id: 'b', title: 'review code', modelId: 'deepseek', messageCount: 1, updatedAt: Date.now() - 600_000 },
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

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Sidebar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the brand mark', () => {
    const { getByText } = render(<Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} />);
    expect(getByText(/stellara/i)).toBeTruthy();
  });

  it('marks the active session with an accent border + soft background', () => {
    const { querySelector } = render(<Sidebar sessions={SESSIONS} activeId="a" onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} />);
    const active = querySelector('[data-session-id="a"]')!;
    expect(active.className).toMatch(/active|accent/);
  });

  it('does not use any emoji glyphs (monochrome icons only)', () => {
    const { container } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('invokes onSelect when a session row is clicked', () => {
    const onSelect = vi.fn();
    const { getByText } = render(<Sidebar sessions={SESSIONS} activeId={null} onSelect={onSelect} onNew={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} />);
    const el = getByText('给 main.tsx 加日志');
    fireClick(el);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('invokes onNew when the new-session button is clicked', () => {
    const onNew = vi.fn();
    const { getByText } = render(<Sidebar sessions={[]} activeId={null} onSelect={vi.fn()} onNew={onNew} onDelete={vi.fn()} onRename={vi.fn()} onExport={vi.fn()} />);
    const el = getByText(/new session|新建会话/i);
    fireClick(el);
    expect(onNew).toHaveBeenCalledOnce();
  });
});
