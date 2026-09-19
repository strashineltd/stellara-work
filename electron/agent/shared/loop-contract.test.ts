/**
 * 双协议契约测试：同一场景分别驱动 Responses / Anthropic 两条 loop，
 * 断言共享行为（输出截断 / 超限审批 / 危险工具审批）表现一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../../context/context-hub';
import { runResponsesLoop } from '../responses-loop';
import { runAnthropicAgentLoop } from '../anthropic-loop';
import type { ChatStreamEvent, ModelConfig, ToolCall } from '../../../shared/ipc';

const { mockCreateStream, mockAnthropicCreate, mockRetrieveMemories, mockRequiresApproval } = vi.hoisted(() => ({
  mockCreateStream: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockRetrieveMemories: vi.fn().mockResolvedValue({ memories: [], promptBlock: null }),
  mockRequiresApproval: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../llm/responses', () => ({
  ResponsesClient: class {
    async *createStream(): AsyncGenerator<Record<string, unknown>> {
      const events = (await mockCreateStream()) as Record<string, unknown>[];
      for (const event of events ?? []) yield event;
    }
    cancel() {}
  },
}));
vi.mock('../../memory/memory-injector', () => ({ retrieveMemoriesForInjection: mockRetrieveMemories }));
vi.mock('../../mcp/mcp-manager', () => ({
  mcpManager: { requiresApproval: mockRequiresApproval, callTool: vi.fn() },
}));

const MODEL: ModelConfig = {
  id: 'contract-model',
  label: 'Contract',
  baseUrl: 'https://api.example.com',
  model: 'test',
  apiKey: 'test-key',
  isCustom: false,
};

let workDir = '';

function queueResponsesRounds(rounds: Array<Array<Record<string, unknown>>>): void {
  mockCreateStream.mockImplementation(async () => rounds.shift() ?? []);
}

function makeAnthropicRound(content: unknown[], stopReason: string): Record<string, unknown> {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
    content,
  };
}

async function runScenario(
  protocol: 'responses' | 'anthropic',
  prompt: string,
  options: { onApproval?: (toolCall: ToolCall) => Promise<boolean>; maxToolCalls?: number } = {},
): Promise<{ events: ChatStreamEvent[]; hub: ContextHub }> {
  const sessionId = `contract-${protocol}`;
  const hub = new ContextHub(sessionId, workDir, 256_000, 16_384, { persist: false });
  const events: ChatStreamEvent[] = [];
  if (protocol === 'responses') {
    for await (const event of runResponsesLoop(prompt, {
      model: MODEL, cwd: workDir, sessionId, contextHub: hub, allowSubagents: false,
      ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}),
      ...(options.onApproval ? { onApproval: options.onApproval } : {}),
    })) events.push(event);
  } else {
    for await (const event of runAnthropicAgentLoop(prompt, {
      model: MODEL, cwd: workDir, sessionId, contextHub: hub, allowSubagents: false,
      client: { create: mockAnthropicCreate },
      ...(options.maxToolCalls !== undefined ? { maxToolCalls: options.maxToolCalls } : {}),
      ...(options.onApproval ? { onApproval: options.onApproval } : {}),
    })) events.push(event);
  }
  return { events, hub };
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-contract-'));
  await fs.writeFile(path.join(workDir, 'note.txt'), 'hello contract');
  mockCreateStream.mockReset();
  mockAnthropicCreate.mockReset();
  mockRetrieveMemories.mockClear();
  mockRetrieveMemories.mockResolvedValue({ memories: [], promptBlock: null });
  mockRequiresApproval.mockReset();
  mockRequiresApproval.mockResolvedValue(false);
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe.each(['responses', 'anthropic'] as const)('%s 契约', (protocol) => {
  it('工具输出超限时 hub 截断、事件仍为完整结果', async () => {
    const big = Array.from({ length: 120_000 }, (_, i) => String.fromCharCode(32 + ((i * 37) % 95))).join('');
    await fs.writeFile(path.join(workDir, 'big.txt'), big);
    const args = JSON.stringify({ path: 'big.txt' });

    if (protocol === 'responses') {
      const call = { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'big.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }

    const { events, hub } = await runScenario(protocol, '读大文件');

    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('"truncation"');
    const toolResult = events.find((event) => event.type === 'tool_result');
    expect((toolResult?.toolResult?.result as { output?: string } | undefined)?.output?.length).toBe(big.length);
  });

  it('超过工具调用上限后转为强制审批', async () => {
    const args = JSON.stringify({ path: 'note.txt' });
    if (protocol === 'responses') {
      const call1 = { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: args, status: 'completed' };
      const call2 = { type: 'function_call', call_id: 'call-2', name: 'read_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call1 },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call1], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.output_item.done', item: call2 },
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [call2], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r3', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'note.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-2', name: 'read_file', input: { path: 'note.txt' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }
    const onApproval = vi.fn().mockResolvedValue(true);

    const { events } = await runScenario(protocol, '任务', { maxToolCalls: 1, onApproval });

    expect(events.some((event) => event.type === 'content' && event.content?.includes('已达到工具调用上限(1)'))).toBe(true);
    expect(onApproval).toHaveBeenCalledWith(expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) }));
  });

  it('危险工具需审批，拒绝后不落盘', async () => {
    const args = JSON.stringify({ path: 'x.txt', content: 'x' });
    if (protocol === 'responses') {
      const call = { type: 'function_call', call_id: 'call-1', name: 'write_file', arguments: args, status: 'completed' };
      queueResponsesRounds([
        [
          { type: 'response.output_item.done', item: call },
          { type: 'response.completed', response: { id: 'r1', object: 'response', model: 'test', status: 'completed', output: [call], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
        [
          { type: 'response.completed', response: { id: 'r2', object: 'response', model: 'test', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }], usage: { input_tokens: 1, output_tokens: 1 } } },
        ],
      ]);
    } else {
      mockAnthropicCreate
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'tool_use', id: 'call-1', name: 'write_file', input: { path: 'x.txt', content: 'x' } }], 'tool_use'))
        .mockResolvedValueOnce(makeAnthropicRound([{ type: 'text', text: 'done' }], 'end_turn'));
    }
    const onApproval = vi.fn().mockResolvedValue(false);

    const { hub } = await runScenario(protocol, '写文件', { onApproval });

    expect(onApproval).toHaveBeenCalledTimes(1);
    const hubOutput = hub.getResponseItems().find((item) => item.type === 'function_call_output');
    expect(hubOutput && hubOutput.type === 'function_call_output' ? hubOutput.output : '').toContain('用户拒绝了此操作');
    await expect(fs.stat(path.join(workDir, 'x.txt'))).rejects.toThrow();
  });
});
