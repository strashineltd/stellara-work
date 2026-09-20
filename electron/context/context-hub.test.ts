import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ContextHub } from './context-hub';
import { _setDbPath, getDb, createSession, initContextTables, getContextEventsBySession } from '../store/db';

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
    // 使用足够大的 context window（至少 4100 + maxOutputTokens + reserves）
    const hub = new ContextHub('sess-001', '/tmp/work', 32000, 4000);

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

describe('上下文压缩与恢复', () => {
  function addItems(hub: ContextHub, count: number, size = 2000): void {
    for (let i = 0; i < count; i++) {
      hub.addResponseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `${i}:${'x'.repeat(size)}` }],
      });
    }
  }

  it('低于软阈值不压缩', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 100_000, 1_000);
    addItems(hub, 2);
    const result = await hub.ensureContextBudget({});
    expect(result.compacted).toBe(false);
  });

  it('达到软阈值压缩并落事件', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const result = await hub.ensureContextBudget({});
    expect(result.compacted).toBe(true);
    expect(result.tokensAfter!).toBeLessThan(result.tokensBefore!);
    expect(hub.getResponseItems().length).toBeLessThan(60);
    const events = getContextEventsBySession('sess-001').filter((e) => e.event === 'context_compacted');
    expect(events).toHaveLength(1);
  });

  it('检查点创建失败时降级返回且窗口不变', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const before = hub.getResponseItems();
    vi.spyOn(hub, 'createCheckpoint').mockImplementation(() => {
      throw new Error('disk full');
    });
    const result = await hub.ensureContextBudget({});
    expect(result.compacted).toBe(false);
    expect(hub.getResponseItems()).toHaveLength(before.length);
    expect(hub.getResponseItems()).toEqual(before);
  });

  it('重开 hub 按指针恢复活跃窗口', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    await hub.ensureContextBudget({});
    const activeCount = hub.getResponseItems().length;

    const reopened = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    expect(reopened.getResponseItems()).toHaveLength(activeCount);
    expect(reopened.getContext().compactionWindowStartIndex).toBeGreaterThan(0);
  });

  it('digest 不匹配时忽略指针', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    await hub.ensureContextBudget({});
    await hub.commitEvent('context_compacted', {
      windowStartIndex: 5,
      droppedCount: 5,
      windowDigest: 'deadbeef',
      checkpointId: 'missing',
      tokensBefore: 0,
      tokensAfter: 0,
      compressedCount: 5,
      reason: 'soft_threshold',
    });
    const reopened = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    expect(reopened.getResponseItems()).toHaveLength(60);
  });

  it('摘要成功写入、失败不阻塞压缩', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const ok = await hub.ensureContextBudget({ summarize: async () => '这是一段摘要' });
    expect(ok.summary).toBe('这是一段摘要');
    expect(hub.getCompactionSummary()).toBe('这是一段摘要');

    addItems(hub, 60);
    const failed = await hub.ensureContextBudget({
      summarize: async () => {
        throw new Error('boom');
      },
    });
    expect(failed.compacted).toBe(true);
    expect(failed.summary).toBeUndefined();
    expect(hub.getCompactionSummary()).toBe('这是一段摘要');
  });

  it('recordReportedInputTokens 校准系数并 clamp', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 100_000, 1_000);
    addItems(hub, 1);
    await hub.ensureContextBudget({});
    const before = hub.getContext().usage.currentInputTokens;
    hub.recordReportedInputTokens(before * 10);
    const after = hub.getContext().usage.currentInputTokens;
    expect(after / before).toBeGreaterThan(1);
    expect(after / before).toBeLessThanOrEqual(2);
  });

  it('摘要期间追加的 items 不丢失', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    const appended: import('../../shared/responses').ResponseItem = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'late-arrival' }],
    };
    await hub.ensureContextBudget({
      summarize: async () => {
        hub.addResponseItem(appended);
        return '摘要';
      },
    });
    expect(hub.getResponseItems()).toContain(appended);
  });

  it('并发压缩调用只执行一次', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work', 20_000, 1_000);
    addItems(hub, 60);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = hub.ensureContextBudget({
      summarize: async () => {
        await gate;
        return '摘要';
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await hub.ensureContextBudget({});
    expect(second.compacted).toBe(false);
    release();
    const firstResult = await first;
    expect(firstResult.compacted).toBe(true);
  });

  it('addDecision 记录决策事件并推进 revision', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');

    await hub.addDecision({ description: '用 SQLite', reason: '本地优先', relatedFiles: ['db.ts'] });

    expect(hub.getRevision()).toBe(1);
    const decisions = hub.getContext().decisions;
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      description: '用 SQLite',
      reason: '本地优先',
      relatedFiles: ['db.ts'],
    });
  });

  it('addDecision 的事件在回放后恢复', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.addDecision({ description: '用 SQLite', reason: '本地优先' });

    const replayed = new ContextHub('sess-001', '/tmp/work');
    expect(replayed.getContext().decisions.map((d) => d.description)).toEqual(['用 SQLite']);
  });

  it('file_read 复核未验证文件：清除标记并添加 file_reread 证据', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.commitEvent('file_modified', { filePath: 'a.ts', agentId: 'main' });
    expect(hub.getUnverifiedFiles()).toEqual(['a.ts']);

    await hub.commitEvent('file_read', { filePath: 'a.ts' });

    expect(hub.getUnverifiedFiles()).toEqual([]);
    expect(
      hub.getVerificationEvidence().some((e) => e.kind === 'file_reread' && e.relatedFiles.includes('a.ts')),
    ).toBe(true);
  });

  it('file_read 未验证之外的文件：不产生证据', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.commitEvent('file_read', { filePath: 'b.ts' });
    expect(hub.getVerificationEvidence()).toHaveLength(0);
  });

  it('重放事件不重复落盘验证证据与子代理行', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.commitEvent('verification_completed', {
      kind: 'test', command: 'npm test', relatedFiles: [], planStepIds: [], ok: true, summary: '通过',
    });
    await hub.commitEvent('subagent_started', { id: 'sa-1', task: 't', role: 'research' });

    const db = getDb();
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE session_id = ?`).get('sess-001') as { c: number }).c;
    expect(count('verification_evidence')).toBe(1);
    expect(count('subagent_runs')).toBe(1);

    const replayed = new ContextHub('sess-001', '/tmp/work');

    expect(count('verification_evidence')).toBe(1);
    expect(count('subagent_runs')).toBe(1);
    expect(replayed.getVerificationEvidence()).toHaveLength(1);
  });

  it('二次修改后重新复核：门禁不再被历史 stale 证据阻塞', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.commitEvent('file_modified', { filePath: 'doc.md', agentId: 'main' });
    await hub.commitEvent('file_read', { filePath: 'doc.md' });
    await hub.commitEvent('file_modified', { filePath: 'doc.md', agentId: 'main' });
    await hub.commitEvent('file_read', { filePath: 'doc.md' });

    expect(hub.getUnverifiedFiles()).toEqual([]);
    const gate = hub.canCompleteTask();
    expect(gate.ok).toBe(true);
  });

  it('重放不重写子代理完成时间', async () => {
    const hub = new ContextHub('sess-001', '/tmp/work');
    await hub.commitEvent('subagent_started', { id: 'sa-up', task: 't', role: 'research' });
    await hub.commitEvent('subagent_completed', { id: 'sa-up', status: 'completed', resultSummary: 'done' });
    const db = getDb();
    const before = db.prepare('SELECT completed_at FROM subagent_runs WHERE id = ?').get('sa-up') as { completed_at: string };
    expect(before.completed_at).toBeTruthy();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 60_000));
    try {
      new ContextHub('sess-001', '/tmp/work');
    } finally {
      vi.useRealTimers();
    }

    const after = db.prepare('SELECT completed_at FROM subagent_runs WHERE id = ?').get('sa-up') as { completed_at: string };
    expect(after.completed_at).toBe(before.completed_at);
  });
});
