/**
 * Memory OS — 记忆注入器身份透传测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchSafe, mockListMemories, mockBumpAccess } = vi.hoisted(() => ({
  mockSearchSafe: vi.fn().mockReturnValue([]),
  mockListMemories: vi.fn().mockReturnValue([]),
  mockBumpAccess: vi.fn(),
}));
vi.mock('./memory-store', () => ({
  searchMemoriesSafe: mockSearchSafe,
  listMemories: mockListMemories,
  bumpAccess: mockBumpAccess,
}));

import { retrieveMemoriesForInjection } from './memory-injector';

const LONG_MESSAGE = '这是一条足够长的用户消息，用于触发基于语义的记忆检索路径';

describe('retrieveMemoriesForInjection identity scoping', () => {
  beforeEach(() => {
    mockSearchSafe.mockReset().mockReturnValue([]);
    mockListMemories.mockReset().mockReturnValue([]);
    mockBumpAccess.mockReset();
  });

  it('显式 userId → 所有检索按该身份转发', async () => {
    await retrieveMemoriesForInjection(LONG_MESSAGE, { projectId: 'p1', userId: 'u1' });

    expect(mockSearchSafe).toHaveBeenCalled();
    expect(mockListMemories).toHaveBeenCalled();
    for (const call of mockSearchSafe.mock.calls) expect(call[1]).toBe('u1');
    for (const call of mockListMemories.mock.calls) expect(call[1]).toBe('u1');
  });

  it('未传 userId → 默认档', async () => {
    await retrieveMemoriesForInjection(LONG_MESSAGE, { projectId: 'p1' });

    expect(mockSearchSafe).toHaveBeenCalled();
    expect(mockListMemories).toHaveBeenCalled();
    for (const call of mockSearchSafe.mock.calls) expect(call[1]).toBe('default');
    for (const call of mockListMemories.mock.calls) expect(call[1]).toBe('default');
  });
});
