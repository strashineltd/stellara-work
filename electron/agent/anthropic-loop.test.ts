import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContextHub } from '../context/context-hub';
import { runAnthropicAgentLoop } from './anthropic-loop';
import type { ModelConfig } from '../../shared/ipc';

const mockCreate = vi.fn();

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
});
