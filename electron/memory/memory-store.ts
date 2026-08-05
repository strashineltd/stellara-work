/**
 * Memory OS — 记忆存储层
 *
 * 基于 SQLite + FTS5 的记忆 CRUD 和全文搜索。
 * FTS5 使用 memory_id UNINDEXED 字段关联，而非 rowid（UUID 不能作为 rowid）。
 */

import { v4 as uuid } from 'uuid';
import type { Memory, MemoryStats } from '../../shared/ipc';

// 复用 db.ts 的 getDb
let _getDb: () => import('better-sqlite3').Database;

/** 注入 db getter（由 main.ts 在 initDb 后调用） */
export function setMemoryDb(getter: () => import('better-sqlite3').Database): void {
  _getDb = getter;
}

function getDb() {
  if (!_getDb) throw new Error('Memory DB 未初始化');
  return _getDb();
}

/** 安静获取 DB（用于 Agent 注入，失败时返回 null） */
function getDbSafe() {
  try { return _getDb?.() ?? null; } catch { return null; }
}

// ---- Row mapper ----

function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    scope: row.scope as Memory['scope'],
    scopeId: (row.scope_id as string | null) ?? undefined,
    kind: row.kind as Memory['kind'],
    content: row.content as string,
    source: (row.source as string | null) ?? undefined,
    importance: row.importance as number,
    confidence: row.confidence as number,
    accessCount: row.access_count as number,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// ---- CRUD ----

export function saveMemory(opts: {
  scope: Memory['scope'];
  scopeId?: string;
  kind: Memory['kind'];
  content: string;
  source?: string;
  importance?: number;
  confidence?: number;
  tags?: string[];
}): Memory {
  const db = getDb();
  const now = Date.now();
  const id = uuid();
  const memory: Memory = {
    id,
    scope: opts.scope,
    scopeId: opts.scopeId,
    kind: opts.kind,
    content: opts.content,
    source: opts.source,
    importance: opts.importance ?? 0.5,
    confidence: opts.confidence ?? 0.8,
    accessCount: 0,
    tags: opts.tags,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO memories (id, scope, scope_id, kind, content, source, importance, confidence, access_count, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, opts.scope, opts.scopeId ?? null, opts.kind, opts.content, opts.source ?? null,
    memory.importance, memory.confidence, opts.tags ? JSON.stringify(opts.tags) : null, now, now);

  // FTS5 索引：使用 memory_id UNINDEXED 字段（UUID 不能作为 rowid）
  try {
    db.prepare('INSERT INTO memories_fts (memory_id, content, tags) VALUES (?, ?, ?)')
      .run(id, opts.content, opts.tags?.join(' ') ?? '');
  } catch {
    // FTS5 可能未初始化，忽略
  }

  return memory;
}

export function searchMemories(opts: {
  query: string;
  scope?: Memory['scope'];
  kind?: Memory['kind'];
  limit?: number;
}): Memory[] {
  const db = getDb();
  const limit = opts.limit ?? 10;

  // FTS5 搜索（通过 memory_id 关联）
  let sql = `
    SELECT m.* FROM memories m
    INNER JOIN memories_fts f ON f.memory_id = m.id
    WHERE f MATCH ?
  `;
  const params: unknown[] = [opts.query];

  if (opts.scope) {
    sql += ' AND m.scope = ?';
    params.push(opts.scope);
  }
  if (opts.kind) {
    sql += ' AND m.kind = ?';
    params.push(opts.kind);
  }

  sql += ' ORDER BY m.importance DESC, m.confidence DESC LIMIT ?';
  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  } catch {
    // FTS5 查询语法错误时回退到 LIKE 搜索
    let fallback = `SELECT * FROM memories WHERE content LIKE ?`;
    const fbParams: unknown[] = [`%${opts.query}%`];
    if (opts.scope) { fallback += ' AND scope = ?'; fbParams.push(opts.scope); }
    if (opts.kind) { fallback += ' AND kind = ?'; fbParams.push(opts.kind); }
    fallback += ' ORDER BY importance DESC LIMIT ?';
    fbParams.push(limit);
    const rows = db.prepare(fallback).all(...fbParams) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  }
}

