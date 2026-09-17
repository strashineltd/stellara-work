/**
 * invokeTool MCP bridge tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCallTool, mockSearchMemories, mockSaveMemory, mockGetActiveUserId } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
  mockSearchMemories: vi.fn(),
  mockSaveMemory: vi.fn(),
  mockGetActiveUserId: vi.fn(() => 'u1'),
}));

vi.mock('../../mcp/mcp-manager', () => ({
  mcpManager: { callTool: mockCallTool },
}));

vi.mock('../../memory/memory-store', () => ({
  searchMemories: mockSearchMemories,
  saveMemory: mockSaveMemory,
}));

vi.mock('../../auth/local-auth-manager', () => ({
  getActiveUserId: mockGetActiveUserId,
}));

import { invokeTool, planModeTools } from './index';
import type { ToolName } from '../../../shared/ipc';

describe('invokeTool mcp bridge', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
  });

  it('routes mcp__ tool names to mcpManager.callTool', async () => {
    mockCallTool.mockResolvedValue({ ok: true, output: 'mcp ok' });
    const name = 'mcp__srv__t' as unknown as ToolName;
    const result = await invokeTool(name, { a: 1 }, '/work');
    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith('mcp__srv__t', { a: 1 });
    expect(result).toEqual({ ok: true, output: 'mcp ok' });
  });

  it('still throws for unknown non-mcp tool names', async () => {
    const name = 'nonexistent_tool' as unknown as ToolName;
    const result = await invokeTool(name, {}, '/work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未知工具');
  });
});

describe('planModeTools', () => {
  it('includes web_search exactly once', () => {
    const names = planModeTools.map((t) => t.function.name);
    expect(names.filter((n) => n === 'web_search')).toHaveLength(1);
  });
});

describe('memory tools identity injection (H10)', () => {
  beforeEach(() => {
    mockSearchMemories.mockReset().mockReturnValue([]);
    mockSaveMemory.mockReset().mockReturnValue({ content: 'c', kind: 'fact' });
    mockGetActiveUserId.mockReset().mockReturnValue('u1');
  });

  it('forwards the active identity to memory_search', async () => {
    await invokeTool('memory_search', { query: '偏好' }, '/work');
    expect(mockSearchMemories).toHaveBeenCalledWith(expect.objectContaining({ query: '偏好' }), 'u1');
  });

  it('forwards the active identity to memory_save', async () => {
    await invokeTool('memory_save', { content: '记住', kind: 'fact' }, '/work');
    expect(mockSaveMemory).toHaveBeenCalledWith(expect.objectContaining({ content: '记住', userId: 'u1' }));
  });
});
