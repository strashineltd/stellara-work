import { describe, it, expect, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { ErrorBanner } from './ErrorBanner';

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
        if (node.textContent && (typeof pattern === 'string' ? node.textContent.includes(pattern) : pattern.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
  };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ErrorBanner', () => {
  it('renders the plain message and detail without meta', () => {
    const { getByText, querySelector } = render(<ErrorBanner message="boom" />);
    expect(getByText('boom')).toBeTruthy();
    expect(querySelector('.error-banner-detail')?.textContent).toContain('boom');
  });

  it('renders the friendly title for categorized errors', () => {
    const { getByText } = render(<ErrorBanner message="raw" meta={{ kind: 'rate_limit', hint: '稍后重试', action: 'retry', retryable: true }} />);
    expect(getByText('请求被限流（429）')).toBeTruthy();
  });

  it('announces the banner root with role=alert', () => {
    const { querySelector } = render(<ErrorBanner message="boom" />);
    expect(querySelector('.error-banner')?.getAttribute('role')).toBe('alert');
  });

  it('marks the newly mounted banner with the one-shot status-enter class', () => {
    const { querySelector } = render(<ErrorBanner message="boom" />);
    expect(querySelector('.error-banner')?.classList.contains('motion-feedback-enter')).toBe(true);
  });

  it('fires onRetry from the retry button', () => {
    const onRetry = vi.fn();
    const { querySelector } = render(<ErrorBanner message="boom" onRetry={onRetry} />);
    fireClick(querySelector('.btn-retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows the open-settings action for open_settings meta', () => {
    const onOpenSettings = vi.fn();
    const { querySelector } = render(
      <ErrorBanner message="boom" meta={{ kind: 'auth', hint: '重新配置密钥', action: 'open_settings', retryable: false }} onOpenSettings={onOpenSettings} />,
    );
    fireClick(querySelector('.error-banner-actions .btn'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});