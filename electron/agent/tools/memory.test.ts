import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSaveMemory } = vi.hoisted(() => ({ mockSaveMemory: vi.fn() }));
vi.mock('../../memory/memory-store', () => ({
  searchMemories: vi.fn().mockReturnValue([]),
  saveMemory: mockSaveMemory,
}));

import { memorySave } from './memory';

describe('memorySave', () => {
  beforeEach(() => mockSaveMemory.mockReset());

  it('saves with explicit importance', async () => {
    mockSaveMemory.mockReturnValue({ id: 'x', content: 'c', kind: 'fact' });
    const r = await memorySave({ content: '重要偏好', kind: 'preference', importance: 0.95 }, '/tmp');
    expect(r.ok).toBe(true);
    expect(mockSaveMemory.mock.calls[0]![0].importance).toBe(0.95);
  });

  it('defaults importance to 0.7', async () => {
    mockSaveMemory.mockReturnValue({ id: 'x', content: 'c', kind: 'fact' });
    await memorySave({ content: '普通记忆', kind: 'fact' }, '/tmp');
    expect(mockSaveMemory.mock.calls[0]![0].importance).toBe(0.7);
  });

  it('rejects importance out of range', async () => {
    const r = await memorySave({ content: 'x', kind: 'fact', importance: 1.5 }, '/tmp');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('importance');
  });
});
