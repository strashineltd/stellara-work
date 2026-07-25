import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.stellara', 'stellara.db');
let dbPath: string | null = DEFAULT_DB_PATH;
let _db: Database.Database | null = null;

/** 测试 hook：指定 db 路径；传 null 恢复默认 */
export function _setDbPath(p: string | null): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  dbPath = p;
}

function getDb(): Database.Database {
  if (_db) return _db;
  if (!dbPath) throw new Error('dbPath 未设置');
  // 同步建目录（initDb 是同步入口）
  const dir = path.dirname(dbPath);
  // 用 sync 因为 better-sqlite3 是同步 API，且 getDb 在 sync 上下文用
  // 我们用 require 拿 fs 模块避免 async/await
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  fsSync.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL,
      work_dir TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      meta TEXT,
      plan_mode INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE (session_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, position);
  `);
  return _db;
}

export function initDb(): void {
  getDb();
}

export interface Session {
  id: string;
  title: string;
  modelId: string;
  workDir?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface MessageRow {
  sessionId: string;
  position: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: string;
  toolCallId?: string;
  toolName?: string;
  meta?: string;
  planMode?: number;
  createdAt: number;
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    title: row.title as string,
    modelId: row.model_id as string,
    workDir: (row.work_dir as string | null) ?? undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    messageCount: row.message_count as number,
  };
}

function rowToMessage(row: Record<string, unknown>): MessageRow {
  return {
    sessionId: row.session_id as string,
    position: row.position as number,
    role: row.role as 'user' | 'assistant' | 'tool',
    content: row.content as string,
    toolCalls: (row.tool_calls as string | null) ?? undefined,
    toolCallId: (row.tool_call_id as string | null) ?? undefined,
    toolName: (row.tool_name as string | null) ?? undefined,
    meta: (row.meta as string | null) ?? undefined,
    planMode: (row.plan_mode as number | null) ?? undefined,
    createdAt: row.created_at as number,
  };
}

export function listSessions(): Session[] {
  const rows = getDb()
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function getSession(id: string): Session | null {
  const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function createSession(s: { id: string; title: string; modelId: string; workDir?: string }): Session {
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO sessions (id, title, model_id, work_dir, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?, 0)',
    )
    .run(s.id, s.title, s.modelId, s.workDir ?? null, now, now);
  return { ...s, createdAt: now, updatedAt: now, messageCount: 0 };
}

export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function renameSession(id: string, title: string): void {
  getDb().prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
}

export function getMessages(sessionId: string): MessageRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY position ASC')
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function appendMessage(msg: MessageRow): void {
  getDb()
    .prepare(
      `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.sessionId,
      msg.position,
      msg.role,
      msg.content,
      msg.toolCalls ?? null,
      msg.toolCallId ?? null,
      msg.toolName ?? null,
      msg.meta ?? null,
      msg.planMode ?? 0,
      msg.createdAt,
    );
  bumpSession(msg.sessionId, msg.position + 1);
}

export function saveMessages(sessionId: string, msgs: MessageRow[]): void {
  const db = getDb();
  const tx = db.transaction((ms: MessageRow[]) => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of ms) {
      insert.run(
        m.sessionId,
        m.position,
        m.role,
        m.content,
        m.toolCalls ?? null,
        m.toolCallId ?? null,
        m.toolName ?? null,
        m.meta ?? null,
        m.planMode ?? 0,
        m.createdAt,
      );
    }
  });
  tx(msgs);
  bumpSession(sessionId, msgs.length);
}

export function bumpSession(id: string, messageCount: number): void {
  getDb()
    .prepare('UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?')
    .run(messageCount, Date.now(), id);
}

/** 关 db（app 退出时调，避免文件锁） */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export { uuid };
