import { describe, it, expect, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { PlanCard } from './PlanCard';

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
      act(() => root!.unmount());
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
  };
}

describe('PlanCard', () => {
  it('renders numbered steps with status', () => {
    const { getByText, querySelector } = render(
      <PlanCard
        steps={[
          { description: '读 README', status: 'completed' },
          { description: '写测试', status: 'pending' },
        ]}
      />,
    );
    expect(getByText('读 README')).not.toBeNull();
    expect(getByText('写测试')).not.toBeNull();
    expect(querySelector('.plan-step-completed')).not.toBeNull();
  });

  it('shows approve/reject buttons only while awaiting approval', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const { querySelector } = render(
      <PlanCard steps={[{ description: 'a', status: 'pending' }]} awaitingApproval onApprove={onApprove} onReject={onReject} />,
    );
    expect(querySelector('.plan-actions')).not.toBeNull();
    act(() => {
      querySelector('.plan-actions button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('hides buttons when not awaiting approval', () => {
    const { querySelector } = render(<PlanCard steps={[{ description: 'a', status: 'pending' }]} />);
    expect(querySelector('.plan-actions')).toBeNull();
  });
});
