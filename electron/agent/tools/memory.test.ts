import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSaveMemory, mockSearchMemories } = vi.hoisted(() => ({
  mockSaveMemory: vi.fn(),
  mockSearchMemories: vi.fn().mockReturnValue([]),
}));
vi.mock('../../memory/memory-store', () => ({
  searchMemories: mockSearchMemories,
  saveMemory: mockSaveMemory,
}));

import { memorySave, memorySearch } from './memory';

describe('memorySave', () => {
  beforeEach(() => {
    mockSaveMemory.mockReset();
    mockSearchMemories.mockReset().mockReturnValue([]);
  });

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

  it('显式 userId 透传给 saveMemory，缺省为默认档', async () => {
    mockSaveMemory.mockReturnValue({ id: 'x', content: 'c', kind: 'fact' });

    await memorySave({ content: '甲的记忆', kind: 'fact' }, '/tmp', 'u1');
    expect(mockSaveMemory.mock.calls[0]![0].userId).toBe('u1');

    await memorySave({ content: '默认档记忆', kind: 'fact' }, '/tmp');
    expect(mockSaveMemory.mock.calls[1]![0].userId).toBe('default');
  });
});

describe('memorySearch', () => {
  beforeEach(() => mockSearchMemories.mockReset().mockReturnValue([]));

  it('显式 userId 透传给 searchMemories，缺省为默认档', async () => {
    mockSearchMemories.mockReturnValue([
      { id: 'm1', kind: 'fact', content: '记忆', confidence: 1, importance: 0.5 },
    ]);

    await memorySearch({ query: 'q' }, '/tmp', 'u1');
    expect(mockSearchMemories.mock.calls[0]![1]).toBe('u1');

    await memorySearch({ query: 'q' }, '/tmp');
    expect(mockSearchMemories.mock.calls[1]![1]).toBe('default');
  });
});
