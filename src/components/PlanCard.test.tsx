import { describe, it, expect, vi } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useState } from 'react';
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
        running={false}
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
      <PlanCard steps={[{ description: 'a', status: 'pending' }]} running={false} awaitingApproval onApprove={onApprove} onReject={onReject} />,
    );
    expect(querySelector('.plan-actions')).not.toBeNull();
    act(() => {
      querySelector('.plan-actions button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('hides buttons when not awaiting approval', () => {
    const { querySelector } = render(<PlanCard steps={[{ description: 'a', status: 'pending' }]} running={false} />);
    expect(querySelector('.plan-actions')).toBeNull();
  });

  it('activates the step spinner loop only while running', () => {
    const { querySelector, getByText } = render(
      <PlanCard steps={[{ description: '写测试', status: 'in_progress' }]} running />,
    );
    expect(querySelector('.plan-step-spinner.is-active')).not.toBeNull();
    expect(getByText('进行中')).not.toBeNull();
  });

  it('keeps the status visible without the active loop class when idle', () => {
    const { querySelector, getByText } = render(
      <PlanCard steps={[{ description: '写测试', status: 'in_progress' }]} running={false} />,
    );
    expect(querySelector('.plan-step-spinner.is-active')).toBeNull();
    expect(querySelector('.plan-step-spinner')).not.toBeNull();
    expect(getByText('进行中')).not.toBeNull();
  });

  it('gives the pending approval action group alertdialog semantics with one-shot entry motion', () => {
    const { querySelector } = render(
      <PlanCard steps={[{ description: 'a', status: 'pending' }]} running={false} awaitingApproval onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    const actions = querySelector('.plan-actions');
    expect(actions?.getAttribute('role')).toBe('alertdialog');
    expect(actions?.classList.contains('motion-feedback-enter')).toBe(true);
  });

  it('approves, fires the callback and removes the action group immediately in the same act', () => {
    const onApprove = vi.fn();
    function Harness() {
      const [awaiting, setAwaiting] = useState(true);
      return (
        <PlanCard
          steps={[{ description: 'a', status: 'pending' }]}
          running={false}
          awaitingApproval={awaiting}
          onApprove={() => {
            onApprove();
            setAwaiting(false);
          }}
          onReject={vi.fn()}
        />
      );
    }
    const { container, querySelector } = render(<Harness />);
    expect(querySelector('.plan-actions')).not.toBeNull();
    act(() => {
      const approveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '批准执行');
      approveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onApprove).toHaveBeenCalledOnce();
    expect(querySelector('.plan-actions')).toBeNull();
  });

  it('rejects, fires the callback and removes the action group immediately in the same act', () => {
    const onReject = vi.fn();
    function Harness() {
      const [awaiting, setAwaiting] = useState(true);
      return (
        <PlanCard
          steps={[{ description: 'a', status: 'pending' }]}
          running={false}
          awaitingApproval={awaiting}
          onApprove={vi.fn()}
          onReject={() => {
            onReject();
            setAwaiting(false);
          }}
        />
      );
    }
    const { container, querySelector } = render(<Harness />);
    expect(querySelector('.plan-actions')).not.toBeNull();
    act(() => {
      const rejectBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '拒绝');
      rejectBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReject).toHaveBeenCalledOnce();
    expect(querySelector('.plan-actions')).toBeNull();
  });
});
