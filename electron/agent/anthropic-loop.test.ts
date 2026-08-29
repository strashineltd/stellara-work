import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../context/context-hub';
import { runAnthropicAgentLoop } from './anthropic-loop';
import type { ModelConfig } from '../../shared/ipc';

const mockCreate = vi.fn();

// 模拟 mcpManager：仅需 requiresApproval（MCP 工具审批策略查询）
const { mockRequiresApproval } = vi.hoisted(() => ({
  mockRequiresApproval: vi.fn().mockResolvedValue(false),
}));

vi.mock('../mcp/mcp-manager', () => ({
  mcpManager: { requiresApproval: mockRequiresApproval },
}));

const model: ModelConfig = {
  id: 'anthropic-custom',
  label: 'Anthropic Custom',
  baseUrl: 'https://example.com',
  model: 'custom-model',
  apiKey: 'secret',
  wireApi: 'anthropic',
  isCustom: true,
};

let workDir = '';

beforeEach(async () => {
  mockCreate.mockReset();
  mockRequiresApproval.mockReset();
  mockRequiresApproval.mockResolvedValue(false);
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-anthropic-loop-'));
  await fs.writeFile(path.join(workDir, 'note.txt'), 'hello anthropic');
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('runAnthropicAgentLoop', () => {
  it('executes Anthropic tool_use blocks with their id and returns tool_result history', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'note.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 6 },
        content: [{ type: 'text', text: '读取完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
    const events = [];
    for await (const event of runAnthropicAgentLoop('读取 note.txt', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: hub,
      allowSubagents: false,
      client: { create: mockCreate },
    })) events.push(event);

    expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.id === 'toolu-1')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result' && event.toolResult?.toolCallId === 'toolu-1')).toBe(true);
    expect(events.some((event) => event.type === 'content' && event.content === '读取完成')).toBe(true);
    const secondRequest = mockCreate.mock.calls[1]![0];
    const resultMessage = secondRequest.messages.find((message: { role: string; content: unknown }) =>
      message.role === 'user' && Array.isArray(message.content)
        && message.content.some((block: { type?: string }) => block.type === 'tool_result'));
    expect(resultMessage.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu-1' });
    expect(secondRequest.tools.some((tool: { name: string }) => tool.name === 'dispatch_subagents')).toBe(false);
  });

  it('MCP 工具按审批策略征求用户批准，拒绝后不执行', async () => {
    mockRequiresApproval.mockResolvedValue(true);
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'mcp__s1__write', input: {} }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 6 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
    const onApproval = vi.fn().mockResolvedValue(false);
    for await (const _event of runAnthropicAgentLoop('任务', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: hub,
      allowSubagents: false,
      client: { create: mockCreate },
      onApproval,
    })) {
      // 消费事件
    }

    expect(mockRequiresApproval).toHaveBeenCalledWith('mcp__s1__write');
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'mcp__s1__write' }) }),
    );
    // 拒绝 → tool_result 内容是拒绝文案，而非工具真实输出
    const secondRequest = mockCreate.mock.calls[1]![0];
    const resultMessage = secondRequest.messages.find((message: { role: string; content: unknown }) =>
      message.role === 'user' && Array.isArray(message.content)
        && message.content.some((block: { type?: string }) => block.type === 'tool_result'));
    expect(resultMessage.content[0].content).toContain('用户拒绝了此操作');
  });

  it('plan 模式下把 planExtraTools 注入请求工具列表', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 4 },
      content: [{ type: 'text', text: '1. 读取文件\n2. 完成' }],
    });

    const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
    for await (const _event of runAnthropicAgentLoop('制定计划', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: hub,
      allowSubagents: false,
      client: { create: mockCreate },
      planMode: true,
      planExtraTools: [
        { type: 'function', function: { name: 'mcp__s1__read', description: 'read', parameters: { type: 'object' } } },
      ],
    })) {
      // 消费事件
    }

    const request = mockCreate.mock.calls[0]![0];
    expect(request.tools.some((tool: { name: string }) => tool.name === 'mcp__s1__read')).toBe(true);
  });

  it('连续三次 max_tokens 截断后停止并引导调大输出上限', async () => {
    const truncated = {
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'max_tokens',
      usage: { input_tokens: 12, output_tokens: 4096 },
      content: [{ type: 'text', text: '部分内容' }],
    };
    mockCreate.mockResolvedValue(truncated);

    const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
    const events: string[] = [];
    for await (const ev of runAnthropicAgentLoop('任务', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: hub,
      allowSubagents: false,
      client: { create: mockCreate },
    })) {
      if (ev.type === 'error' && ev.error) events.push(ev.error);
    }

    expect(events.some((e) => e.includes('连续多次输出被截断'))).toBe(true);
    // 截断提示也出现过
    const contents: string[] = [];
    const gen2 = runAnthropicAgentLoop('任务', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: new ContextHub('sub-session-2', workDir, 256000, 16384, { persist: false }),
      allowSubagents: false,
      client: { create: mockCreate },
    });
    for await (const ev of gen2) {
      if (ev.type === 'content' && ev.content) contents.push(ev.content);
    }
    expect(contents.some((c) => c.includes('[输出截断'))).toBe(true);
  });
});
