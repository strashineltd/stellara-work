import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '../../shared/ipc';
import { createStreamCoalescer } from './stream-coalescer';

describe('createStreamCoalescer (P1a)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merges consecutive content deltas and flushes on timer', () => {
    const emit = vi.fn();
    const c = createStreamCoalescer(emit, 40, 1000);
    c.send({ type: 'content', content: 'Hel' });
    c.send({ type: 'content', content: 'lo' });
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ type: 'content', content: 'Hello' });
  });

  it('merges reasoning separately and keeps order before content', () => {
    const emit = vi.fn();
    const c = createStreamCoalescer(emit, 40, 1000);
    c.send({ type: 'reasoning', content: 'a' });
    c.send({ type: 'content', content: 'b' });
    vi.advanceTimersByTime(40);
    expect(emit.mock.calls.map((k) => k[0] as ChatStreamEvent)).toEqual([
      { type: 'reasoning', content: 'a' },
      { type: 'content', content: 'b' },
    ]);
  });

  it('flushes immediately when pending chars exceed threshold', () => {
    const emit = vi.fn();
    const c = createStreamCoalescer(emit, 40, 4);
    c.send({ type: 'content', content: 'abcd' });
    expect(emit).toHaveBeenCalledWith({ type: 'content', content: 'abcd' });
  });

  it('flushes pending deltas before a discrete event', () => {
    const emit = vi.fn();
    const c = createStreamCoalescer(emit, 40, 1000);
    c.send({ type: 'content', content: 'x' });
    c.send({ type: 'tool_call', toolCall: { id: '1', type: 'function', function: { name: 'run_command', arguments: '{}' } } });
    expect(emit.mock.calls.map((k) => (k[0] as ChatStreamEvent).type)).toEqual(['content', 'tool_call']);
  });

  it('dispose drops pending buffers', () => {
    const emit = vi.fn();
    const c = createStreamCoalescer(emit, 40, 1000);
    c.send({ type: 'content', content: 'x' });
    c.dispose();
    vi.advanceTimersByTime(40);
    expect(emit).not.toHaveBeenCalled();
  });
});
