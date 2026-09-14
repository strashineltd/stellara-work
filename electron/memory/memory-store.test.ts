import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  saveMemory, deleteAllMemories, setMemoryDb, listMemories, searchMemories,
  assertMemoryOwned, deleteMemoriesByUser,
} from './memory-store';

describe('memory-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT, scope_id TEXT, kind TEXT, content TEXT,
        source TEXT, importance REAL, confidence REAL, access_count INTEGER,
        tags TEXT, created_at INTEGER, updated_at INTEGER,
        user_id TEXT NOT NULL DEFAULT 'default'
      );
    `);
    db.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, content, tags, tokenize='unicode61')`);
    setMemoryDb(() => db);
  });

  it('deleteAllMemories 删除全部记忆并返回条数', () => {
    saveMemory({ scope: 'personal', kind: 'preference', content: '喜欢简洁界面' });
    saveMemory({ scope: 'project', scopeId: 'p1', kind: 'decision', content: '用 SQLite 存储' });

    const count = deleteAllMemories();

    expect(count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories_fts').get() as { n: number }).toEqual({ n: 0 });
  });

  it('deleteAllMemories 空库返回 0', () => {
    expect(deleteAllMemories()).toBe(0);
  });

  it('saves and searches memories with kind web', async () => {
    const m = saveMemory({
      scope: 'personal',
      kind: 'web',
      content: 'Electron 43 支持 WebContentsView（调研结论）',
      importance: 0.7,
      tags: ['electron'],
    });
    expect(m.kind).toBe('web');
    const byKind = listMemories({ kind: 'web' });
    expect(byKind.some((x) => x.id === m.id)).toBe(true);
    const found = searchMemories({ query: 'WebContentsView' });
    expect(found.some((x) => x.id === m.id)).toBe(true);
  });

  it('assertMemoryOwned 拒绝跨身份与不存在的记忆', () => {
    const m = saveMemory({ scope: 'personal', kind: 'fact', content: 'u1 的记忆', userId: 'u1' });

    expect(assertMemoryOwned(m.id, 'u1').id).toBe(m.id);
    expect(() => assertMemoryOwned(m.id, 'u2')).toThrow(/无权限访问该数据/);
    expect(() => assertMemoryOwned('missing', 'u1')).toThrow(/无权限访问该数据/);
  });

  it('deleteMemoriesByUser 只删除目标身份并清理其 FTS 索引', () => {
    const a = saveMemory({ scope: 'personal', kind: 'fact', content: '甲的偏好', userId: 'u1' });
    const b = saveMemory({ scope: 'personal', kind: 'fact', content: '乙的偏好', userId: 'u2' });
    saveMemory({ scope: 'personal', kind: 'fact', content: '默认档的记忆' });

    expect(deleteMemoriesByUser('u1')).toBe(1);
    expect(listMemories(undefined, 'u1')).toEqual([]);
    expect(listMemories(undefined, 'u2').map((m) => m.id)).toEqual([b.id]);
    expect(listMemories(undefined, 'default')).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories_fts WHERE memory_id = ?').get(a.id)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memories_fts WHERE memory_id = ?').get(b.id)).toEqual({ n: 1 });
    expect(deleteMemoriesByUser('u1')).toBe(0);
  });
});
