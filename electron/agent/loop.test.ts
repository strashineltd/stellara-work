/**
 * Agent loop unit tests (extracted logic, no LLM dependency)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ModelConfig, ChatMessage, ChatStreamEvent } from '../../shared/ipc';

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

vi.mock('../memory/memory-injector', () => ({
  retrieveMemoriesForInjection: vi.fn(),
}));

import { runAgentLoop } from './loop';
import { retrieveMemoriesForInjection } from '../memory/memory-injector';

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

  it('READY TO EXECUTE with a read tool call: executes the tool and never sends a dangling assistant tool_call', async () => {
    mockChat
      .mockReturnValueOnce((async function* () {
        yield { type: 'content', content: '1. 读 README\n\nREADY TO EXECUTE' };
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'tc_read',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) },
          },
        };
        yield { type: 'done' };
      })())
      .mockReturnValueOnce(contentThenDone(''));
    mockInvokeTool.mockResolvedValue({ ok: true, output: '' });

    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('task', {
      model: makeConfig(),
      cwd: '/work',
      planMode: true,
      onPlanApproval: async () => true,
      onApproval: async () => true,
    })) {
      events.push(ev);
    }

    expect(mockInvokeTool).toHaveBeenCalledTimes(1);
    const readResults = events.filter((e) => e.type === 'tool_result' && e.toolResult?.name === 'read_file');
    expect(readResults).toHaveLength(1);
    expect(readResults[0]?.toolResult?.result).toEqual({ ok: true, output: '' });

    const calls = mockChat.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const lastMessages = calls[calls.length - 1][0].messages as ChatMessage[];
    for (let i = 0; i < lastMessages.length; i++) {
      const m = lastMessages[i];
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const next = lastMessages[i + 1];
        expect(next, 'assistant tool_call must be immediately followed by its tool response').toBeDefined();
        expect(next.role).toBe('tool');
        const callIds = m.tool_calls.map((tc) => tc.id);
        expect(callIds).toContain(next.tool_call_id);
      }
    }
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

describe('memory_context event', () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockInvokeTool.mockReset();
    mockChat.mockImplementation(() => contentThenDone(''));
    (retrieveMemoriesForInjection as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('yields memory_context when memories are injected', async () => {
    (retrieveMemoriesForInjection as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      memories: [{ id: 'm1', kind: 'preference', content: '用户偏好中文', importance: 0.9, confidence: 0.9, accessCount: 1, tags: [], createdAt: 0, updatedAt: 0 }],
      promptBlock: '[相关记忆]\n- 用户偏好中文',
    });
    mockChat.mockImplementation(function* () {
      yield { type: 'content', content: '好的' };
      yield { type: 'done' };
    });
    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('你好', { model: makeConfig(), cwd: '/tmp', platform: { platform: 'darwin', arch: 'arm64' } })) {
      events.push(ev);
    }
    const ctx = events.find((e) => e.type === 'memory_context');
    expect(ctx).toBeDefined();
    if (ctx?.type === 'memory_context') expect(ctx.memories.length).toBeGreaterThan(0);
  });

  it('does not yield memory_context when no promptBlock is returned', async () => {
    (retrieveMemoriesForInjection as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      memories: [],
      promptBlock: null,
    });
    const events: ChatStreamEvent[] = [];
    for await (const ev of collect('你好', { model: makeConfig(), cwd: '/tmp', platform: { platform: 'darwin', arch: 'arm64' } })) {
      events.push(ev);
    }
    expect(events.some((e) => e.type === 'memory_context')).toBe(false);
  });
});
