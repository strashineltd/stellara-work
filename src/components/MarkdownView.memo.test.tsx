import { describe, it, expect, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useState } from 'react';

const markdown = vi.hoisted(() => ({ renders: 0 }));

vi.mock('react-markdown', () => ({
  default: () => {
    markdown.renders += 1;
    return null;
  },
}));

import { MarkdownView } from './MarkdownView';

function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" data-testid="bump" onClick={() => setTick((t) => t + 1)}>{tick}</button>
      <MarkdownView content="**加粗**" workDir="/w" />
    </>
  );
}

describe('MarkdownView memoization', () => {
  it('does not re-parse markdown when the parent re-renders with unchanged props', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    expect(markdown.renders).toBe(1);

    act(() => {
      container.querySelector('[data-testid="bump"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(markdown.renders).toBe(1);

    act(() => root!.unmount());
    document.body.removeChild(container);
  });
});
