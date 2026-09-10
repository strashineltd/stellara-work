import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTopBar } from './AppTopBar';

const BASE_PROPS = {
  canGoBack: false,
  canGoForward: false,
  onBack: vi.fn(),
  onForward: vi.fn(),
  sidebarOpen: true,
  workspaceOpen: false,
  onToggleSidebar: vi.fn(),
  onToggleWorkspace: vi.fn(),
};

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(ui); });
  return {
    container,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('AppTopBar', () => {
  beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

  it('disables back/forward when history is empty', () => {
    const { container, unmount } = render(<AppTopBar {...BASE_PROPS} />);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="前进"]')?.disabled).toBe(true);
    unmount();
  });

  it('calls back and forward when enabled', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const { container, unmount } = render(
      <AppTopBar {...BASE_PROPS} canGoBack canGoForward onBack={onBack} onForward={onForward} />,
    );
    fireClick(container.querySelector('[aria-label="后退"]'));
    fireClick(container.querySelector('[aria-label="前进"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('renders the local execution target by default and a custom slot when provided', () => {
    const first = render(<AppTopBar {...BASE_PROPS} />);
    expect(first.container.querySelector('.execution-target-chip')?.textContent).toContain('本地');
    first.unmount();

    const second = render(<AppTopBar {...BASE_PROPS} executionTarget={<button type="button">自定义服务器</button>} />);
    expect(second.container.textContent).toContain('自定义服务器');
    expect(second.container.querySelector('.execution-target-chip')).toBeNull();
    second.unmount();
  });

  it('exposes panel toggles with pressed state', () => {
    const onToggleSidebar = vi.fn();
    const onToggleWorkspace = vi.fn();
    const { container, unmount } = render(
      <AppTopBar {...BASE_PROPS} sidebarOpen={false} workspaceOpen onToggleSidebar={onToggleSidebar} onToggleWorkspace={onToggleWorkspace} />,
    );
    const sidebar = container.querySelector<HTMLButtonElement>('[aria-label="显示侧栏"]');
    expect(sidebar?.getAttribute('aria-pressed')).toBe('false');
    fireClick(sidebar);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
    const workspace = container.querySelector<HTMLButtonElement>('[aria-label="隐藏工作区"]');
    expect(workspace?.getAttribute('aria-pressed')).toBe('true');
    fireClick(workspace);
    expect(onToggleWorkspace).toHaveBeenCalledTimes(1);
    unmount();
  });
});
