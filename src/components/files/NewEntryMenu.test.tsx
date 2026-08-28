import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { NewEntryMenu } from './NewEntryMenu';

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  act(() => {
    root.render(<NewEntryMenu workDir="/w" onCreated={vi.fn()} />);
  });
  return {
    container,
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

function getTrigger(container: HTMLElement): HTMLButtonElement {
  const trigger = container.querySelector<HTMLButtonElement>('.new-entry-menu__trigger');
  if (!trigger) throw new Error('trigger not found');
  return trigger;
}

function getDropdown(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.new-entry-menu__dropdown');
}

function getItem(container: HTMLElement, text: string): Element {
  const items = container.querySelectorAll('.new-entry-menu__item');
  for (const item of items) {
    if (item.textContent?.includes(text)) return item;
  }
  throw new Error(`menu item not found: ${text}`);
}

function openMenu(container: HTMLElement) {
  fireClick(getTrigger(container));
  const dropdown = getDropdown(container);
  if (!dropdown) throw new Error('dropdown did not open');
  return dropdown;
}

describe('NewEntryMenu', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

  it('opens a bottom-anchored menu with logical trigger ARIA', () => {
    const { container } = render();
    const trigger = getTrigger(container);
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const dropdown = openMenu(container);

    expect(dropdown.getAttribute('data-motion')).toBe('menu');
    expect(dropdown.getAttribute('data-side')).toBe('bottom');
    expect(dropdown.getAttribute('data-motion-state')).toBe('entering');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('retains the menu through Escape with an inert closing root and restores the durable trigger', () => {
    const { container } = render();
    const trigger = getTrigger(container);
    const dropdown = openMenu(container);

    fireEscape();

    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    expect(dropdown.hasAttribute('inert')).toBe(true);
    expect(dropdown.getAttribute('aria-hidden')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
  });

  it('renders the inline form immediately while the dropdown closes inert', () => {
    const { container } = render();
    const dropdown = openMenu(container);

    fireClick(getItem(container, '新建文件'));

    const input = container.querySelector('.new-entry-menu__input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    expect(dropdown.hasAttribute('inert')).toBe(true);
    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
    expect(container.querySelector('.new-entry-menu__input')).toBeTruthy();
  });

  it('restores the durable trigger after nonfocusable background dismissal', () => {
    const background = document.createElement('div');
    const nestedTarget = document.createElement('span');
    background.appendChild(nestedTarget);
    document.body.appendChild(background);
    const { container } = render();
    const trigger = getTrigger(container);
    const dropdown = openMenu(container);

    fireMouseDown(nestedTarget);

    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    expect(dropdown.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(trigger);
    fireTransitionEnd(dropdown);
  });

  it('lets a focusable outside pointer target own focus when dismissing the menu', () => {
    const outside = document.createElement('button');
    const nestedTarget = document.createElement('span');
    outside.appendChild(nestedTarget);
    document.body.appendChild(outside);
    const { container } = render();
    const trigger = getTrigger(container);
    const dropdown = openMenu(container);
    const triggerFocus = vi.spyOn(trigger, 'focus');
    outside.focus();

    fireMouseDown(nestedTarget);

    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    expect(dropdown.hasAttribute('inert')).toBe(true);
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    fireTransitionEnd(dropdown);
  });

  it('does not replay a menu item action on a retained-closing root', () => {
    const { container } = render();
    const dropdown = openMenu(container);

    fireEscape();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');

    fireClick(getItem(container, '新建文件'));

    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
  });

  it('completes the dropdown exit only from the root, not a child', () => {
    const { container } = render();
    const dropdown = openMenu(container);

    fireEscape();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');

    fireTransitionEnd(getItem(container, '新建文件'));
    expect(getDropdown(container)).toBe(dropdown);

    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
  });

  it('rapidly reopens the retained menu without replacing its root', () => {
    const { container } = render();
    const trigger = getTrigger(container);
    const dropdown = openMenu(container);
    fireEscape();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');

    fireClick(trigger);
    expect(getDropdown(container)).toBe(dropdown);
    expect(dropdown.getAttribute('data-motion-state')).toBe('entering');
    expect(dropdown.hasAttribute('inert')).toBe(false);
    expect(dropdown.getAttribute('aria-hidden')).toBeNull();

    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBe(dropdown);

    fireEscape();
    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the closing dropdown via the 170ms Presence fallback without a transitionend', () => {
    const { container } = render();
    const dropdown = openMenu(container);
    fireEscape();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');

    act(() => vi.advanceTimersByTime(169));
    expect(getDropdown(container)).toBe(dropdown);
    act(() => vi.advanceTimersByTime(1));
    expect(getDropdown(container)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the inline form and its retained dropdown shell on cancel', () => {
    const { container } = render();
    const dropdown = openMenu(container);
    fireClick(getItem(container, '新建文件夹'));
    expect(container.querySelector('.new-entry-menu__input')).toBeTruthy();

    fireClick(container.querySelector('.new-entry-menu__cancel'));

    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
    expect(dropdown.getAttribute('data-motion-state')).toBe('closing');
    fireTransitionEnd(dropdown);
    expect(getDropdown(container)).toBeNull();
  });
});
