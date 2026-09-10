import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalModeMenu } from './ApprovalModeMenu';

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('ApprovalModeMenu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('renders the current mode label', () => {
    const { container, unmount } = render(<ApprovalModeMenu mode="step" onModeChange={vi.fn()} />);
    expect(container.textContent).toContain('逐步批准');
    unmount();
  });

  it('lists all three modes and reports selection', () => {
    const onModeChange = vi.fn();
    const { container, unmount } = render(<ApprovalModeMenu mode="step" onModeChange={onModeChange} />);
    fireClick(container.querySelector('.approval-mode-menu button'));
    const auto = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('帮我批准')) ?? null;
    fireClick(auto);
    expect(onModeChange).toHaveBeenCalledWith('auto');
    unmount();
  });

  it('closes without reporting when disabled', () => {
    const onModeChange = vi.fn();
    const { container, unmount } = render(<ApprovalModeMenu mode="step" onModeChange={onModeChange} disabled />);
    fireClick(container.querySelector('.approval-mode-menu button'));
    expect(container.querySelectorAll('.approval-mode-menu__item').length).toBe(0);
    unmount();
  });
});
