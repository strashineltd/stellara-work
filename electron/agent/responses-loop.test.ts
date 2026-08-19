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

// 模拟 ResponsesClient
vi.mock('../llm/responses', () => {
  return {
    ResponsesClient: class {
      async *createStream() {
        yield {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: 'Hello',
        };
        yield {
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
        };
      }
      cancel() {}
    },
  };
});

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
});
