import Database from 'better-sqlite3';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { getAppDataDir } from '../config/data-dir';

let dbPathOverride: string | null = null;
let _db: Database.Database | null = null;

/** 测试 hook：指定 db 路径；传 null 恢复默认 */
export function _setDbPath(p: string | null): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  dbPathOverride = p;
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = dbPathOverride ?? path.join(getAppDataDir(), 'stellara.db');
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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      work_dir TEXT,
      entry_file TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL,
      work_dir TEXT,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
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
      attachments TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE (session_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, position);

    -- Memory OS: 记忆实体
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,           -- 'personal' | 'project' | 'workspace'
      scope_id TEXT,                 -- project_id 或 workspace_id（personal 时为 NULL）
      kind TEXT NOT NULL,            -- 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting'
      content TEXT NOT NULL,
      source TEXT,                   -- 'session:{id}' | 'manual' | 'extracted'
      importance REAL DEFAULT 0.5,
      confidence REAL DEFAULT 0.8,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER,
      embedding BLOB,
      tags TEXT,                     -- JSON 数组
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, scope_id);
    CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

    -- Memory OS: 知识实体
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,     -- 'person' | 'project' | 'document' | 'task' | 'code' | 'meeting' | 'decision'
      name TEXT NOT NULL,
      description TEXT,
      metadata TEXT,                 -- JSON
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type ON knowledge_entities(entity_type);

    -- Memory OS: 实体关系
    CREATE TABLE IF NOT EXISTS knowledge_relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,   -- 'related' | 'created' | 'referenced' | 'depends' | 'belongs_to'
      weight REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES knowledge_entities(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_relations_source ON knowledge_relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON knowledge_relations(target_id);
  `);

  // 迁移必须先于 project_id 索引创建。旧版 sessions 表没有该列；
  // 如果先建索引，整个 schema 初始化会提前报错，迁移永远无法执行。
  const sessionColumns = _db
    .prepare('PRAGMA table_info(sessions)')
    .all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === 'project_id')) {
    _db.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT');
  }
  _db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)');

  const projectColumns = _db
    .prepare('PRAGMA table_info(projects)')
    .all() as Array<{ name: string }>;
  if (!projectColumns.some((column) => column.name === 'entry_file')) {
    _db.exec('ALTER TABLE projects ADD COLUMN entry_file TEXT');
  }

  // 旧库 messages 表没有 attachments 列 → 迁移加列（存附件 JSON）
  const messageColumns = _db
    .prepare('PRAGMA table_info(messages)')
    .all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === 'attachments')) {
    _db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT');
  }

  // Memory OS: FTS5 全文搜索表（使用 memory_id UNINDEXED 关联，而非 rowid）
  try {
    _db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, content, tags, tokenize='unicode61')");
  } catch {
    // 表已存在但 schema 不同 → 尝试重建
    try {
      _db.exec('DROP TABLE IF EXISTS memories_fts');
      _db.exec("CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, content, tags, tokenize='unicode61')");
    } catch {
      // 忽略
    }
  }

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
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface Project {
  id: string;
  name: string;
  workDir?: string;
  entryFile?: string;
  createdAt: number;
  updatedAt: number;
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
  /** attachments JSON 字符串（对应 messages.attachments 列） */
  attachments?: string;
  createdAt: number;
}

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    title: row.title as string,
    modelId: row.model_id as string,
    workDir: (row.work_dir as string | null) ?? undefined,
    projectId: (row.project_id as string | null) ?? undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    messageCount: row.message_count as number,
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    workDir: (row.work_dir as string | null) ?? undefined,
    entryFile: (row.entry_file as string | null) ?? undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
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
    attachments: (row.attachments as string | null) ?? undefined,
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

export function createSession(s: { id: string; title: string; modelId: string; workDir?: string; projectId?: string }): Session {
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO sessions (id, title, model_id, work_dir, project_id, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    )
    .run(s.id, s.title, s.modelId, s.workDir ?? null, s.projectId ?? null, now, now);
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
      `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      msg.attachments ?? null,
      msg.createdAt,
    );
  bumpSession(msg.sessionId, msg.position + 1);
}

