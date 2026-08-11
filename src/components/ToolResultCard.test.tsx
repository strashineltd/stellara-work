import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToolResultCard } from './ToolResultCard';
import type { ToolResultMeta } from '../../shared/ipc';

const EDIT_META: ToolResultMeta = { kind: 'edit', path: 'src/foo.ts', before: 'a', after: 'b' };
const LONG_OUTPUT = 'x'.repeat(300);

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

async function openCard(container: HTMLElement) {
  const header = container.querySelector('.tool-card-header-inner') as HTMLElement;
  await act(async () => {
    header.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('ToolResultCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies output on 复制内容 click and shows 已复制 feedback', async () => {
    const { container, unmount } = await render(
      <ToolResultCard name="read_file" ok output="hello world" />,
    );
    const btn = container.querySelector('[aria-label="复制内容"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    expect(container.textContent).toContain('已复制');
    await act(() => vi.advanceTimersByTime(1500));
    expect(container.textContent).not.toContain('已复制');
    unmount();
  });

  it('renders meta.path inside a hoverable-path when workDir provided', async () => {
    const { container, unmount } = await render(
      <ToolResultCard name="edit_file" ok output={LONG_OUTPUT} meta={EDIT_META} workDir="/w" />,
    );
    await openCard(container);
    const path = container.querySelector('.tool-card-body .hoverable-path');
    expect(path).toBeTruthy();
    expect(path!.textContent).toBe('src/foo.ts');
    unmount();
  });

  it('renders meta.path as plain text when no workDir', async () => {
    const { container, unmount } = await render(
      <ToolResultCard name="edit_file" ok output={LONG_OUTPUT} meta={EDIT_META} />,
    );
    await openCard(container);
    expect(container.querySelector('.tool-card-body .hoverable-path')).toBeNull();
    const path = container.querySelector('.tool-card-body .tool-result-path');
    expect(path?.textContent).toContain('src/foo.ts');
    unmount();
  });

  it('does not show a copy button when output is empty', async () => {
    const { container, unmount } = await render(
      <ToolResultCard name="tool" ok output="" />,
    );
    expect(container.querySelector('[aria-label="复制内容"]')).toBeNull();
    unmount();
  });

  it('shows short output directly without expand button', async () => {
    const { container, unmount } = await render(
      <ToolResultCard name="tool" ok output="ok" />,
    );
    expect(container.querySelector('.tool-card-chevron')).toBeNull();
    const body = container.querySelector('.tool-card-body');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain('ok');
    const header = container.querySelector('.tool-card-header-inner') as HTMLButtonElement;
    expect(header.disabled).toBe(true);
    unmount();
  });
});
