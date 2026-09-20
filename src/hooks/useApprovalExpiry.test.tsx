import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, useEffect, useState } from 'react';
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
    container,
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

  it('父组件持续重渲染/更换回调引用时仍按时清理且恰好一次', () => {
    const calls: number[] = [];
    const deadline = Date.now() + 1_000;
    function Harness() {
      const [, setTick] = useState(0);
      useEffect(() => {
        const timer = setInterval(() => setTick((value) => value + 1), 200);
        return () => clearInterval(timer);
      }, []);
      return <Probe expiresAt={deadline} onExpired={() => calls.push(1)} />;
    }
    const view = render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(calls).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(calls).toHaveLength(1);
    view.unmount();
  });

  it('截止点不落在 500ms tick 上时也能准时失效', () => {
    const view = render(<Probe expiresAt={Date.now() + 1_100} />);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(view.text()).toBe('0|expired');
    view.unmount();
  });

  it('expiresAt 切到已过期的值时立即失效（刷新时钟）', () => {
    function Harness() {
      const [deadline, setDeadline] = useState<number | undefined>(undefined);
      return (
        <div>
          <button onClick={() => setDeadline(Date.now() - 5_000)} type="button">go</button>
          <Probe expiresAt={deadline} />
        </div>
      );
    }
    const view = render(<Harness />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => {
      view.container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.text()).toContain('expired');
    view.unmount();
  });
});
