import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ContextHub } from './context-hub';
import { _setDbPath, getDb, createSession, initContextTables } from '../store/db';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-hub-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initContextTables();
  createSession({ id: 'sess-001', title: 'Test', modelId: 'test' });
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ContextHub', () => {
  it('初始化空上下文', () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    const ctx = hub.getContext();

    expect(ctx.sessionId).toBe('sess-001');
    expect(ctx.revision).toBe(0);
    expect(ctx.workspaceRevision).toBe(0);
    expect(ctx.objective).toBe('');
    expect(ctx.plan.steps).toHaveLength(0);
    expect(ctx.responseItems).toHaveLength(0);
  });

  it('commitEvent 递增 sequence 和 revision', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('user_message_added', { content: 'test' });
    expect(hub.getRevision()).toBe(1);

    await hub.commitEvent('tool_call_started', { id: 'tc-1', name: 'read_file', args: {} });
    expect(hub.getRevision()).toBe(2);
  });

  it('user_message_added 添加到 responseItems', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('user_message_added', { content: 'Hello' });

    const items = hub.getResponseItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('message');
    expect(items[0]!.role).toBe('user');
  });

  it('plan_created 设置计划', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('plan_created', {
      objective: '实现功能',
      constraints: ['不破坏现有测试'],
      steps: [
        { id: 'step-1', description: '写代码', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
        { id: 'step-2', description: '写测试', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    const ctx = hub.getContext();
    expect(ctx.objective).toBe('实现功能');
    expect(ctx.plan.steps).toHaveLength(2);
    expect(ctx.plan.steps[0]!.status).toBe('pending');
  });

  it('plan_step_changed 更新步骤状态', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('plan_created', {
      objective: 'test',
      constraints: [],
      steps: [
        { id: 'step-1', description: 'test', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    await hub.commitEvent('plan_step_changed', { stepId: 'step-1', status: 'in_progress' });

    const ctx = hub.getContext();
    expect(ctx.plan.steps[0]!.status).toBe('in_progress');
  });

  it('tool_call_started 和 tool_call_completed', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('tool_call_started', { id: 'tc-1', name: 'read_file', args: { path: '/test' } });
    expect(hub.getContext().tools.running.size).toBe(1);

    await hub.commitEvent('tool_call_completed', { id: 'tc-1', result: 'content' });
    expect(hub.getContext().tools.running.size).toBe(0);
    expect(hub.getContext().tools.completed).toHaveLength(1);
  });

  it('file_modified 递增 workspaceRevision', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('file_modified', {
      filePath: '/test.ts',
      agentId: 'main',
    });

    expect(hub.getWorkspaceRevision()).toBe(1);
    expect(hub.getUnverifiedFiles()).toContain('/test.ts');
  });

  it('file_modified 使 evidence 过期', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    // 先添加验证证据
    await hub.commitEvent('verification_completed', {
      kind: 'test',
      relatedFiles: ['/test.ts'],
      planStepIds: [],
      ok: true,
      summary: '测试通过',
    });

    const evidenceBefore = hub.getVerificationEvidence();
    expect(evidenceBefore).toHaveLength(1);

    // 修改文件
    await hub.commitEvent('file_modified', {
      filePath: '/test.ts',
      agentId: 'main',
    });

    const staleEvidence = hub.getStaleEvidence();
    expect(staleEvidence).toHaveLength(1);
    expect(staleEvidence[0]!.relatedFiles).toContain('/test.ts');
  });

  it('verification_completed 添加证据', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('verification_completed', {
      kind: 'typecheck',
      command: 'npm run typecheck',
      relatedFiles: [],
      planStepIds: [],
      ok: true,
      summary: 'TypeScript 编译通过',
    });

    const evidence = hub.getVerificationEvidence();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.kind).toBe('typecheck');
    expect(evidence[0]!.ok).toBe(true);
  });

  it('subagent_started 和 subagent_completed', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('subagent_started', {
      id: 'sa-1',
      task: '写测试',
      role: 'verify',
    });

    expect(hub.getRunningSubagents()).toHaveLength(1);

    await hub.commitEvent('subagent_completed', {
      id: 'sa-1',
      status: 'completed',
      resultSummary: '测试完成',
    });

    expect(hub.getRunningSubagents()).toHaveLength(0);
  });

  it('memory_injected 记录注入的记忆', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('memory_injected', {
      id: 'mem-1',
      scope: 'project',
      kind: 'fact',
      content: '项目使用 TypeScript',
      source: 'session:prev',
    });

    const ctx = hub.getContext();
    expect(ctx.memory.injected).toHaveLength(1);
    expect(ctx.memory.injected[0]!.content).toBe('项目使用 TypeScript');
  });

  it('createCheckpoint 创建检查点', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.commitEvent('plan_created', {
      objective: 'test',
      constraints: ['constraint-1'],
      steps: [
        { id: 'step-1', description: 'test', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    const checkpoint = hub.createCheckpoint();

    expect(checkpoint.objective).toBe('test');
    expect(checkpoint.constraints).toContain('constraint-1');
    expect(checkpoint.planState).toHaveLength(1);
    expect(hub.getContext().checkpointId).toBe(checkpoint.id);
  });

  it('canCompleteTask 检查门禁', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    // 初始状态：没有计划，可以完成
    const result1 = hub.canCompleteTask();
    expect(result1.ok).toBe(true);

    // 添加计划步骤
    await hub.commitEvent('plan_created', {
      objective: 'test',
      constraints: [],
      steps: [
        { id: 'step-1', description: 'test', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    // 有未完成步骤，不能完成
    const result2 = hub.canCompleteTask();
    expect(result2.ok).toBe(false);
    expect(result2.reasons[0]).toContain('计划步骤未完成');
  });

  it('isHardLimited 和 isNearLimit', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 1000, 100);

    // 初始状态未超限
    expect(hub.isHardLimited()).toBe(false);
    expect(hub.isNearLimit()).toBe(false);
  });

  it('onEvent 监听器接收事件', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    const receivedEvents: string[] = [];

    hub.onEvent((event) => {
      receivedEvents.push(event.event);
    });

    await hub.commitEvent('user_message_added', { content: 'test' });
    await hub.commitEvent('tool_call_started', { id: 'tc-1', name: 'test', args: {} });

    expect(receivedEvents).toEqual(['user_message_added', 'tool_call_started']);
  });

  it('dispose 清理资源', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    const received: string[] = [];

    hub.onEvent((e) => received.push(e.event));
    hub.dispose();

    await hub.commitEvent('user_message_added', { content: 'test' });
    expect(received).toHaveLength(0);
  });
});
