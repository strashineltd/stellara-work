import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { FileTreeNode } from './FileTreeNode';
import { REDUCED_MOTION_QUERY } from '../hooks/useReducedMotion';
import type { FsNode } from '../../shared/ipc';

const TREE: FsNode = {
  name: 'root',
  path: '/root',
  type: 'dir',
  children: [
    { name: 'src', path: '/root/src', type: 'dir', children: [] },
    { name: 'README.md', path: '/root/README.md', type: 'file', size: 2048 },
  ],
};

type TreeNodeProps = React.ComponentProps<typeof FileTreeNode>;

function treeProps(overrides: Partial<TreeNodeProps> = {}): TreeNodeProps {
  return {
    node: TREE,
    depth: 0,
    expanded: new Set(['/root']),
    selected: null,
    workDir: '/root',
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
}

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

function renderTree(overrides: Partial<TreeNodeProps> = {}) {
  return render(<ul className="ftree"><FileTreeNode {...treeProps(overrides)} /></ul>);
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('FileTreeNode', () => {
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

  it('opens a node context menu with truthful bottom placement', () => {
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('data-motion')).toBe('menu');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');
    expect(menu.style.left).toBe('30px');
    expect(menu.style.top).toBe('40px');
  });

  it('retains the menu through Escape with an inert closing root and restores the durable row', () => {
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;

    fireEscape();

    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(row);
    fireTransitionEnd(menu);
    expect(container.querySelector('.context-menu')).toBeNull();
  });

  it('restores the durable row after nonfocusable background dismissal', () => {
    const background = document.createElement('div');
    const nestedTarget = document.createElement('span');
    background.appendChild(nestedTarget);
    document.body.appendChild(background);
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;

    fireMouseDown(nestedTarget);

    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(row);
    fireTransitionEnd(menu);
  });

  it('lets a focusable outside pointer target own focus when dismissing the menu', () => {
    const outside = document.createElement('button');
    const nestedTarget = document.createElement('span');
    outside.appendChild(nestedTarget);
    document.body.appendChild(outside);
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    const rowFocus = vi.spyOn(row, 'focus');
    outside.focus();

    fireMouseDown(nestedTarget);

    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(rowFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    fireTransitionEnd(menu);
  });

  it('fires the copy action immediately and restores the durable row before the inert commit', () => {
    const writeText = stubClipboard();
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    const copyItem = Array.from(menu.querySelectorAll('li')).find((li) => li.textContent?.includes('复制路径'))!;
    const rowFocus = vi.spyOn(row, 'focus');

    fireClick(copyItem);

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('/root');
    expect(rowFocus).toHaveBeenCalledOnce();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it('guards a same-stack action redispatch during retained exit', () => {
    let copyItem!: HTMLLIElement;
    const writeText = vi.fn(() => {
      copyItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return Promise.resolve();
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { container } = renderTree();
    fireContextMenu(container.querySelector('.ftree-row'), 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    copyItem = Array.from(menu.querySelectorAll('li')).find((li) => li.textContent?.includes('复制路径'))!;

    fireClick(copyItem);

    expect(writeText).toHaveBeenCalledOnce();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
  });

  it('rapidly reopens the retained menu without replacing its root', () => {
    const { container } = renderTree();
    const row = container.querySelector('.ftree-row') as HTMLElement;
    fireContextMenu(row, 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    fireEscape();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');

    fireContextMenu(row, 50, 50);
    expect(container.querySelector('.context-menu')).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('entering');
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(menu.getAttribute('aria-hidden')).toBeNull();

    fireTransitionEnd(menu);
    expect(container.querySelector('.context-menu')).toBe(menu);

    fireEscape();
    fireTransitionEnd(menu);
    expect(container.querySelector('.context-menu')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the closing menu via the 170ms Presence fallback without a transitionend', () => {
    const { container } = renderTree();
    fireContextMenu(container.querySelector('.ftree-row'), 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    fireEscape();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');

    act(() => vi.advanceTimersByTime(169));
    expect(container.querySelector('.context-menu')).toBe(menu);
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.context-menu')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains each recursive node menu through its own exit with distinct identity', () => {
    const { container } = renderTree();
    const rows = container.querySelectorAll('.ftree-row');
    fireContextMenu(rows[2]! as HTMLElement, 20, 20);
    const readmeMenu = container.querySelector('.context-menu') as HTMLElement;
    expect(readmeMenu.style.top).toBe('20px');

    fireEscape();
    expect(readmeMenu.getAttribute('data-motion-state')).toBe('closing');
    expect(readmeMenu.hasAttribute('inert')).toBe(true);

    fireContextMenu(rows[0]! as HTMLElement, 50, 50);
    const menus = container.querySelectorAll('.context-menu');
    expect(menus.length).toBe(2);
    const rootMenu = Array.from(menus).find((m) => m !== readmeMenu)! as HTMLElement;
    expect(rootMenu.style.top).toBe('50px');
    expect(rootMenu.getAttribute('data-motion-state')).toBe('entering');
    expect(readmeMenu.getAttribute('data-motion-state')).toBe('closing');

    fireTransitionEnd(readmeMenu);
    expect(container.querySelectorAll('.context-menu').length).toBe(1);
    fireEscape();
    fireTransitionEnd(rootMenu);
    expect(container.querySelector('.context-menu')).toBeNull();
  });

  it('removes document listeners after the logical context menu registers them', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const view = renderTree();
    fireContextMenu(view.querySelector('.ftree-row'), 30, 40);
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

  it('clears the Presence fallback timer when a node unmounts while closing', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const view = renderTree();
    fireContextMenu(view.querySelector('.ftree-row'), 30, 40);
    fireEscape();
    expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 170)).toHaveLength(1);
    const clearCount = clearTimeoutSpy.mock.calls.length;

    view.unmount();

    expect(clearTimeoutSpy.mock.calls).toHaveLength(clearCount + 1);
  });

  it('removes the menu immediately under reduced motion', () => {
    const media = {
      get matches() {
        return true;
      },
      media: REDUCED_MOTION_QUERY,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const { container } = renderTree();
    fireContextMenu(container.querySelector('.ftree-row'), 30, 40);
    const menu = container.querySelector('.context-menu') as HTMLElement;
    expect(menu.getAttribute('data-motion-state')).toBe('open');

    fireEscape();

    expect(container.querySelector('.context-menu')).toBeNull();
  });
});
