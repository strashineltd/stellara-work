import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaceholderPage } from './PlaceholderPage';

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

describe('PlaceholderPage', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders title and description', () => {
    const { container, unmount } = render(
      <PlaceholderPage title="Pull Request" description="Pull Request 将在后续版本推出" />,
    );
    expect(container.textContent).toContain('Pull Request');
    expect(container.textContent).toContain('将在后续版本推出');
    unmount();
  });

  it('calls back-home action when provided', () => {
    const onBackHome = vi.fn();
    const { container, unmount } = render(
      <PlaceholderPage title="已安排" description="即将推出" onBackHome={onBackHome} />,
    );
    act(() => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onBackHome).toHaveBeenCalledTimes(1);
    unmount();
  });
});
