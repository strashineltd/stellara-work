import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {
  initDb, createSession, getSession, findSessionByRemote, listServerSessions,
  deleteSessionByRemote, updateSessionMeta, _setDbPath,
} from './db';

let tmpDir: string;
let dbFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-db-'));
  dbFile = path.join(tmpDir, 'test.db');
  _setDbPath(dbFile);
  initDb();
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('server session rows', () => {
  it('migrates old sessions tables and stores runtime metadata', () => {
    const created = createSession({
      id: 's1', title: '远端会话', modelId: '', runtime: 'server',
      serverId: 'srv-1', remoteSessionId: 'ses_remote_1',
    });
    expect(created.runtime).toBe('server');
    expect(created.serverId).toBe('srv-1');
    expect(created.remoteSessionId).toBe('ses_remote_1');
    const reread = getSession('s1');
    expect(reread?.runtime).toBe('server');
    expect(reread?.serverId).toBe('srv-1');
    expect(reread?.remoteSessionId).toBe('ses_remote_1');
  });

  it('finds and deletes by remote mapping', () => {
    createSession({
      id: 's2', title: 'A', modelId: '', runtime: 'server',
      serverId: 'srv-1', remoteSessionId: 'ses_remote_2',
    });
    expect(findSessionByRemote('srv-1', 'ses_remote_2')?.id).toBe('s2');
    expect(findSessionByRemote('srv-1', 'nope')).toBeUndefined();
    expect(listServerSessions('srv-1').map((s) => s.id)).toEqual(['s2']);
    deleteSessionByRemote('srv-1', 'ses_remote_2');
    expect(findSessionByRemote('srv-1', 'ses_remote_2')).toBeUndefined();
  });

  it('defaults local sessions to runtime local and updates meta', () => {
    const local = createSession({ id: 'l1', title: '本地', modelId: 'm1' });
    expect(local.runtime).toBe('local');
    updateSessionMeta('l1', { title: '改名', updatedAt: 123 });
    const reread = getSession('l1');
    expect(reread?.title).toBe('改名');
    expect(reread?.updatedAt).toBe(123);
  });

  it('updates modelId through updateSessionMeta', () => {
    createSession({ id: 'l2', title: '本地', modelId: 'old' });
    updateSessionMeta('l2', { modelId: 'anthropic/claude-sonnet-4' });
    expect(getSession('l2')?.modelId).toBe('anthropic/claude-sonnet-4');
  });

  it('migrates a legacy sessions table by adding runtime columns', () => {
    const legacyFile = path.join(tmpDir, 'legacy.db');
    const legacyDb = new Database(legacyFile);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model_id TEXT NOT NULL,
        work_dir TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
      INSERT INTO sessions (id, title, model_id, created_at, updated_at, message_count)
      VALUES ('legacy-session', 'Legacy', 'm1', 1, 1, 0);
    `);
    legacyDb.close();

    _setDbPath(legacyFile);
    expect(() => initDb()).not.toThrow();

    const migrated = getSession('legacy-session');
    expect(migrated?.runtime).toBe('local');
    expect(migrated?.serverId).toBeUndefined();
    expect(migrated?.remoteSessionId).toBeUndefined();
    // 幂等：再次初始化不应重复 ALTER 或报错
    expect(() => initDb()).not.toThrow();
  });
});
