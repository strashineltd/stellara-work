import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { saveMemory, deleteAllMemories, setMemoryDb } from './memory-store';

describe('memory-store', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, scope TEXT, scope_id TEXT, kind TEXT, content TEXT,
        source TEXT, importance REAL, confidence REAL, access_count INTEGER,
        tags TEXT, created_at INTEGER, updated_at INTEGER
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
});
