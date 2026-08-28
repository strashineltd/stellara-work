import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { TabBar } from './TabBar';
import type { TabBarTab } from './TabBar';

const TABS: TabBarTab[] = [
  { id: 'a', title: 'fix #42', status: 'active' },
  { id: 'b', title: 'review code', status: 'waiting' },
  { id: 'c', title: 'old session', status: 'idle' },
];

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

function fireContextMenu(el: Element | null, clientX: number, clientY: number) {
  if (!el) throw new Error('Element not found for context menu');
  act(() => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }));
  });
}

function fireMouseDown(el: Element | null) {
  if (!el) throw new Error('Element not found for mousedown');
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

function fireEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function fireTransitionEnd(el: Element | null) {
  if (!el) throw new Error('Element not found for transitionend');
  act(() => {
    el.dispatchEvent(new Event('transitionend', { bubbles: true }));
  });
}

describe('TabBar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    document.body.replaceChildren();
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
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

  it('passes the new-tab button as the New Session return target', () => {
    const onNewTab = vi.fn();
    const { querySelector } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={onNewTab} />,
    );
    const button = querySelector('[aria-label="新建会话标签页"]') as HTMLButtonElement;

    fireClick(button);

    expect(onNewTab).toHaveBeenCalledWith(button);
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

  function renderTabBar(overrides: { onRename?: () => void; onCloseOthers?: () => void } = {}) {
    return render(
      <TabBar
        tabs={TABS}
        activeId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNewTab={vi.fn()}
        onRename={overrides.onRename ?? vi.fn()}
        onCloseOthers={overrides.onCloseOthers ?? vi.fn()}
      />,
    );
  }

  it('retains the context menu through root-only exit with logical disclosure state', () => {
    const { container } = renderTabBar();
    const chip = container.querySelector('[data-tab-id="a"]')!;
    expect(chip.getAttribute('aria-haspopup')).toBe('menu');
    expect(chip.getAttribute('aria-expanded')).toBe('false');

    fireContextMenu(chip, 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('data-motion')).toBe('menu');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');

    const child = menu.querySelector('button')!;
    child.focus();
    fireEscape();

    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(chip);

    fireTransitionEnd(child);
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    fireTransitionEnd(menu);
    expect(container.querySelector('.tab-context-menu')).toBeNull();
  });

  it('restores the durable chip after nonfocusable background dismissal', () => {
    const background = document.createElement('div');
    const nestedTarget = document.createElement('span');
    background.appendChild(nestedTarget);
    document.body.appendChild(background);
    const { container } = renderTabBar();
    const chip = container.querySelector('[data-tab-id="a"]')!;
    fireContextMenu(chip, 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    menu.querySelector<HTMLElement>('button')?.focus();

    fireMouseDown(nestedTarget);

    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(chip);
    fireTransitionEnd(menu);
  });

  it('lets a focusable outside pointer target own focus when closing the context menu', () => {
    const outside = document.createElement('button');
    const nestedTarget = document.createElement('span');
    outside.appendChild(nestedTarget);
    document.body.appendChild(outside);
    const { container } = renderTabBar();
    const chip = container.querySelector('[data-tab-id="a"]') as HTMLElement;
    fireContextMenu(chip, 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    const chipFocus = vi.spyOn(chip, 'focus');
    menu.querySelector<HTMLElement>('button')?.focus();
    outside.focus();

    fireMouseDown(nestedTarget);

    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(chipFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    fireTransitionEnd(menu);
  });

  it('restores the tab chip before an ordinary Rename callback and inert commit', () => {
    let menu!: HTMLElement;
    let callbackActive: Element | null = null;
    let callbackInert: boolean | null = null;
    const onRename = vi.fn(() => {
      callbackActive = document.activeElement;
      callbackInert = menu.hasAttribute('inert');
    });
    const { container } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={vi.fn()} onNewTab={vi.fn()} onRename={onRename} onCloseOthers={vi.fn()} />,
    );
    const chip = container.querySelector('[data-tab-id="a"]') as HTMLElement;
    fireContextMenu(chip, 20, 20);
    menu = container.querySelector('.tab-context-menu') as HTMLElement;
    const renameItem = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === '重命名')!;
    renameItem.focus();

    fireClick(renameItem);

    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith('a');
    expect(callbackActive).toBe(chip);
    expect(callbackInert).toBe(false);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
  });

  it('focuses the durable new-tab button when a Close action removes its tab', () => {
    function Harness() {
      const [tabs, setTabs] = useState(TABS);
      return (
        <TabBar
          tabs={tabs}
          activeId="a"
          onSelect={vi.fn()}
          onClose={(id) => setTabs((prev) => prev.filter((t) => t.id !== id))}
          onNewTab={vi.fn()}
          onRename={vi.fn()}
          onCloseOthers={vi.fn()}
        />
      );
    }
    const { container } = render(<Harness />);
    fireContextMenu(container.querySelector('[data-tab-id="a"]'), 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    const closeItem = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === '关闭')!;
    closeItem.focus();
    const newTab = container.querySelector('[aria-label="新建会话标签页"]') as HTMLElement;

    fireClick(closeItem);

    expect(container.querySelector('[data-tab-id="a"]')).toBeNull();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(newTab);
  });

  it('claims the Close action before same-stack redispatch during retained exit', () => {
    let closeItem!: HTMLButtonElement;
    const onClose = vi.fn(() => {
      if (onClose.mock.calls.length === 1) {
        closeItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    const { container } = render(
      <TabBar tabs={TABS} activeId="a" onSelect={vi.fn()} onClose={onClose} onNewTab={vi.fn()} onRename={vi.fn()} onCloseOthers={vi.fn()} />,
    );
    fireContextMenu(container.querySelector('[data-tab-id="a"]'), 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    closeItem = Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === '关闭')!;

    fireClick(closeItem);

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith('a');
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
  });

  it('rapidly reopens the retained context menu without replacing its root', () => {
    const { container } = renderTabBar();
    const chip = container.querySelector('[data-tab-id="a"]')!;
    fireContextMenu(chip, 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    fireEscape();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');

    fireContextMenu(chip, 30, 30);
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('entering');
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(menu.getAttribute('aria-hidden')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('true');

    fireTransitionEnd(menu);
    expect(container.querySelector('.tab-context-menu')).toBe(menu);

    fireEscape();
    fireTransitionEnd(menu);
    expect(container.querySelector('.tab-context-menu')).toBeNull();
  });

  it('removes the closing menu via the 170ms Presence fallback without a transitionend', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderTabBar();
    fireContextMenu(container.querySelector('[data-tab-id="a"]'), 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    fireEscape();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');

    act(() => vi.advanceTimersByTime(169));
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.tab-context-menu')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('completes the closing context menu only from its own root', () => {
    const { container } = renderTabBar();
    fireContextMenu(container.querySelector('[data-tab-id="a"]'), 20, 20);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;
    fireEscape();
    const child = menu.querySelector('button')!;

    fireTransitionEnd(child);
    expect(container.querySelector('.tab-context-menu')).toBe(menu);
    fireTransitionEnd(menu);
    expect(container.querySelector('.tab-context-menu')).toBeNull();
  });

  it('retains the tab payload through retained exit', () => {
    const { container } = renderTabBar();
    fireContextMenu(container.querySelector('[data-tab-id="a"]'), 40, 60);
    const menu = container.querySelector('.tab-context-menu') as HTMLElement;

    fireEscape();

    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.style.left).toBe('40px');
    expect(menu.style.top).toBe('60px');
    expect(menu.textContent).toContain('重命名');
    expect(container.querySelector('[data-tab-id="a"]')?.getAttribute('aria-expanded')).toBe('false');
    fireTransitionEnd(menu);
  });

  it('removes document listeners after the logical context menu registers them', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const view = renderTabBar();
    fireContextMenu(view.querySelector('[data-tab-id="a"]'), 20, 20);
    const menuListeners = addEventListener.mock.calls.filter(
      ([type]) => type === 'mousedown' || type === 'keydown',
    );

    expect(menuListeners.filter(([type]) => type === 'mousedown')).toHaveLength(1);
    expect(menuListeners.filter(([type]) => type === 'keydown')).toHaveLength(1);
    view.unmount();

    menuListeners.forEach(([type, listener]) => {
      expect(removeEventListener).toHaveBeenCalledWith(type, listener);
    });
  });

  it('clears the Presence fallback timer when TabBar unmounts while closing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const view = renderTabBar();
    fireContextMenu(view.querySelector('[data-tab-id="a"]'), 20, 20);
    fireEscape();
    expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 170)).toHaveLength(1);
    const clearCount = clearTimeoutSpy.mock.calls.length;

    view.unmount();

    expect(clearTimeoutSpy.mock.calls).toHaveLength(clearCount + 1);
  });
});