export function listMemories(opts?: {
  scope?: Memory['scope'];
  scopeId?: string;
  kind?: Memory['kind'];
  limit?: number;
  offset?: number;
}): Memory[] {
  const db = getDb();
  let sql = 'SELECT * FROM memories WHERE 1=1';
  const params: unknown[] = [];

  if (opts?.scope) { sql += ' AND scope = ?'; params.push(opts.scope); }
  if (opts?.scopeId) { sql += ' AND scope_id = ?'; params.push(opts.scopeId); }
  if (opts?.kind) { sql += ' AND kind = ?'; params.push(opts.kind); }

  sql += ' ORDER BY updated_at DESC';
  if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
  if (opts?.offset) { sql += ' OFFSET ?'; params.push(opts.offset); }

  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export function updateMemory(id: string, patch: {
  content?: string;
  importance?: number;
  tags?: string[];
}): void {
  const db = getDb();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [Date.now()];

  if (patch.content !== undefined) { sets.push('content = ?'); params.push(patch.content); }
  if (patch.importance !== undefined) { sets.push('importance = ?'); params.push(patch.importance); }
  if (patch.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(patch.tags)); }

  params.push(id);
  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  // 更新 FTS5
  if (patch.content !== undefined) {
    try {
      db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(id);
      const row = db.prepare('SELECT content, tags FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (row) {
        db.prepare('INSERT INTO memories_fts (memory_id, content, tags) VALUES (?, ?, ?)')
          .run(id, row.content, (row.tags ? JSON.parse(row.tags as string) : []).join(' '));
      }
    } catch {
      // FTS5 可能未初始化，忽略
    }
  }
}

export function deleteMemory(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  try { db.prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(id); } catch { /* ignore */ }
}

/** 删除全部记忆，返回删除的条数。 */
export function deleteAllMemories(): number {
  const db = getDb();
  try { db.prepare('DELETE FROM memories_fts').run(); } catch { /* FTS5 表可能不存在 */ }
  const result = db.prepare('DELETE FROM memories').run();
  return result.changes;
}

export function bumpAccess(id: string): void {
  const db = getDb();
  db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?')
    .run(Date.now(), id);
}

export function getMemoryStats(): MemoryStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;

  const byScope: Record<string, number> = {};
  for (const row of db.prepare('SELECT scope, COUNT(*) as c FROM memories GROUP BY scope').all() as { scope: string; c: number }[]) {
    byScope[row.scope] = row.c;
  }

  const byKind: Record<string, number> = {};
  for (const row of db.prepare('SELECT kind, COUNT(*) as c FROM memories GROUP BY kind').all() as { kind: string; c: number }[]) {
    byKind[row.kind] = row.c;
  }

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCount = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE created_at > ?').get(weekAgo) as { c: number }).c;

  return { total, byScope, byKind, recentCount };
}

/** 检查是否有高度相似的记忆（FTS5 精确短语搜索 + LIKE 兜底） */
export function findDuplicateMemory(content: string): Memory | null {
  const db = getDb();

  // 策略 1：FTS5 精确短语搜索（最高精度）
  try {
    const exactPhrase = content.slice(0, 100)
      .replace(/["'*()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (exactPhrase.length > 10) {
      const rows = db.prepare(`
        SELECT m.* FROM memories m
        INNER JOIN memories_fts f ON f.memory_id = m.id
        WHERE f MATCH ?
        LIMIT 1
      `).all(`"${exactPhrase}"`) as Record<string, unknown>[];
      if (rows.length > 0) return rowToMemory(rows[0]!);
    }
  } catch {
    // FTS5 语法错误或表不存在，回退到 LIKE
  }

  // 策略 2：LIKE 前缀匹配（兜底）
  const prefix = content.slice(0, 100);
  const row = db.prepare('SELECT * FROM memories WHERE content LIKE ? LIMIT 1')
    .get(`%${prefix}%`) as Record<string, unknown> | undefined;
  return row ? rowToMemory(row) : null;
}

/**
 * 安静版本：Agent 注入时使用，DB 未初始化时返回 null 而非抛错
 */
export function searchMemoriesSafe(opts: {
  query: string;
  scope?: Memory['scope'];
  kind?: Memory['kind'];
  limit?: number;
}): Memory[] | null {
  const db = getDbSafe();
  if (!db) return null;
  try {
    return searchMemories(opts);
  } catch {
    return null;
  }
}
