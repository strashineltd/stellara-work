import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SubagentCoordinator } from './subagent-coordinator';
import { ContextHub } from '../context/context-hub';
import { _setDbPath, getDb, createSession, initContextTables } from '../store/db';
import type { SubagentDef, SubagentContextResult } from '../../shared/ipc';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-sa-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initContextTables();
  createSession({ id: 'sess-001', title: 'Test', modelId: 'test' });
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SubagentCoordinator', () => {
  it('初始化空协调器', () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const coordinator = new SubagentCoordinator('sess-001', hub);

    expect(coordinator.getState()).toHaveLength(0);
  });

  it('dispatch 批量请求', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const coordinator = new SubagentCoordinator('sess-001', hub);

    // 模拟子代理执行器
    coordinator.setRunner(async (task, id) => {
      return { summary: `完成: ${task}`, ok: true };
    });

    const defs: SubagentDef[] = [
      { id: 'sa-1', task: '写测试', role: 'verify' },
      { id: 'sa-2', task: '重构代码', role: 'build', fileScopes: ['src/**'] },
    ];

    const result = await coordinator.dispatch(defs);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.ok).toBe(true);
    expect(result.results[1]!.ok).toBe(true);
  });

  it('cancel 取消所有子代理', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const coordinator = new SubagentCoordinator('sess-001', hub);

    let cancelReceived = false;
    coordinator.setRunner(async (task, id, signal) => {
      // 延迟一点确保 abort 已设置
      await new Promise(r => setTimeout(r, 10));
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          cancelReceived = true;
          reject(new Error('cancelled'));
          return;
        }
        signal.addEventListener('abort', () => {
          cancelReceived = true;
          reject(new Error('cancelled'));
        });
        setTimeout(() => resolve({ summary: 'done', ok: true }), 100);
      });
    });

    const defs: SubagentDef[] = [
      { id: 'sa-1', task: 'long task', role: 'verify' },
    ];

    // 启动后延迟取消
    const dispatchPromise = coordinator.dispatch(defs);
    await new Promise(r => setTimeout(r, 50));
    coordinator.cancel();

    const result = await dispatchPromise;
    expect(cancelReceived).toBe(true);
    expect(result.results[0]!.ok).toBe(false);
  });

  it('getState 返回子代理状态', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const coordinator = new SubagentCoordinator('sess-001', hub);

    coordinator.setRunner(async () => ({ summary: 'done', ok: true }));

    const defs: SubagentDef[] = [
      { id: 'sa-1', task: 'test', role: 'verify' },
    ];

    await coordinator.dispatch(defs);
    const state = coordinator.getState();

    expect(state).toHaveLength(1);
    expect(state[0]!.id).toBe('sa-1');
    expect(state[0]!.status).toBe('completed');
  });

  it('验证 fileScopes 冲突', async () => {
    const hub = new ContextHub('sess-001', tmpDir);
    const coordinator = new SubagentCoordinator('sess-001', hub);

    coordinator.setRunner(async () => ({ summary: 'done', ok: true }));

    const defs: SubagentDef[] = [
      { id: 'sa-1', task: 'test', role: 'build', fileScopes: ['src/a.ts'] },
      { id: 'sa-2', task: 'test', role: 'build', fileScopes: ['src/a.ts'] },
    ];

    const result = await coordinator.dispatch(defs);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toContain('fileScopes 冲突');
  });
});
