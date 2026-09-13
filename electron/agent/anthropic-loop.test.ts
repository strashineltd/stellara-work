import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../context/context-hub';
import { runAnthropicAgentLoop } from './anthropic-loop';
import type { ModelConfig } from '../../shared/ipc';

const mockCreate = vi.fn();

// 模拟 mcpManager：仅需 requiresApproval（MCP 工具审批策略查询）
const { mockRequiresApproval, mockRetrieveMemories } = vi.hoisted(() => ({
  mockRequiresApproval: vi.fn().mockResolvedValue(false),
  mockRetrieveMemories: vi.fn().mockResolvedValue({ memories: [], promptBlock: null }),
}));

vi.mock('../mcp/mcp-manager', () => ({
  mcpManager: { requiresApproval: mockRequiresApproval },
}));

vi.mock('../memory/memory-injector', () => ({
  retrieveMemoriesForInjection: mockRetrieveMemories,
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
  mockRetrieveMemories.mockClear();
  mockRetrieveMemories.mockResolvedValue({ memories: [], promptBlock: null });
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

  it('browser_act is gated as a dangerous tool (loop approval)', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'browser_act', input: { action: 'click' } }],
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

    expect(mockRequiresApproval).not.toHaveBeenCalled();
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'browser_act' }) }),
    );
    // 拒绝 → tool_result 内容是拒绝文案
    const secondRequest = mockCreate.mock.calls[1]![0];
    const resultMessage = secondRequest.messages.find((message: { role: string; content: unknown }) =>
      message.role === 'user' && Array.isArray(message.content)
        && message.content.some((block: { type?: string }) => block.type === 'tool_result'));
    expect(resultMessage.content[0].content).toContain('用户拒绝了此操作');
  });

  it('记忆注入携带会话所属项目 id', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 4 },
      content: [{ type: 'text', text: '完成' }],
    });

    const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
    for await (const _ev of runAnthropicAgentLoop('测试任务', {
      model,
      cwd: workDir,
      sessionId: 'sub-session',
      contextHub: hub,
      allowSubagents: false,
      client: { create: mockCreate },
      memoryProjectId: 'proj-1',
    })) {
      // 消费事件
    }
    expect(mockRetrieveMemories).toHaveBeenCalledWith('测试任务', {
      maxMemories: 10,
      projectId: 'proj-1',
    });
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

  describe('敏感工具审批分类', () => {
    function toolUseResponse(name: string) {
      return {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'custom-model',
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu-1', name, input: { tabId: 't1' } }],
      };
    }

    async function runAndCollectApprovals(
      name: string,
      opts: { planMode?: boolean } = {},
    ): Promise<ReturnType<typeof vi.fn>> {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse(name))
        .mockResolvedValueOnce({
          id: 'msg-2',
          type: 'message',
          role: 'assistant',
          model: 'custom-model',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 6 },
          content: [{ type: 'text', text: '1. 步骤一\n2. 完成' }],
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
        ...(opts.planMode ? { planMode: true } : {}),
      })) {
        // 消费事件
      }
      return onApproval;
    }

    it.each(['browser_screenshot', 'memory_save'])(
      '%s 未批准时先征求用户批准，拒绝后不执行',
      async (name) => {
        const onApproval = await runAndCollectApprovals(name);

        expect(mockRequiresApproval).not.toHaveBeenCalled();
        expect(onApproval).toHaveBeenCalledTimes(1);
        expect(onApproval).toHaveBeenCalledWith(
          expect.objectContaining({ function: expect.objectContaining({ name }) }),
        );
      },
    );

    it.each(['browser_snapshot', 'browser_extract'])(
      'plan 模式下 %s 也需要审批（不再静默放行）',
      async (name) => {
        const onApproval = await runAndCollectApprovals(name, { planMode: true });

        expect(onApproval).toHaveBeenCalledTimes(1);
        expect(onApproval).toHaveBeenCalledWith(
          expect.objectContaining({ function: expect.objectContaining({ name }) }),
        );
      },
    );
  });

  describe('审批回调缺失时危险工具 fail-closed', () => {
    const APPROVAL_UNAVAILABLE = '此操作需要用户批准，但当前上下文不支持审批（已拒绝）';

    function toolUseResponse(name: string, input: Record<string, unknown>) {
      return {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'custom-model',
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu-1', name, input }],
      };
    }

    function endTurnResponse() {
      return {
        id: 'msg-2',
        type: 'message',
        role: 'assistant',
        model: 'custom-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 6 },
        content: [{ type: 'text', text: '完成' }],
      };
    }

    function lastToolResult(): string {
      const secondRequest = mockCreate.mock.calls[1]![0];
      const resultMessage = secondRequest.messages.find((message: { role: string; content: unknown }) =>
        message.role === 'user' && Array.isArray(message.content)
          && message.content.some((block: { type?: string }) => block.type === 'tool_result'));
      return JSON.stringify(resultMessage.content);
    }

    it('危险工具 + 无审批回调 → 不执行并返回审批不可用错误', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('write_file', { path: 'blocked.txt', content: 'x' }))
        .mockResolvedValueOnce(endTurnResponse());

      const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
      for await (const _event of runAnthropicAgentLoop('任务', {
        model,
        cwd: workDir,
        sessionId: 'sub-session',
        contextHub: hub,
        allowSubagents: false,
        client: { create: mockCreate },
      })) {
      }

      await expect(fs.stat(path.join(workDir, 'blocked.txt'))).rejects.toThrow();
      expect(lastToolResult()).toContain(APPROVAL_UNAVAILABLE);
    });

    it('危险工具 + 审批回调批准 → 正常执行', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('write_file', { path: 'approved.txt', content: 'ok' }))
        .mockResolvedValueOnce(endTurnResponse());

      const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
      const onApproval = vi.fn().mockResolvedValue(true);
      for await (const _event of runAnthropicAgentLoop('任务', {
        model,
        cwd: workDir,
        sessionId: 'sub-session',
        contextHub: hub,
        allowSubagents: false,
        client: { create: mockCreate },
        onApproval,
      })) {
      }

      expect(onApproval).toHaveBeenCalledTimes(1);
      await expect(fs.readFile(path.join(workDir, 'approved.txt'), 'utf8')).resolves.toBe('ok');
    });

    it('非危险工具 + 无审批回调 → 正常执行', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('read_file', { path: 'note.txt' }))
        .mockResolvedValueOnce(endTurnResponse());

      const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
      const names: string[] = [];
      for await (const event of runAnthropicAgentLoop('任务', {
        model,
        cwd: workDir,
        sessionId: 'sub-session',
        contextHub: hub,
        allowSubagents: false,
        client: { create: mockCreate },
      })) {
        if (event.type === 'tool_result' && event.toolResult) names.push(event.toolResult.name);
      }

      expect(names).toContain('read_file');
    });

    it('toolGuard 拒绝时不执行工具', async () => {
      mockCreate
        .mockResolvedValueOnce(toolUseResponse('write_file', { path: 'guarded.txt', content: 'x' }))
        .mockResolvedValueOnce(endTurnResponse());

      const hub = new ContextHub('sub-session', workDir, 256000, 16384, { persist: false });
      const toolGuard = vi.fn().mockReturnValue('超出 fileScopes（测试）');
      for await (const _event of runAnthropicAgentLoop('任务', {
        model,
        cwd: workDir,
        sessionId: 'sub-session',
        contextHub: hub,
        allowSubagents: false,
        client: { create: mockCreate },
        toolGuard,
      })) {
      }

      expect(toolGuard).toHaveBeenCalledWith('write_file', { path: 'guarded.txt', content: 'x' });
      await expect(fs.stat(path.join(workDir, 'guarded.txt'))).rejects.toThrow();
    });
  });
});
