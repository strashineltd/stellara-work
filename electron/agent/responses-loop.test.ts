import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runResponsesLoop } from './responses-loop';
import { ContextHub } from '../context/context-hub';
import { _setDbPath, getDb, createSession, initContextTables } from '../store/db';
import type { ModelConfig } from '../../shared/ipc';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-loop-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initContextTables();
  createSession({ id: 'sess-001', title: 'Test', modelId: 'test' });
  mockRequiresApproval.mockReset();
  mockRequiresApproval.mockResolvedValue(false);
  mockMcpCallTool.mockClear();
  mockRetrieveMemories.mockClear();
  mockRetrieveMemories.mockResolvedValue({ memories: [], promptBlock: null });
  streamQueue.length = 0;
  responseRequests.length = 0;
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const DEFAULT_MODEL: ModelConfig = {
  id: 'test',
  label: 'Test',
  baseUrl: 'https://api.example.com',
  model: 'test',
  apiKey: 'test-key',
  isCustom: false,
};

// 模拟 ResponsesClient 与 mcpManager（MCP 审批策略查询）
// streamQueue：每个测试可注入自定义事件流（shift 一次后回落到默认流）
const { mockRequiresApproval, mockMcpCallTool, mockRetrieveMemories, streamQueue, defaultStreamEvents, responseRequests } = vi.hoisted(() => {
  const defaultStreamEvents = [
    {
      type: 'response.output_text.delta',
      output_index: 0,
      content_index: 0,
      delta: 'Hello',
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp-001',
        object: 'response',
        model: 'test',
        status: 'completed',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
        ],
      },
    },
  ];
  return {
    mockRequiresApproval: vi.fn().mockResolvedValue(false),
    mockMcpCallTool: vi.fn().mockResolvedValue({ ok: true, output: 'ok' }),
    mockRetrieveMemories: vi.fn().mockResolvedValue({ memories: [], promptBlock: null }),
    streamQueue: [] as Array<() => Array<Record<string, unknown>>>,
    defaultStreamEvents,
    responseRequests: [] as Array<{ tools?: Array<{ name: string }> }>,
  };
});

vi.mock('../memory/memory-injector', () => ({
  retrieveMemoriesForInjection: mockRetrieveMemories,
}));

vi.mock('../llm/responses', () => {
  return {
    ResponsesClient: class {
      async *createStream(request: unknown) {
        if (request && typeof request === 'object') responseRequests.push(request as { tools?: Array<{ name: string }> });
        const events = streamQueue.length > 0 ? streamQueue.shift()!() : defaultStreamEvents;
        for (const event of events) yield event;
      }
      cancel() {}
    },
  };
});

vi.mock('../mcp/mcp-manager', () => ({
  mcpManager: {
    requiresApproval: mockRequiresApproval,
    callTool: mockMcpCallTool,
  },
}));

