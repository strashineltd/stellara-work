import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ContextHub } from './context-hub';
import { estimateItemsTokens } from './token-estimator';
import { _setDbPath, getDb, createSession, initContextTables } from '../store/db';
import type { ResponseItem } from '../../shared/responses';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-compact-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initContextTables();
  createSession({ id: 'sess-001', title: 'Test', modelId: 'test' });
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('长会话压缩集成', () => {
  it('300 轮持续注入后活跃窗口有界且始终低于硬阈值', async () => {
    const hub = new ContextHub('sess-001', tmpDir, 40_000, 1_000);
    const hardLimit = hub.getContext().usage.hardThreshold;
    let compactionEvents = 0;

    for (let turn = 0; turn < 300; turn++) {
      const item: ResponseItem = {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `turn ${turn}: ${'x'.repeat(900)}` }],
      };
      hub.addResponseItem(item);
      const result = await hub.ensureContextBudget({});
      if (result.compacted) compactionEvents++;
      expect(estimateItemsTokens(hub.getResponseItems())).toBeLessThan(hardLimit);
    }

    expect(compactionEvents).toBeGreaterThan(0);
    expect(hub.getResponseItems().length).toBeLessThan(300);

    const reopened = new ContextHub('sess-001', tmpDir, 40_000, 1_000);
    expect(reopened.getResponseItems().length).toBe(hub.getResponseItems().length);
  });
});
