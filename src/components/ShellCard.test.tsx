import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { ShellCard } from './ShellCard';

const LONG_STDOUT = Array.from({ length: 12 }, () => 'A'.repeat(50)).join('\n');

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
    getByText: (text: string | RegExp) => {
      const pattern = typeof text === 'string' ? text : text;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (
          node.textContent &&
          (typeof pattern === 'string'
            ? node.textContent.includes(pattern)
            : pattern.test(node.textContent))
        ) {
          return node.parentElement;
        }
      }
      return null;
    },
    querySelector: <T extends Element = Element>(sel: string): T | null =>
      container.querySelector(sel) as T | null,
  };
}

function click(el: HTMLElement | null) {
  expect(el).not.toBeNull();
  act(() => {
    el!.click();
  });
}

describe('ShellCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('头部显示时长与退出码徽章：exitCode 0 为 success 绿、非 0 为 danger 红', () => {
    const a = render(
      <ShellCard command="npm test" stdout="" stderr="" exitCode={0} durationMs={3200} ok />
    );
    expect(a.getByText('3.2s')).not.toBeNull();
    const badge0 = a.querySelector<HTMLElement>('.shell-exit--success');
    expect(badge0).not.toBeNull();
    expect(badge0?.textContent).toBe('exit 0');
    a.unmount();

    const b = render(
      <ShellCard command="npm test" stdout="" stderr="" exitCode={1} durationMs={3200} ok={false} />
    );
    const badge1 = b.querySelector<HTMLElement>('.shell-exit--danger');
    expect(badge1).not.toBeNull();
    expect(badge1?.textContent).toBe('exit 1');
    b.unmount();
  });

  it('行号开关：默认关，点击"行号"出现 1: 前缀，再点关闭；stderr 不编号', () => {
    const { container, querySelector, unmount } = render(
      <ShellCard
        command="npm test"
        stdout={LONG_STDOUT}
        stderr={'B'.repeat(60)}
        exitCode={0}
        durationMs={3200}
        ok
      />
    );
    click(querySelector<HTMLButtonElement>('.tool-card-header-inner'));
    const stdoutPre = querySelector<HTMLPreElement>('.shell-stdout');
    expect(stdoutPre).not.toBeNull();
    expect(stdoutPre?.textContent?.startsWith('A')).toBe(true);
    expect(querySelector('.shell-linenos')).toBeNull();
    expect(container.textContent).not.toContain('1: ');

    click(querySelector<HTMLButtonElement>('.shell-lineno-btn'));
    const numbered = querySelector<HTMLPreElement>('.shell-stdout');
    expect(numbered?.textContent?.startsWith('1: ')).toBe(true);
    const stderrPre = querySelector<HTMLPreElement>('.shell-stderr');
    expect(stderrPre?.textContent?.startsWith('B')).toBe(true);

    click(querySelector<HTMLButtonElement>('.shell-lineno-btn'));
    const unnumbered = querySelector<HTMLPreElement>('.shell-stdout');
    expect(unnumbered?.textContent?.startsWith('A')).toBe(true);
    unmount();
  });

  it('exitCode/durationMs 缺失时不渲染时长与退出码徽章', () => {
    const { container, unmount } = render(
      <ShellCard command="npm test" stdout="out" stderr="" ok />
    );
    const headerInner = container.querySelector('.tool-card-header-inner');
    expect(container.querySelector('.shell-exit')).toBeNull();
    expect(container.querySelector('.shell-duration')).toBeNull();
    expect(headerInner?.textContent).not.toContain('exit');
    expect(headerInner?.textContent).not.toMatch(/ms/);
    unmount();
  });
});
