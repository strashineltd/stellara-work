import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../context/context-hub';
import { runAnthropicAgentLoop } from './anthropic-loop';
import { streamingClient } from './anthropic-stream-test-utils';
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
      client: streamingClient(mockCreate),
    })) events.push(event);

    expect(events.some((event) => event.type === 'tool_call' && event.toolCall?.id === 'toolu-1')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result' && event.toolResult?.toolCallId === 'toolu-1')).toBe(true);
    const assistantText = events
      .flatMap((event) => (event.type === 'content' && event.content ? [event.content] : []))
      .join('');
    expect(assistantText).toBe('读取完成');
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
      client: streamingClient(mockCreate),
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
      client: streamingClient(mockCreate),
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
      client: streamingClient(mockCreate),
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
      client: streamingClient(mockCreate),
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
      client: streamingClient(mockCreate),
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
      client: streamingClient(mockCreate),
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
        client: streamingClient(mockCreate),
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
        client: streamingClient(mockCreate),
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
        client: streamingClient(mockCreate),
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
        client: streamingClient(mockCreate),
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
        client: streamingClient(mockCreate),
        toolGuard,
      })) {
      }

      expect(toolGuard).toHaveBeenCalledWith('write_file', { path: 'guarded.txt', content: 'x' });
      await expect(fs.stat(path.join(workDir, 'guarded.txt'))).rejects.toThrow();
    });
  });

  it('工具输出超过上限时截断写入 hub，tool_result 事件仍返回完整结果', async () => {
    const big = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), big);
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'big.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 6 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const seen: Array<{ output?: string }> = [];
    for await (const event of runAnthropicAgentLoop('读大文件', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: streamingClient(mockCreate),
    })) {
      if (event.type === 'tool_result') seen.push((event.toolResult?.result ?? {}) as { output?: string });
    }

    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('"truncation"');
    expect(seen[0]?.output?.length).toBe(big.length);
  });

  it('达到软阈值时压缩并重建消息窗口（被丢弃前缀不进入请求）', async () => {
    const hub = new ContextHub('sub-session', workDir, 30_000, 1_000, { persist: false });
    const prefix = Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    hub.addResponseItem({ type: 'message', role: 'user', content: [{ type: 'input_text', text: `DROP-ME-PREFIX ${prefix}` }], status: 'completed' });
    for (let i = 0; i < 10; i++) {
      hub.addResponseItem({
        type: 'message',
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: [{ type: i % 2 === 0 ? 'output_text' : 'input_text', text: `KEEP-${i} ${'y'.repeat(200)}` }],
        status: 'completed',
      });
    }

    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
      content: [{ type: 'text', text: 'ok' }],
    });

    const events = [];
    for await (const event of runAnthropicAgentLoop('继续', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: streamingClient(mockCreate),
    })) events.push(event);

    expect(events.some((event) => event.type === 'summary')).toBe(true);
    const firstRequest = mockCreate.mock.calls[0]![0];
    const serialized = JSON.stringify(firstRequest.messages);
    expect(serialized).not.toContain('DROP-ME-PREFIX');
    expect(serialized).toContain('继续');
  });

  it('超过工具调用上限后进入强制审批（只读工具也会征求批准）', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'note.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-2', name: 'read_file', input: { path: 'note.txt' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-3', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const onApproval = vi.fn().mockResolvedValue(true);
    const events = [];
    for await (const event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: streamingClient(mockCreate), maxToolCalls: 1, onApproval,
    })) events.push(event);

    expect(events.some((event) => event.type === 'content' && event.content?.includes('已达到工具调用上限(1)'))).toBe(true);
    expect(onApproval).toHaveBeenCalledWith(
      expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) }),
    );
  });

  it('危险工具（write_file）在 Anthropic 路径同样需要审批', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'tool_use', id: 'toolu-1', name: 'write_file', input: { path: 'x.txt', content: 'x' } }],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: '完成' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const onApproval = vi.fn().mockResolvedValue(false);
    for await (const _event of runAnthropicAgentLoop('写文件', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: streamingClient(mockCreate), onApproval,
    })) { /* 消费事件 */ }

    expect(onApproval).toHaveBeenCalledTimes(1);
    const output = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(output && output.type === 'function_call_output' ? output.output : '').toContain('用户拒绝了此操作');
  });

  it('跨轮重建为未配对的调用补中断结果，且请求角色交替', async () => {
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    // 模拟上一轮在工具执行前中断：有 function_call 无 output
    hub.addResponseItem({ type: 'function_call', call_id: 'toolu-cancelled', name: 'read_file', arguments: '{"path":"note.txt"}', status: 'completed' });

    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
      content: [{ type: 'text', text: 'ok' }],
    });

    for await (const _event of runAnthropicAgentLoop('继续', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: streamingClient(mockCreate),
    })) { /* 消费事件 */ }

    const firstRequest = mockCreate.mock.calls[0]![0];
    const msgs = firstRequest.messages as Array<{ role: string; content: unknown }>;
    const flat = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])) as Array<{ type?: string; tool_use_id?: string }>;
    expect(flat.filter((b) => b.type === 'tool_use')).toHaveLength(1);
    const results = flat.filter((b) => b.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(results[0]!.tool_use_id).toBe('toolu-cancelled');
    // 角色必须交替（不能出现连续两条 user）
    const roles = msgs.map((m) => m.role);
    expect(roles.every((role, i) => i === 0 || role !== roles[i - 1])).toBe(true);
  });

  it('同轮并行工具在 hub 中相邻，重建后合并为单条 assistant 与单条 user 消息', async () => {
    await fs.writeFile(path.join(workDir, 'a.txt'), 'A');
    await fs.writeFile(path.join(workDir, 'b.txt'), 'B');
    mockCreate
      .mockResolvedValueOnce({
        id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [
          { type: 'tool_use', id: 'toolu-1', name: 'read_file', input: { path: 'a.txt' } },
          { type: 'tool_use', id: 'toolu-2', name: 'read_file', input: { path: 'b.txt' } },
        ],
      })
      .mockResolvedValueOnce({
        id: 'msg-2', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: '完成' }],
      })
      .mockResolvedValueOnce({
        id: 'msg-3', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: [{ type: 'text', text: 'ok' }],
      });

    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    for await (const _event of runAnthropicAgentLoop('读两个文件', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: streamingClient(mockCreate),
    })) { /* 消费事件 */ }

    const toolItemTypes = hub.getResponseItems()
      .filter((item) => item.type === 'function_call' || item.type === 'function_call_output')
      .map((item) => item.type);
    expect(toolItemTypes).toEqual(['function_call', 'function_call', 'function_call_output', 'function_call_output']);

    for await (const _event of runAnthropicAgentLoop('继续', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false, client: streamingClient(mockCreate),
    })) { /* 消费事件 */ }

    const secondRequest = mockCreate.mock.calls[2]![0];
    const msgs = secondRequest.messages as Array<{ role: string; content: unknown }>;
    const assistantIdx = msgs.findIndex((m) => m.role === 'assistant'
      && Array.isArray(m.content)
      && (m.content as Array<{ type?: string }>).some((b) => b.type === 'tool_use'));
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    const assistantBlocks = msgs[assistantIdx]!.content as Array<{ type: string; id?: string }>;
    expect(assistantBlocks.filter((b) => b.type === 'tool_use').map((b) => b.id)).toEqual(['toolu-1', 'toolu-2']);
    const next = msgs[assistantIdx + 1]!;
    expect(next.role).toBe('user');
    const resultBlocks = next.content as Array<{ type: string; tool_use_id?: string }>;
    expect(resultBlocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id)).toEqual(['toolu-1', 'toolu-2']);
    const roles = msgs.map((m) => m.role);
    expect(roles.every((role, i) => i === 0 || role !== roles[i - 1])).toBe(true);
  });

  it('allowedToolNames 过滤未授权的危险工具（task_complete 保留）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'ok' }],
    });
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    for await (const _event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: streamingClient(mockCreate), allowedToolNames: new Set(['read_file']),
    })) { /* 消费事件 */ }

    const firstRequest = mockCreate.mock.calls[0]![0] as { tools: Array<{ name: string }> };
    const names = firstRequest.tools.map((entry) => entry.name);
    expect(names).toContain('read_file');
    expect(names).toContain('task_complete');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });

  it('文本按流式增量输出（而非一次性返回）', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'msg-1', type: 'message', role: 'assistant', model: 'custom-model', stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
      content: [{ type: 'text', text: '前半后半' }],
    });
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const contents: string[] = [];
    for await (const event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client: streamingClient(mockCreate),
    })) {
      if (event.type === 'content' && event.content) contents.push(event.content);
    }
    expect(contents).toEqual(['前半', '后半']);
  });

  it('thinking 增量透传为 reasoning 事件，且不重复文本', async () => {
    const client = {
      async *createStream() {
        yield { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } } as never;
        yield { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } } as never;
        yield { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一想' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } };
        yield { type: 'content_block_stop', index: 0 };
        yield { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } };
        yield { type: 'content_block_stop', index: 1 };
        yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } };
        yield { type: 'message_stop' };
      },
    };
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const contents: string[] = [];
    const reasoning: string[] = [];
    for await (const event of runAnthropicAgentLoop('任务', {
      model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
      client,
    })) {
      if (event.type === 'content' && event.content) contents.push(event.content);
      if (event.type === 'reasoning' && event.content) reasoning.push(event.content);
    }
    expect(reasoning).toEqual(['想一想']);
    expect(contents).toEqual(['答案']);
  });

  it('流提前结束时不落盘、不当作完成', async () => {
    const client = {
      async *createStream() {
        yield { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } } as never;
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '半截' } };
        // 流在此中断：没有 content_block_stop / message_delta / message_stop
      },
    };
    const hub = new ContextHub('sub-session', workDir, 256_000, 16_384, { persist: false });
    const contents: string[] = [];
    await expect((async () => {
      for await (const event of runAnthropicAgentLoop('任务', {
        model, cwd: workDir, sessionId: 'sub-session', contextHub: hub, allowSubagents: false,
        client,
      })) {
        if (event.type === 'content' && event.content) contents.push(event.content);
      }
    })()).rejects.toThrow('提前结束');

    expect(contents).toEqual(['半截']);
    const hasAssistantMessage = hub.getResponseItems()
      .some((item) => item.type === 'message' && (item as { role?: string }).role === 'assistant');
    expect(hasAssistantMessage).toBe(false);
  });
});
