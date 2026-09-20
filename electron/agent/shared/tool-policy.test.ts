import { describe, expect, it, vi } from 'vitest';
import { DANGEROUS_TOOLS, PLAN_MODE_SENSITIVE_TOOLS, filterToolsByPolicy, needsApproval } from './tool-policy';
import type { OpenAITool } from '../../../shared/ipc';

function tool(name: string): OpenAITool {
  return { type: 'function', function: { name, description: '', parameters: {} } };
}

describe('needsApproval', () => {
  it('危险工具始终需要审批', async () => {
    for (const toolName of ['write_file', 'edit_file', 'run_command', 'web_fetch', 'dispatch_subagents', 'browser_act', 'browser_exec_js', 'browser_screenshot', 'memory_save']) {
      expect(DANGEROUS_TOOLS.has(toolName)).toBe(true);
      expect(await needsApproval({ toolName, planMode: false, forceApproval: false })).toBe(true);
    }
  });

  it('只读工具默认不需要审批', async () => {
    expect(await needsApproval({ toolName: 'read_file', planMode: false, forceApproval: false })).toBe(false);
  });

  it('强制审批模式让所有工具都需要审批', async () => {
    expect(await needsApproval({ toolName: 'read_file', planMode: false, forceApproval: true })).toBe(true);
  });

  it('plan 模式敏感工具需要审批，普通只读不需要', async () => {
    expect(PLAN_MODE_SENSITIVE_TOOLS.has('browser_snapshot')).toBe(true);
    expect(await needsApproval({ toolName: 'browser_snapshot', planMode: true, forceApproval: false })).toBe(true);
    expect(await needsApproval({ toolName: 'read_file', planMode: true, forceApproval: false })).toBe(false);
  });

  it('MCP 工具走注入的审批查询', async () => {
    const query = vi.fn().mockResolvedValue(true);
    expect(await needsApproval({ toolName: 'mcp__s1__read', planMode: false, forceApproval: false, mcpRequiresApproval: query })).toBe(true);
    expect(query).toHaveBeenCalledWith('mcp__s1__read');
  });

  it('MCP 工具缺少审批回调时 fail-closed', async () => {
    expect(await needsApproval({ toolName: 'mcp__s1__read', planMode: false, forceApproval: false })).toBe(true);
  });
});

describe('filterToolsByPolicy', () => {
  it('未提供集合时原样返回', () => {
    const tools = [tool('write_file'), tool('read_file')];
    expect(filterToolsByPolicy(tools)).toBe(tools);
  });

  it('过滤未授权的危险工具并保留 task_complete 与只读工具', () => {
    const tools = [tool('write_file'), tool('read_file'), tool('run_command'), tool('task_complete'), tool('edit_file')];
    expect(filterToolsByPolicy(tools, new Set(['edit_file'])).map((t) => t.function.name).sort())
      .toEqual(['edit_file', 'read_file', 'task_complete']);
  });
});
