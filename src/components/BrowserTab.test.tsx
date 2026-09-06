import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { BrowserTab } from './BrowserTab';

const TABS = [{ id: 't1', url: 'https://ex.com', title: 'ex' }];

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
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof text === 'string' ? node.textContent.includes(text) : text.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

function getByRole(container: HTMLElement, role: string, name?: string | RegExp): Element | null {
  let candidates: NodeListOf<Element> | Element[] = container.querySelectorAll(`[role="${role}"]`);
  if (candidates.length === 0 && role === 'button') {
    candidates = container.querySelectorAll('button');
  }
  if (!name) return candidates[0] ?? null;
  for (const el of candidates) {
    const text = el.textContent ?? '';
    if (typeof name === 'string' ? text.includes(name) : name.test(text)) {
      return el;
    }
  }
  return null;
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('BrowserTab', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    (window as any).electronAPI = {
      browser: {
        list: vi.fn().mockResolvedValue(TABS),
        getSnapshot: vi.fn().mockResolvedValue({ markdown: '' }),
      },
      chat: {
        abort: vi.fn(),
      },
    };
  });

  it('shows the domain badge and an interrupt button', async () => {
    const { container, getByText } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    expect(getByText('ex.com')).toBeTruthy();
    expect(getByRole(container, 'button', /中断/)).toBeTruthy();
  });

  it('calls chat.abort(streamId) when 中断 is clicked', async () => {
    const { container } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    fireClick(getByRole(container, 'button', /中断/));
    expect((window as any).electronAPI.chat.abort).toHaveBeenCalledWith('st');
  });

  it('renders snapshot markdown via MarkdownView', async () => {
    (window as any).electronAPI.browser.getSnapshot = vi.fn().mockResolvedValue({ markdown: '# hello-snap' });
    const { getByText } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    await act(async () => {});
    expect(getByText('hello-snap')).toBeTruthy();
  });

  it('renders screenshot img from browser_screenshot tool_result dataUrl', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    const { querySelector } = render(
      <BrowserTab
        sessionId="s"
        streamId="st"
        events={[
          { type: 'tool_result', toolResult: { name: 'browser_screenshot', result: { ok: true, output: `screenshot captured: ${dataUrl}` } } },
        ]}
      />,
    );
    await act(async () => {});
    const img = querySelector('.browser-tab__screenshot') as HTMLImageElement | null;
    expect(img?.tagName.toLowerCase()).toBe('img');
    expect(img?.getAttribute('src')).toBe(dataUrl);
  });
});