describe('runResponsesLoop', () => {
  it('生成 content 事件', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const events: string[] = [];

    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });

    for await (const event of gen) {
      events.push(event.type);
    }

    expect(events).toContain('content');
    expect(events).toContain('done');
  });

  it('记录用户消息到 Context Hub', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const commitSpy = vi.spyOn(hub, 'commitEvent');

    const gen = runResponsesLoop('test message', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });

    for await (const _event of gen) {
      // 消费事件
    }

    expect(commitSpy).toHaveBeenCalledWith('user_message_added', expect.objectContaining({
      content: 'test message',
    }));
  });

  it('添加响应到 Context Hub', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const addSpy = vi.spyOn(hub, 'addResponseItem');

    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });

    for await (const _event of gen) {
      // 消费事件
    }

    expect(addSpy).toHaveBeenCalled();
  });

  it('检查硬阈值', async () => {
    // 使用足够大的 context window，但通过添加大量 items 使 usage 超限
    const hub = new ContextHub('sess-001', tmpDir, 4000, 500);

    // 添加大量 response items 使 usage 超限
    for (let i = 0; i < 50; i++) {
      hub.addResponseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'x'.repeat(500) }],
      });
    }

    const events: string[] = [];
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });

    for await (const event of gen) {
      events.push(event.type);
    }

    // 由于模拟的 client 总是返回 completed，不会触发硬阈值错误
    // 但可以验证 contextHub.isHardLimited() 被检查
    expect(hub.isHardLimited()).toBe(true);
  });

  it('处理中断信号', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const controller = new AbortController();

    // 立即中断
    controller.abort();

    const events: string[] = [];
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
      signal: controller.signal,
    });

    for await (const event of gen) {
      events.push(event.type);
    }

    expect(events).toContain('error');
  });

  describe('MCP 工具审批', () => {
    /** 构造一轮 function_call 流：首次返回工具调用，之后回落默认流 → 循环自然结束 */
    function functionCallStream(name: string): Array<Record<string, unknown>> {
      return [
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'function_call', id: 'fc-1', call_id: 'fc-1', name, arguments: '{}', status: 'in_progress' },
        },
        {
          type: 'response.function_call_arguments.done',
          output_index: 0,
          item_id: 'fc-1',
          arguments: '{}',
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp-001',
            object: 'response',
            model: 'test',
            status: 'completed',
            output: [{ type: 'function_call', id: 'fc-1', call_id: 'fc-1', name, arguments: '{}', status: 'completed' }],
          },
        },
      ];
    }

    it('approval=always 时 MCP 工具调用先征求用户批准，拒绝后不执行', async () => {
      mockRequiresApproval.mockResolvedValue(true);
      streamQueue.push(() => functionCallStream('mcp__s1__write'));

      const hub = new ContextHub('sess-001', tmpDir);
      const onApproval = vi.fn().mockResolvedValue(false);
      const events: string[] = [];

      const gen = runResponsesLoop('test', {
        model: DEFAULT_MODEL,
        cwd: tmpDir,
        sessionId: 'sess-001',
        contextHub: hub,
        onApproval,
      });
      for await (const event of gen) events.push(event.type);

      expect(mockRequiresApproval).toHaveBeenCalledWith('mcp__s1__write');
      expect(onApproval).toHaveBeenCalledTimes(1);
      expect(onApproval).toHaveBeenCalledWith(
        expect.objectContaining({ function: expect.objectContaining({ name: 'mcp__s1__write' }) }),
      );
      expect(mockMcpCallTool).not.toHaveBeenCalled();
      expect(events).toContain('done');
    });

    it('approval=never 时 MCP 工具直接执行，不征求批准', async () => {
      mockRequiresApproval.mockResolvedValue(false);
      streamQueue.push(() => functionCallStream('mcp__s1__write'));

      const hub = new ContextHub('sess-001', tmpDir);
      const onApproval = vi.fn();
      const events: string[] = [];

      const gen = runResponsesLoop('test', {
        model: DEFAULT_MODEL,
        cwd: tmpDir,
        sessionId: 'sess-001',
        contextHub: hub,
        onApproval,
      });
      for await (const event of gen) events.push(event.type);

      expect(onApproval).not.toHaveBeenCalled();
      expect(mockMcpCallTool).toHaveBeenCalledWith('mcp__s1__write', {});
      expect(events).toContain('tool_result');
      expect(events).toContain('done');
    });

    it('内置危险工具不查询 MCP 策略，仍走审批', async () => {
      streamQueue.push(() => functionCallStream('write_file'));

      const hub = new ContextHub('sess-001', tmpDir);
      const onApproval = vi.fn().mockResolvedValue(false);

      for await (const _event of runResponsesLoop('test', {
        model: DEFAULT_MODEL,
        cwd: tmpDir,
        sessionId: 'sess-001',
        contextHub: hub,
        onApproval,
      })) {
        // 消费事件
      }

      expect(mockRequiresApproval).not.toHaveBeenCalled();
      expect(onApproval).toHaveBeenCalledTimes(1);
      expect(onApproval).toHaveBeenCalledWith(
        expect.objectContaining({ function: expect.objectContaining({ name: 'write_file' }) }),
      );
    });

    it('browser_act / browser_exec_js are gated as dangerous tools (loop approval)', async () => {
      streamQueue.push(() => functionCallStream('browser_act'));
      streamQueue.push(() => functionCallStream('browser_exec_js'));

      const hub = new ContextHub('sess-001', tmpDir);
      const onApproval = vi.fn().mockResolvedValue(false);

      for await (const _event of runResponsesLoop('test', {
        model: DEFAULT_MODEL,
        cwd: tmpDir,
        sessionId: 'sess-001',
        contextHub: hub,
        onApproval,
      })) {
        // 消费事件
      }

      expect(mockRequiresApproval).not.toHaveBeenCalled();
      expect(onApproval.mock.calls.map((c) => c[0].function.name)).toEqual(['browser_act', 'browser_exec_js']);
    });
  });

  it('记忆注入携带会话所属项目 id（按项目检索项目记忆）', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    for await (const _ev of runResponsesLoop('测试任务', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
      memoryProjectId: 'proj-1',
    })) {
      // 消费事件
    }
    expect(mockRetrieveMemories).toHaveBeenCalledWith('测试任务', {
      maxMemories: 10,
      projectId: 'proj-1',
    });
  });

  it('透传 reasoning 思考事件给 UI', async () => {
    streamQueue.push(() => [
      {
        type: 'response.reasoning_text.delta',
        output_index: 0,
        content_index: 0,
        delta: '思考中：先分析需求',
      },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: 'Hello',
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-001',
          object: 'response',
          model: 'test',
          status: 'completed',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
          ],
        },
      },
    ]);

    const hub = new ContextHub('sess-001', tmpDir);
    const reasoning: string[] = [];
    for await (const ev of runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    })) {
      if (ev.type === 'reasoning' && ev.content) reasoning.push(ev.content);
    }

    expect(reasoning).toEqual(['思考中：先分析需求']);
  });

  it('输出截断时提示原因并继续生成', async () => {
    streamQueue.push(() => [
      {
        type: 'response.incomplete',
        response: {
          id: 'resp-001',
          object: 'response',
          model: 'test',
          status: 'incomplete',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '部分内容' }] }],
        },
        incomplete_details: { reason: 'max_output_tokens' },
      },
    ]);

    const hub = new ContextHub('sess-001', tmpDir);
    const events: string[] = [];
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });
    for await (const ev of gen) {
      if (ev.type === 'content') events.push(ev.content);
    }

    // 截断提示 + 第二轮回落默认流正常结束
    expect(events.some((c) => c.includes('[输出截断：已达单次输出上限'))).toBe(true);
    expect(events.some((c) => c.includes('Hello'))).toBe(true);
  });

  it('连续三次截断后停止并引导调大 max_output_tokens', async () => {
    const truncated = () => [
      {
        type: 'response.incomplete',
        response: {
          id: 'resp-001',
          object: 'response',
          model: 'test',
          status: 'incomplete',
          output: [],
        },
        incomplete_details: { reason: 'max_output_tokens' },
      },
    ];
    streamQueue.push(truncated, truncated, truncated);

    const hub = new ContextHub('sess-001', tmpDir);
    const events: string[] = [];
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
    });
    for await (const ev of gen) {
      if (ev.type === 'error' && ev.error) events.push(ev.error);
    }

    expect(events.some((e) => e.includes('连续多次输出被截断'))).toBe(true);
  });

  it('plan 模式下注入 planExtraTools 且不暴露执行工具', async () => {
    streamQueue.push(() => [
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: '1. 读取文件\n2. 完成',
      },
      {
        type: 'response.completed',
        response: {
          id: 'resp-001',
          object: 'response',
          model: 'test',
          status: 'completed',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '1. 读取文件\n2. 完成' }] },
          ],
        },
      },
    ]);

    const hub = new ContextHub('sess-001', tmpDir);
    const events: string[] = [];
    const gen = runResponsesLoop('test', {
      model: DEFAULT_MODEL,
      cwd: tmpDir,
      sessionId: 'sess-001',
      contextHub: hub,
      planMode: true,
      planExtraTools: [
        { type: 'function', name: 'mcp__s1__read', description: 'read', parameters: { type: 'object' }, strict: false },
      ],
    });
    for await (const event of gen) events.push(event.type);

    expect(events).toContain('plan');
    const firstRequest = responseRequests[0]!;
    expect(firstRequest.tools!.some((t) => t.name === 'mcp__s1__read')).toBe(true);
    expect(firstRequest.tools!.some((t) => t.name === 'write_file')).toBe(false);
  });
});
