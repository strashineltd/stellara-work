import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { TabBar } from './TabBar';
import type { TabBarTab } from './TabBar';

const TABS: TabBarTab[] = [
  { id: 'a', title: 'fix #42', status: 'active' },
  { id: 'b', title: 'review code', status: 'waiting' },
  { id: 'c', title: 'old session', status: 'idle' },
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
        if (
          node.textContent &&
          (typeof pattern === 'string'
            ? node.textContent.includes(pattern)
            : pattern.test(node.textContent))
        ) {
          return node.parentElement!;
        }
      }
      return null;
    },
    getCloseButtons: (): Element[] => {
      const buttons: Element[] = [];
      const all = container.querySelectorAll('[aria-label^="关闭标签页"]');
      all.forEach((b) => buttons.push(b));
      return buttons;
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

describe('TabBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a chip per tab', () => {
    const { getByText } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    expect(getByText('fix #42')).toBeTruthy();
    expect(getByText('review code')).toBeTruthy();
    expect(getByText('old session')).toBeTruthy();
  });

  it('highlights the active chip', () => {
    const { querySelector } = render(
      <TabBar tabs={TABS} activeId="b" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    const chip = querySelector('[data-tab-id="b"]')!;
    expect(chip.className).toMatch(/active|selected/i);
  });

  it('invokes onSelect on click', () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={onSelect} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    fireClick(getByText('review code'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('invokes onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { getCloseButtons } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={onClose} onNewTab={vi.fn()} />,
    );
    const buttons = getCloseButtons();
    fireClick(buttons[0]);
    expect(onClose).toHaveBeenCalledWith('a');
  });

  it('does not use emoji glyphs (monochrome text-only status dots)', () => {
    const { container } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    const html = container.innerHTML;
    // No emoji ranges
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('keeps close controls separate from tab buttons', () => {
    const { querySelector, querySelectorAll } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    expect(querySelector('.tab-chip .tab-chip-close')).toBeNull();
    expect(querySelectorAll('button.tab-chip-close').length).toBe(3);
  });

  it('supports arrow-key tab navigation', () => {
    const onSelect = vi.fn();
    const { querySelector } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={onSelect} onClose={vi.fn()} onNewTab={vi.fn()} />,
    );
    const active = querySelector('[data-tab-id="a"]')!;
    act(() => {
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});