export function saveMessages(sessionId: string, msgs: MessageRow[]): void {
  // 静默跳过不存在的 session（autosave 在 race 条件下可能引用已删 session）
  if (!getSession(sessionId)) return;
  const db = getDb();
  // 只有消息数真的变化才 bump updated_at，否则切 session 时 autosave
  // 会把刚切到的 session 顶到列表最前面，看着像列表在跳
  const prevCount = (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?')
    .get(sessionId) as { n: number } | undefined)?.n ?? 0;
  const tx = db.transaction((ms: MessageRow[]) => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    const insert = db.prepare(
      `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        m.attachments ?? null,
        m.createdAt,
      );
    }
  });
  tx(msgs);
  if (msgs.length !== prevCount) {
    bumpSession(sessionId, msgs.length);
  }
}

export function bumpSession(id: string, messageCount: number): void {
  // 静默跳过不存在的 session
  if (!getSession(id)) return;
  getDb()
    .prepare('UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?')
    .run(messageCount, Date.now(), id);
}

/** 全部会话的消息总数（诊断用） */
export function countAllMessages(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number };
  return row?.c ?? 0;
}

// ---- Project CRUD ----

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(p: { id: string; name: string; workDir?: string; entryFile?: string }): Project {
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO projects (id, name, work_dir, entry_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(p.id, p.name, p.workDir ?? null, p.entryFile ?? null, now, now);
  return { id: p.id, name: p.name, workDir: p.workDir, entryFile: p.entryFile, createdAt: now, updatedAt: now };
}

export function updateProjectFile(id: string, workDir: string, entryFile: string): Project {
  const result = getDb()
    .prepare('UPDATE projects SET work_dir = ?, entry_file = ?, updated_at = ? WHERE id = ?')
    .run(workDir, entryFile, Date.now(), id);
  if (result.changes !== 1) throw new Error('项目不存在或已被删除');
  const project = getProject(id);
  if (!project) throw new Error('项目更新后无法读取');
  return project;
}

export function deleteProject(id: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    // 旧数据库通过 ALTER TABLE 添加 project_id，没有外键约束。
    // 显式解绑可以兼容新旧 schema，避免会话变成不可见的孤立记录。
    db.prepare('UPDATE sessions SET project_id = NULL, updated_at = ? WHERE project_id = ?')
      .run(Date.now(), id);
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (result.changes !== 1) throw new Error('项目不存在或已被删除');
  });
  run();
}

/** 删除所有会话及其消息（CASCADE） */
export function deleteAllSessions(): number {
  const result = getDb().prepare('DELETE FROM sessions').run();
  return result.changes;
}

/** 删除所有项目（会话的 project_id 置 NULL） */
export function deleteAllProjects(): number {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('UPDATE sessions SET project_id = NULL, updated_at = ?').run(Date.now());
    const result = db.prepare('DELETE FROM projects').run();
    return result.changes;
  });
  return run();
}

export function renameProject(id: string, name: string): void {
  const nextName = name.trim();
  if (!nextName) throw new Error('项目名称不能为空');
  const result = getDb()
    .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
    .run(nextName, Date.now(), id);
  if (result.changes !== 1) throw new Error('项目不存在或已被删除');
}

export function moveSession(sessionId: string, projectId: string | null): void {
  getDb().prepare('UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?').run(projectId, Date.now(), sessionId);
}

/** 关 db（app 退出时调，避免文件锁） */
export function closeDb(): void {
  if (_db) {
    // 关库前先 checkpoint WAL，把 -wal 文件 truncate 到 0，
    // 避免长期运行后 WAL 累积（每个 session autosave 都会写）
    try {
      _db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore — checkpoint 失败也不影响关库
    }
    _db.close();
    _db = null;
  }
}

/**
 * 主动跑一次 WAL checkpoint（TRUNCATE 模式）。
 *
 * 长期运行的 app 中，WAL 文件可能增长到几十 MB。SQLite 默认每 1000 页
 * 自动 checkpoint，但用户关窗口时未必恰好触发。给外部一个入口在合适
 * 时机（比如 app will-quit、低优先级时间片）调一下。
 */
export function checkpoint(): void {
  if (!_db) return;
  try {
    _db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // ignore
  }
}

export { uuid };
