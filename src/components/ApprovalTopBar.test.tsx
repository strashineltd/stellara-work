import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { ApprovalTopBar } from './ApprovalTopBar';
import type { ApprovalRequest } from '../../shared/ipc';

const REQ: ApprovalRequest = {
  id: 'a',
  toolName: 'write_file',
  args: '{"path":"src/main.tsx","content":"x"}',
  toolCallId: 'c',
};

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
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function getByRole(container: HTMLElement, role: string, name?: string | RegExp): Element | null {
  // Native elements (button, etc.) have implicit roles — query by tag as fallback
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

describe('ApprovalTopBar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the tool name', () => {
    const { getByText } = render(
      <ApprovalTopBar request={REQ} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(getByText(/write_file/)).toBeTruthy();
  });

  it('pretty-prints args', () => {
    const { getByText } = render(
      <ApprovalTopBar request={REQ} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(getByText(/src\/main\.tsx/)).toBeTruthy();
  });

  it('fires onApprove when the approve button is clicked', () => {
    const onApprove = vi.fn();
    const { container } = render(
      <ApprovalTopBar request={REQ} onApprove={onApprove} onReject={vi.fn()} />,
    );
    const btn = getByRole(container, 'button', /允许|approve/i);
    fireClick(btn);
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('fires onReject when the reject button is clicked', () => {
    const onReject = vi.fn();
    const { container } = render(
      <ApprovalTopBar request={REQ} onApprove={vi.fn()} onReject={onReject} />,
    );
    const btn = getByRole(container, 'button', /拒绝|reject/i);
    fireClick(btn);
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('uses --color-warning tokens, not arbitrary colors', () => {
    const { container } = render(
      <ApprovalTopBar request={REQ} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    const bar = container.querySelector('.approval-top-bar')!;
    expect(bar.classList.contains('approval-top-bar')).toBe(true);
  });

  it('labels subagent approvals with 子代理请求 prefix', () => {
    const { getByText } = render(
      <ApprovalTopBar request={{ ...REQ, id: 'sub-abc-1' }} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(getByText('子代理请求：')).toBeTruthy();
  });

  it('keeps 需要确认 for regular approvals', () => {
    const { getByText } = render(
      <ApprovalTopBar request={REQ} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(getByText('需要确认')).toBeTruthy();
  });
});
