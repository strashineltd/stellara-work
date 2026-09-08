import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { BrowserTab } from './BrowserTab';
import type { ChatStreamEvent } from '../../shared/ipc';

const TABS = [{ id: 't1', url: 'https://ex.com', title: 'ex' }];

// ResizeObserver stub (jsdom lacks it)
class ROStub {
  static last: ROStub | null = null;
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    ROStub.last = this;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', ROStub);

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
    rerender: (ui: React.ReactElement) => {
      act(() => {
        root!.render(ui);
      });
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
        attachView: vi.fn().mockResolvedValue(undefined),
        detachView: vi.fn().mockResolvedValue(undefined),
        setViewport: vi.fn().mockResolvedValue(undefined),
        setUserInteraction: vi.fn().mockResolvedValue(undefined),
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

  it('opens http(s) and mailto links via window.open', async () => {
    (window as any).electronAPI.browser.getSnapshot = vi.fn().mockResolvedValue({ markdown: '[联系](mailto:a@b.c) [站](https://ex.com)' });
    const open = vi.fn();
    (window as any).open = open;
    const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    await act(async () => {});
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(2);
    const mailto = Array.from(anchors).find((a) => a.getAttribute('href')?.startsWith('mailto:'));
    fireClick(mailto ?? null);
    expect(open).toHaveBeenCalledWith('mailto:a@b.c', '_blank');
    unmount();
  });

  it('calls onDismiss when 收起 is clicked', async () => {
    const onDismiss = vi.fn();
    const { container } = render(<BrowserTab sessionId="s" streamId="st" onDismiss={onDismiss} />);
    await act(async () => {});
    fireClick(getByRole(container, 'button', /收起/));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('refreshes snapshot when a browser_snapshot event arrives for the same tab', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({ markdown: '# v1' });
    (window as any).electronAPI.browser.getSnapshot = getSnapshot;
    const { rerender, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    rerender(
      <BrowserTab
        sessionId="s"
        streamId="st"
        events={[{ type: 'tool_result', toolResult: { name: 'browser_snapshot', result: { ok: true, output: 'ok' } } }]}
      />,
    );
    await act(async () => {});
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('marks the service-active tab from browser.list with .active and follows it with .selected', async () => {
    const TABS2 = [
      { id: 't1', url: 'https://a.com', title: 'a' },
      { id: 't2', url: 'https://b.com', title: 'b', active: true },
    ];
    (window as any).electronAPI.browser.list = vi.fn().mockResolvedValue(TABS2);
    const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    expect(container.querySelector('.browser-tab__tab.active')?.textContent).toContain('b.com');
    expect(container.querySelector('.browser-tab__tab.selected')?.textContent).toContain('b.com');
    expect(container.querySelector('.browser-tab__tab.active')?.classList.contains('selected')).toBe(true);
    unmount();
  });

  it('marks the manually clicked tab with .selected without claiming .active', async () => {
    const TABS2 = [
      { id: 't1', url: 'https://a.com', title: 'a', active: true },
      { id: 't2', url: 'https://b.com', title: 'b' },
    ];
    (window as any).electronAPI.browser.list = vi.fn().mockResolvedValue(TABS2);
    const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    fireClick(getByRole(container, 'button', /b\.com/));
    const selectedBtn = container.querySelector('.browser-tab__tab.selected');
    expect(selectedBtn?.textContent).toContain('b.com');
    expect(selectedBtn?.classList.contains('active')).toBe(false);
    expect(container.querySelector('.browser-tab__tab.active')?.textContent).toContain('a.com');
    unmount();
  });

  it('defaults to snapshot view and does not attach', async () => {
    const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    expect(container.querySelector('.browser-tab__live')).toBeNull();
    expect((window as any).electronAPI.browser.attachView).not.toHaveBeenCalled();
    unmount();
  });

  it('switching to live view attaches and reports the container rect', async () => {
    const rect = { x: 10, y: 20, width: 300, height: 200, top: 20, left: 10, right: 310, bottom: 220, toJSON: () => ({}) };
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
    try {
      const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
      await act(async () => {});
      const liveTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '实时画面')!;
      await act(async () => {
        liveTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await act(async () => {});
      expect((window as any).electronAPI.browser.attachView).toHaveBeenCalledWith('s', 't1');
      expect((window as any).electronAPI.browser.setViewport).toHaveBeenCalled();
      // container 消失时 detach
      unmount();
      expect((window as any).electronAPI.browser.detachView).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('take-over toggles setUserInteraction and revokes on browser_* tool_call', async () => {
    const events: ChatStreamEvent[] = [
      { type: 'tool_call', toolCall: { id: 'c1', type: 'function', function: { name: 'browser_navigate', arguments: '{}' } } },
    ];
    const { container, rerender, unmount } = render(<BrowserTab sessionId="s" streamId="st" events={events} />);
    await act(async () => {});
    const liveTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '实时画面')!;
    await act(async () => {
      liveTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    const take = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('接管交互'))!;
    await act(async () => {
      take.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    expect((window as any).electronAPI.browser.setUserInteraction).toHaveBeenCalledWith('s', 't1', true);
    // 新的 browser_* tool_call 事件 → 自动收回
    rerender(
      <BrowserTab
        sessionId="s"
        streamId="st"
        events={[...events, { type: 'tool_call', toolCall: { id: 'c2', type: 'function', function: { name: 'browser_act', arguments: '{}' } } }]}
      />,
    );
    await act(async () => {});
    expect((window as any).electronAPI.browser.setUserInteraction).toHaveBeenLastCalledWith('s', 't1', false);
    unmount();
  });

  it('resets userControl state when switching tabs without an API call', async () => {
    (window as any).electronAPI.browser.list = vi.fn().mockResolvedValue([
      { id: 't1', url: 'https://a.com', title: 'a' },
      { id: 't2', url: 'https://b.com', title: 'b' },
    ]);
    const { container, unmount } = render(<BrowserTab sessionId="s" streamId="st" />);
    await act(async () => {});
    const liveTab = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '实时画面')!;
    await act(async () => {
      liveTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    const take = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('接管交互'))!;
    await act(async () => {
      take.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {});
    expect((window as any).electronAPI.browser.setUserInteraction).toHaveBeenCalledWith('s', 't1', true);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('交还 Agent'))).toBe(true);
    // 切换 Tab → 接管状态重置，按钮回到 接管交互，且不额外发 API
    (window as any).electronAPI.browser.setUserInteraction.mockClear();
    await act(async () => {
      fireClick(getByRole(container, 'button', /b\.com/));
    });
    await act(async () => {});
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('接管交互'));
    expect(btn).toBeTruthy();
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('交还 Agent'))).toBe(false);
    expect((window as any).electronAPI.browser.setUserInteraction).not.toHaveBeenCalled();
    unmount();
  });
});
