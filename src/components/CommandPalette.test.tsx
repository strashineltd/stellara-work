import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

type PaletteProps = React.ComponentProps<typeof CommandPalette> & {
  presence?: {
    state: 'entering' | 'open' | 'closing';
    completeExit: (event?: { target: EventTarget | null; currentTarget: EventTarget | null }) => void;
  };
};

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function paletteProps(overrides: Partial<PaletteProps> = {}): PaletteProps {
  return {
    onClose: vi.fn(),
    sessions: [],
    modelList: [],
    activeSessionId: null,
    activeModelId: null,
    theme: 'light',
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onSetActiveModel: vi.fn(),
    onSetTheme: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenFileTree: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleWorkspace: vi.fn(),
    onTogglePlanMode: vi.fn(),
    onNewTask: vi.fn(),
    ...overrides,
  };
}

function renderPalette(initialProps: PaletteProps = paletteProps()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);

  function render(props: PaletteProps) {
    act(() => root.render(<CommandPalette {...props} />));
  }

  render(initialProps);
  return {
    container,
    rerender: render,
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

function getCommand(container: HTMLElement, label: string): HTMLElement {
  const item = Array.from(container.querySelectorAll<HTMLElement>('.command-palette-item'))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!item) throw new Error(`Command not found: ${label}`);
  return item;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    Element.prototype.scrollIntoView = () => {};
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('exposes exact modal semantics and focuses the search input on open', () => {
    const { container } = renderPalette();
    const palette = container.querySelector('.command-palette');
    const input = container.querySelector('.command-palette-input');

    expect(palette?.getAttribute('role')).toBe('dialog');
    expect(palette?.getAttribute('aria-modal')).toBe('true');
    expect(palette?.getAttribute('aria-label')).toBe('命令面板');
    expect(document.activeElement).toBe(input);
  });

  it('focuses the search input when reduced motion mounts directly in the open state', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = renderPalette(paletteProps({
      presence: { state: 'open', completeExit: vi.fn() },
    }));

    expect(document.activeElement).toBe(container.querySelector('.command-palette-input'));
  });

  it('closes ordinarily on Escape and ignores repeated close work while leaving', () => {
    const onClose = vi.fn();
    const completeExit = vi.fn();
    const view = renderPalette(paletteProps({
      onClose,
      presence: { state: 'open', completeExit },
    }));
    const input = view.container.querySelector('.command-palette-input')!;

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledWith();

    view.rerender(paletteProps({
      onClose,
      presence: { state: 'closing', completeExit },
    }));
    const backdrop = view.container.querySelector('.modal-backdrop') as HTMLElement;
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it('refocuses the search input when a retained palette rapidly reopens', () => {
    const completeExit = vi.fn();
    const props = paletteProps({ presence: { state: 'entering', completeExit } });
    const view = renderPalette(props);
    const input = view.container.querySelector('.command-palette-input');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    view.rerender(paletteProps({ presence: { state: 'closing', completeExit } }));
    view.rerender(paletteProps({ presence: { state: 'entering', completeExit } }));

    expect(document.activeElement).toBe(input);
  });

  it.each([
    ['打开设置', 'onOpenSettings'],
    ['管理 skills', 'onOpenSettings'],
    ['添加新模型', 'onOpenSettings'],
    ['打开文件树', 'onOpenFileTree'],
    ['新任务（清空当前聊天）', 'onNewTask'],
  ] as const)('transfers focus ownership when running %s', async (label, actionName) => {
    const onClose = vi.fn();
    const action = vi.fn();
    const props = paletteProps({ onClose, [actionName]: action });
    const { container } = renderPalette(props);

    await click(getCommand(container, label));

    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: false });
  });

  it.each([
    ['打开文件树', 'onOpenFileTree'],
    ['新任务（清空当前聊天）', 'onNewTask'],
  ] as const)('keeps the palette open and focused when %s cannot run', async (label, actionName) => {
    const onClose = vi.fn();
    const action = vi.fn(() => false);
    const { container } = renderPalette(paletteProps({ onClose, [actionName]: action }));
    const input = container.querySelector('.command-palette-input');

    await click(getCommand(container, label));

    expect(action).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('transfers focus ownership when New Session reports that it opened a destination', async () => {
    const onClose = vi.fn();
    const onNewSession = vi.fn(() => true);
    const { container } = renderPalette(paletteProps({ onClose, onNewSession }));

    await click(getCommand(container, '新建会话'));

    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: false });
  });

  it('closes New Session ordinarily when it does not transfer focus', async () => {
    const onClose = vi.fn();
    const onNewSession = vi.fn();
    const { container } = renderPalette(paletteProps({ onClose, onNewSession }));

    await click(getCommand(container, '新建会话'));

    expect(onNewSession).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith();
  });

  it('ignores command activation while the retained palette is closing', async () => {
    const onNewSession = vi.fn();
    const onClose = vi.fn();
    const { container } = renderPalette(paletteProps({
      onNewSession,
      onClose,
      presence: { state: 'closing', completeExit: vi.fn() },
    }));

    await click(getCommand(container, '新建会话'));

    expect(onNewSession).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
