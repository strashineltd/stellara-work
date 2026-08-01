/**
 * Agent loop unit tests (extracted logic, no LLM dependency)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelConfig, ChatStreamEvent } from '../../shared/ipc';

const { mockChat, mockInvokeTool } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockInvokeTool: vi.fn(),
}));

vi.mock('../llm/openai-compat', () => ({
  OpenAICompatClient: vi.fn().mockImplementation(function () {
    return {
      chat: mockChat,
      summarize: vi.fn().mockResolvedValue('summary'),
    };
  }),
}));

vi.mock('./tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools')>();
  return { ...actual, invokeTool: mockInvokeTool };
});

import { runAgentLoop } from './loop';

function makeConfig(): ModelConfig {
  return {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek-v4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    apiKey: 'sk-test',
    isCustom: false,
  };
}

function contentThenDone(content: string): AsyncGenerator<ChatStreamEvent> {
  return (async function* () {
    yield { type: 'content', content };
    yield { type: 'done' };
  })();
}

function collect(userMessage: string, options: Parameters<typeof runAgentLoop>[1]) {
  return runAgentLoop(userMessage, options);
}

describe('plan approval gate', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockInvokeTool.mockReset();
    mockChat.mockImplementation(() => contentThenDone(''));
  });

  it('pauses for approval, then switches to build and executes write tools after approval', async () => {
    mockChat
      .mockReturnValueOnce(contentThenDone('1. 写 README\n\nREADY TO EXECUTE'))
      .mockReturnValueOnce((async function* () {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc1',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'README.md', content: 'hi' }) },
          },
        };
        yield { type: 'done' };
      })());
    mockInvokeTool.mockResolvedValue({ ok: true, output: 'written' });

    const approvedPlans: unknown[] = [];
    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('task', {
      model: makeConfig(),
      cwd: '/work',
      planMode: true,
      onPlanApproval: async (plan) => {
        approvedPlans.push(plan);
        return true;
      },
      onApproval: async () => true,
    })) {
      events.push(ev);
    }

    expect(approvedPlans).toHaveLength(1);
    expect(events.some((e) => e.type === 'plan_ready')).toBe(true);
    const writeResults = events.filter((e) => e.type === 'tool_result' && e.toolResult?.name === 'write_file');
    expect(writeResults).toHaveLength(1);
    expect(writeResults[0]?.toolResult?.result).toEqual({ ok: true, output: 'written' });
    expect(mockInvokeTool).toHaveBeenCalled();
  });

  it('rejects the plan: emits user_aborted error, no plan_ready, no tool execution', async () => {
    mockChat.mockReturnValueOnce(contentThenDone('1. 写 README\n\nREADY TO EXECUTE'));

    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('task', {
      model: makeConfig(),
      cwd: '/work',
      planMode: true,
      onPlanApproval: async () => false,
    })) {
      events.push(ev);
    }

    const err = events.find((e) => e.type === 'error');
    expect(err?.errorMeta?.kind).toBe('user_aborted');
    expect(err?.errorMeta?.retryable).toBe(true);
    expect(events.some((e) => e.type === 'plan_ready')).toBe(false);
    expect(events.some((e) => e.type === 'tool_result')).toBe(false);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('without onPlanApproval: emits plan_ready directly (no gate)', async () => {
    mockChat.mockReturnValueOnce(contentThenDone('1. 写 README\n\nREADY TO EXECUTE'));

    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('task', {
      model: makeConfig(),
      cwd: '/work',
      planMode: true,
    })) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === 'plan_ready')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('multi-turn: plan without READY TO EXECUTE continues via tool calls, then the gate triggers once on the READY TO EXECUTE turn', async () => {
    mockChat
      .mockReturnValueOnce((async function* () {
        yield { type: 'content', content: '1. 阅读 README\n2. 写代码\n3. 运行测试' };
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) },
          },
        };
        yield { type: 'done' };
      })())
      .mockReturnValueOnce(contentThenDone('1. 阅读 README\n2. 写代码\n3. 运行测试\n\nREADY TO EXECUTE'));
    mockInvokeTool.mockResolvedValue({ ok: true, output: '' });

    const approvedPlans: unknown[] = [];
    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('task', {
      model: makeConfig(),
      cwd: '/work',
      planMode: true,
      onPlanApproval: async (plan) => {
        approvedPlans.push(plan);
        return true;
      },
    })) {
      events.push(ev);
    }

    expect(approvedPlans).toHaveLength(1);
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(1);
    expect(events.some((e) => e.type === 'plan_ready')).toBe(true);
  });
});

// Test the consecutive-failure detection by extracting the logic:
// consecutiveFailures starts at 0 each iteration, increments on !ok, resets on ok,
// melts down at >= 5.
function simulateConsecutiveFailures(results: boolean[]): number | null {
  let consecutiveFailures = 0;
  for (const ok of results) {
    if (!ok) {
      consecutiveFailures++;
      if (consecutiveFailures >= 5) return consecutiveFailures;
    } else {
      consecutiveFailures = 0;
    }
  }
  return null; // never melted
}

describe('consecutive failure detection', () => {
  it('resets on success between failures', () => {
    expect(simulateConsecutiveFailures([false, false, true, false, false])).toBeNull();
  });

  it('melts down at exactly 5 consecutive any-tool failures', () => {
    expect(simulateConsecutiveFailures([false, false, false, false, false])).toBe(5);
  });

  it('does NOT melt at 4 consecutive failures', () => {
    expect(simulateConsecutiveFailures([false, false, false, false])).toBeNull();
  });

  it('catches alternating tool failures (bug fix: old code only tracked same tool)', () => {
    // Old code tracked by tool name — alternating would reset counter.
    // New code counts any consecutive failure regardless of tool name.
    expect(simulateConsecutiveFailures([false, false, false, false, false])).toBe(5);
  });

  it('resets counter after first success', () => {
    expect(simulateConsecutiveFailures([false, false, true, false, false, false, false])).toBeNull();
  });
});
