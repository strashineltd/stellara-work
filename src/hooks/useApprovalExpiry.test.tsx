import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useApprovalExpiry } from './useApprovalExpiry';

function Probe({ expiresAt, onExpired }: { expiresAt?: number; onExpired?: () => void }) {
  const { secondsLeft, expired } = useApprovalExpiry(expiresAt, onExpired);
  return <div>{`${secondsLeft ?? 'null'}|${expired ? 'expired' : 'active'}`}</div>;
}

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    text: () => container.textContent,
    unmount: () => {
      act(() => {
        root!.unmount();
      });
      document.body.removeChild(container);
    },
  };
}

describe('useApprovalExpiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('无 expiresAt：无倒计时且不失效', () => {
    const view = render(<Probe />);
    expect(view.text()).toBe('null|active');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.text()).toBe('null|active');
  });

  it('显示剩余秒数并随时间递减', () => {
    const view = render(<Probe expiresAt={Date.now() + 5_000} />);
    expect(view.text()).toBe('5|active');
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    expect(view.text()).toBe('3|active');
    view.unmount();
  });

  it('到点后进入 expired', () => {
    const view = render(<Probe expiresAt={Date.now() + 1_000} />);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(view.text()).toBe('0|expired');
    view.unmount();
  });

  it('expired 后延迟调用 onExpired（仅一次）', () => {
    const onExpired = vi.fn();
    const view = render(<Probe expiresAt={Date.now() + 1_000} onExpired={onExpired} />);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(onExpired).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(onExpired).toHaveBeenCalledOnce();
    view.unmount();
  });
});
