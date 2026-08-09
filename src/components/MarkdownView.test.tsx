import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { MarkdownView } from './MarkdownView';

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
  };
}

describe('MarkdownView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders paragraphs unchanged without workDir', () => {
    const { container, unmount } = render(<MarkdownView content="修改了 src/a.ts 文件" />);
    const p = container.querySelector('p');
    expect(p).toBeTruthy();
    expect(p?.textContent).toBe('修改了 src/a.ts 文件');
    expect(container.querySelector('.hoverable-path')).toBeNull();
    unmount();
  });

  it('wraps paths in hoverable spans with workDir, preserving full text', () => {
    const { container, unmount } = render(
      <MarkdownView content="修改了 src/a.ts 文件" workDir="/w" />,
    );
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe('修改了 src/a.ts 文件');
    const spans = container.querySelectorAll('.hoverable-path');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('src/a.ts');
    unmount();
  });

  it('does not wrap paragraphs without path-like text', () => {
    const { container, unmount } = render(
      <MarkdownView content="没有任何路径，只有普通文字。" workDir="/w" />,
    );
    expect(container.querySelector('.hoverable-path')).toBeNull();
    unmount();
  });
});
