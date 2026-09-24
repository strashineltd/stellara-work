import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { DiffCard } from './DiffCard';

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
    querySelector: container.querySelector.bind(container) as typeof container.querySelector,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

function click(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('DiffCard (P4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to collapsed and only shows path + stats', () => {
    const { querySelector, container, unmount } = render(
      <DiffCard path="src/a.ts" before={'a\nb'} after={'a\nc'} />,
    );
    expect(querySelector('.diff-codemirror-container')).toBeNull();
    expect(container.textContent).toContain('src/a.ts');
    expect(container.textContent).toContain('+1');
    expect(container.textContent).toContain('-1');
    unmount();
  });

  it('expands on header click and mounts the editor container', async () => {
    const { querySelector, unmount } = render(
      <DiffCard path="src/a.ts" before={'a\nb'} after={'a\nc'} />,
    );
    click(querySelector('.tool-card-header'));
    expect(querySelector('.diff-codemirror-container')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    unmount();
  });

  it('marks new files without line stats', () => {
    const { container, unmount } = render(
      <DiffCard path="src/new.ts" before={null} after={'hello'} />,
    );
    expect(container.textContent).toContain('新文件');
    expect(container.textContent).not.toContain('+0');
    unmount();
  });
});
