/**
 * invokeTool MCP bridge tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockCallTool } = vi.hoisted(() => ({
  mockCallTool: vi.fn(),
}));

vi.mock('../../mcp/mcp-manager', () => ({
  mcpManager: { callTool: mockCallTool },
}));

import { invokeTool } from './index';
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
    await expect(invokeTool(name, {}, '/work')).rejects.toThrow('未知 tool');
    expect(mockCallTool).not.toHaveBeenCalled();
  });
});
