import { describe, expect, it, vi } from 'vitest';
import { ChatStreamRegistry } from './stream-registry';

describe('ChatStreamRegistry', () => {
  it('keeps approvals isolated by stream', async () => {
    const registry = new ChatStreamRegistry();
    registry.start('a');
    registry.start('b');
    const a = registry.requestApproval('a', 'approval-a', 10_000);
    const b = registry.requestApproval('b', 'approval-b', 10_000);

    registry.cleanup('a');
    await expect(a).resolves.toBe(false);
    expect(registry.respond('approval-b', true)).toBe(true);
    await expect(b).resolves.toBe(true);
  });

  it('aborting a stream resolves only its pending approvals', async () => {
    const registry = new ChatStreamRegistry();
    registry.start('a');
    registry.start('b');
    const a = registry.requestApproval('a', 'approval-a', 10_000);
    const b = registry.requestApproval('b', 'approval-b', 10_000);

    expect(registry.abort('a')).toBe(true);
    await expect(a).resolves.toBe(false);
    expect(registry.getSignal('a')?.aborted).toBe(true);
    expect(registry.respond('approval-b', true)).toBe(true);
    await expect(b).resolves.toBe(true);
  });

  it('auto-rejects timed out approvals', async () => {
    vi.useFakeTimers();
    const registry = new ChatStreamRegistry();
    registry.start('a');
    const pending = registry.requestApproval('a', 'approval-a', 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });
});
