import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _setDbPath, getDb, initContextTables, insertContextEvent, getContextEventsBySession, createSession } from './db';
import type { ContextEventEnvelope } from '../../shared/ipc';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-ctx-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  // 初始化 sessions 表（getDb 会自动创建）
  getDb();
  // 创建测试 session（满足外键约束）
  createSession({ id: 'sess-001', title: 'Test Session', modelId: 'test' });
  createSession({ id: 'sess-002', title: 'Test Session 2', modelId: 'test' });
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Context Hub 数据库表', () => {
  it('initContextTables 创建所有必要的表', () => {
    const db = getDb();
    initContextTables();

    // 验证表存在
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('response_items');
    expect(tableNames).toContain('context_events');
    expect(tableNames).toContain('context_checkpoints');
    expect(tableNames).toContain('verification_evidence');
    expect(tableNames).toContain('subagent_runs');
  });

  it('initContextTables 幂等（重复调用不报错）', () => {
    initContextTables();
    initContextTables(); // 第二次调用不应报错
  });

  it('insertContextEvent 插入事件', () => {
    initContextTables();

    const event: ContextEventEnvelope = {
      id: 'evt-001',
      sessionId: 'sess-001',
      sequence: 1,
      contextRevision: 1,
      workspaceRevision: 0,
      sourceAgentId: 'main',
      createdAt: new Date().toISOString(),
      event: 'user_message_added',
    };

    insertContextEvent(event);

    const events = getContextEventsBySession('sess-001');
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('evt-001');
    expect(events[0]!.event).toBe('user_message_added');
  });

  it('insertContextEvent 递增 sequence', () => {
    initContextTables();

    const event1: ContextEventEnvelope = {
      id: 'evt-001',
      sessionId: 'sess-001',
      sequence: 1,
      contextRevision: 1,
      workspaceRevision: 0,
      sourceAgentId: 'main',
      createdAt: new Date().toISOString(),
      event: 'user_message_added',
    };

    const event2: ContextEventEnvelope = {
      id: 'evt-002',
      sessionId: 'sess-001',
      sequence: 2,
      contextRevision: 1,
      workspaceRevision: 0,
      sourceAgentId: 'main',
      createdAt: new Date().toISOString(),
      event: 'tool_call_started',
    };

    insertContextEvent(event1);
    insertContextEvent(event2);

    const events = getContextEventsBySession('sess-001');
    expect(events).toHaveLength(2);
    expect(events[0]!.sequence).toBe(1);
    expect(events[1]!.sequence).toBe(2);
  });

  it('getContextEventsBySession 按 sequence 排序', () => {
    initContextTables();

    // 故意乱序插入
    const events: ContextEventEnvelope[] = [
      { id: 'evt-003', sessionId: 'sess-001', sequence: 3, contextRevision: 1, workspaceRevision: 0, sourceAgentId: 'main', createdAt: new Date().toISOString(), event: 'tool_call_completed' },
      { id: 'evt-001', sessionId: 'sess-001', sequence: 1, contextRevision: 1, workspaceRevision: 0, sourceAgentId: 'main', createdAt: new Date().toISOString(), event: 'user_message_added' },
      { id: 'evt-002', sessionId: 'sess-001', sequence: 2, contextRevision: 1, workspaceRevision: 0, sourceAgentId: 'main', createdAt: new Date().toISOString(), event: 'tool_call_started' },
    ];

    for (const event of events) {
      insertContextEvent(event);
    }

    const result = getContextEventsBySession('sess-001');
    expect(result).toHaveLength(3);
    expect(result[0]!.sequence).toBe(1);
    expect(result[1]!.sequence).toBe(2);
    expect(result[2]!.sequence).toBe(3);
  });

  it('getContextEventsBySession 支持 limit', () => {
    initContextTables();

    for (let i = 1; i <= 5; i++) {
      insertContextEvent({
        id: `evt-${i.toString().padStart(3, '0')}`,
        sessionId: 'sess-001',
        sequence: i,
        contextRevision: 1,
        workspaceRevision: 0,
        sourceAgentId: 'main',
        createdAt: new Date().toISOString(),
        event: 'user_message_added',
      });
    }

    const events = getContextEventsBySession('sess-001', 3);
    expect(events).toHaveLength(3);
    // 应该返回最新的3条（sequence 3,4,5）
    expect(events[0]!.sequence).toBe(3);
    expect(events[2]!.sequence).toBe(5);
  });

  it('不同 session 的事件隔离', () => {
    initContextTables();

    insertContextEvent({
      id: 'evt-001',
      sessionId: 'sess-001',
      sequence: 1,
      contextRevision: 1,
      workspaceRevision: 0,
      sourceAgentId: 'main',
      createdAt: new Date().toISOString(),
      event: 'user_message_added',
    });

    insertContextEvent({
      id: 'evt-002',
      sessionId: 'sess-002',
      sequence: 1,
      contextRevision: 1,
      workspaceRevision: 0,
      sourceAgentId: 'main',
      createdAt: new Date().toISOString(),
      event: 'plan_created',
    });

    const events1 = getContextEventsBySession('sess-001');
    const events2 = getContextEventsBySession('sess-002');

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]!.event).toBe('user_message_added');
    expect(events2[0]!.event).toBe('plan_created');
  });
});
