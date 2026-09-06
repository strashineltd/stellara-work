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
