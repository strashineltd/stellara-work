import Database from 'better-sqlite3';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { getAppDataDir } from '../config/data-dir';
import { bestEffortChmodSync } from '../security/file-permissions';
import type { ScheduledRun, ScheduledTask, ScheduledTaskPolicy } from '@shared/ipc';

let dbPathOverride: string | null = null;
let _db: Database.Database | null = null;

/** 按身份隔离归属的三张表（H10 本地身份隔离） */
const IDENTITY_TABLES = ['projects', 'sessions', 'memories'] as const;

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
  // M4：数据目录 0700（PII 库文件不应被同机其他用户读取）
  bestEffortChmodSync(dir, 0o700);
  _db = new Database(dbPath);
  bestEffortChmodSync(dbPath, 0o600);
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
      runtime TEXT NOT NULL DEFAULT 'local',
      server_id TEXT,
      remote_session_id TEXT,
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

    -- H10：键值元数据（一次性回填标记等）
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 已安排（调度器，v0.9.3）
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      project_id TEXT,
      work_dir TEXT,
      runtime TEXT NOT NULL DEFAULT 'local',
      server_id TEXT,
      model_id TEXT,
      schedule_kind TEXT NOT NULL,      -- 'once' | 'interval' | 'cron'
      schedule_expr TEXT NOT NULL,      -- ISO 时间 / 分钟数 / cron 表达式
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER,
      last_run_at INTEGER,
      last_status TEXT,
      allow_dangerous INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks(next_run_at);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id);

    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,             -- 'running' | 'success' | 'error' | 'missed' | 'aborted'
      session_id TEXT,
      error TEXT,
      user_id TEXT NOT NULL DEFAULT 'default',
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    );
  `);

  // 迁移必须先于 project_id 索引创建。旧版 sessions 表没有该列；
  // 如果先建索引，整个 schema 初始化会提前报错，迁移永远无法执行。
  const sessionColumns = _db
    .prepare('PRAGMA table_info(sessions)')
    .all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === 'project_id')) {
    _db.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT');
  }
  // 运行端字段（v0.9.3）：local 为默认，server 行记录服务器与远端会话映射
  if (!sessionColumns.some((column) => column.name === 'runtime')) {
    _db.exec("ALTER TABLE sessions ADD COLUMN runtime TEXT NOT NULL DEFAULT 'local'");
  }
  if (!sessionColumns.some((column) => column.name === 'server_id')) {
    _db.exec('ALTER TABLE sessions ADD COLUMN server_id TEXT');
  }
  if (!sessionColumns.some((column) => column.name === 'remote_session_id')) {
    _db.exec('ALTER TABLE sessions ADD COLUMN remote_session_id TEXT');
  }
  _db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)');
  _db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_server ON sessions(server_id)');

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

  // v0.10 定时任务写操作策略（旧库加列，幂等）
  const scheduledColumns = _db
    .prepare('PRAGMA table_info(scheduled_tasks)')
    .all() as Array<{ name: string }>;
  if (!scheduledColumns.some((column) => column.name === 'policy')) {
    _db.exec('ALTER TABLE scheduled_tasks ADD COLUMN policy TEXT');
  }

  // H10 本地身份隔离：三表补 user_id（幂等），旧数据默认归 'default' 档
  for (const table of IDENTITY_TABLES) {
    const columns = _db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'user_id')) {
      _db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
    }
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table}(user_id, updated_at DESC)`);
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

  // P8：messages 全文索引（session_id 关联），避免 searchSessions 全表 LIKE
  try {
    _db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(session_id UNINDEXED, position UNINDEXED, content, tokenize='unicode61')",
    );
  } catch {
    try {
      _db.exec('DROP TABLE IF EXISTS messages_fts');
      _db.exec(
        "CREATE VIRTUAL TABLE messages_fts USING fts5(session_id UNINDEXED, position UNINDEXED, content, tokenize='unicode61')",
      );
    } catch {
      // 忽略
    }
  }
  // 一次性回填：FTS 为空且 messages 有数据时建索引（幂等，空表跳过）
  try {
    const ftsCount = (_db.prepare('SELECT COUNT(*) AS c FROM messages_fts').get() as { c: number }).c;
    if (ftsCount === 0) {
      _db.exec(
        `INSERT INTO messages_fts (session_id, position, content)
         SELECT session_id, position, content FROM messages`,
      );
    }
  } catch {
    // 忽略回填失败（search 会走 LIKE 兜底）
  }

  // M4：schema/首次写入后 WAL/SHM 已创建，统一收紧权限（best-effort；Windows 上无效但不报错）
  bestEffortChmodSync(dbPath, 0o600);
  bestEffortChmodSync(`${dbPath}-wal`, 0o600);
  bestEffortChmodSync(`${dbPath}-shm`, 0o600);

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
  userId: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  runtime: 'local' | 'server';
  serverId?: string;
  remoteSessionId?: string;
}

export interface Project {
  id: string;
  name: string;
  workDir?: string;
  entryFile?: string;
  userId: string;
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
    modelId: (row.model_id as string | null) ?? '',
    workDir: (row.work_dir as string | null) ?? undefined,
    projectId: (row.project_id as string | null) ?? undefined,
    userId: (row.user_id as string | null) ?? 'default',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    messageCount: (row.message_count as number | null) ?? 0,
    runtime: ((row.runtime as string | null) ?? 'local') === 'server' ? 'server' : 'local',
    serverId: (row.server_id as string | null) ?? undefined,
    remoteSessionId: (row.remote_session_id as string | null) ?? undefined,
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    workDir: (row.work_dir as string | null) ?? undefined,
    entryFile: (row.entry_file as string | null) ?? undefined,
    userId: (row.user_id as string | null) ?? 'default',
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

export function listSessions(userId: string = 'default'): Session[] {
  const rows = getDb()
    .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/**
 * 内容/标题搜索会话（P8）：
 * - 标题 LIKE + 消息 FTS5 MATCH，单条 SQL 按 updated_at 排序并 LIMIT
 * - 含 LIKE 通配符等字面量时消息侧退回 LIKE（保证 `100%` 精确子串语义）
 * - 不再 listSessions 全量再过滤
 */
export function searchSessions(query: string, userId: string = 'default', limit = 50): string[] {
  const q = query.trim();
  if (!q) return [];
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const pattern = `%${escaped}%`;
  const db = getDb();
  // unicode61 对 CJK 短词与 `%`/`_` 字面量不可靠 → 这些走 LIKE 兜底
  const needsLiteralContent =
    /[%_\\]/.test(q) ||
    q.length < 3 ||
    /[㐀-䶿一-鿿豈-﫿]/.test(q);
  const ftsQuery = `"${q.replace(/"/g, '""')}"`;

  const run = (contentSql: string, contentParam: string): string[] => {
    const rows = db.prepare(
      `SELECT s.id AS id FROM sessions s
       WHERE s.user_id = ?
         AND (
           s.title LIKE ? ESCAPE '\\'
           OR s.id IN (SELECT session_id FROM messages m WHERE ${contentSql})
         )
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    ).all(userId, pattern, contentParam, limit) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  };

  if (needsLiteralContent) {
    return run(`m.content LIKE ? ESCAPE '\\'`, pattern);
  }
  try {
    return run(
      `session_id IN (SELECT session_id FROM messages_fts WHERE messages_fts MATCH ?)`,
      ftsQuery,
    );
  } catch {
    // FTS 语法错误 / 表不可用 → LIKE 兜底
    return run(`m.content LIKE ? ESCAPE '\\'`, pattern);
  }
}

export function getSession(id: string): Session | null {
  const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

/** 按 id 取会话；归属不匹配（跨身份访问）时返回 undefined */
export function getOwnedSession(id: string, userId: string): Session | undefined {
  const session = getSession(id);
  return session && session.userId === userId ? session : undefined;
}

/** 校验会话归属；不存在或跨身份访问抛「无权限访问该数据」。返回命中会话。 */
export function assertSessionOwned(id: string, userId: string): Session {
  const session = getOwnedSession(id, userId);
  if (!session) throw new Error('无权限访问该数据');
  return session;
}

/**
 * 把仍归属 'default' 的历史数据回填给指定身份，返回总变更行数。
 * 目标为 'default' 时视为无需回填，直接返回 0；重复调用因无匹配行返回 0（幂等）。
 */
export function migrateIdentityOwnership(userId: string): number {
  if (userId === 'default') return 0;
  const db = getDb();
  const run = db.transaction(() => {
    let changes = 0;
    for (const table of IDENTITY_TABLES) {
      changes += db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 'default'`).run(userId).changes;
    }
    return changes;
  });
  return run();
}

const IDENTITY_BACKFILL_KEY = 'identity_backfill_done';

/** H10：历史数据回填是否已完成（跨重启一次性标记）。 */
export function isIdentityBackfillDone(): boolean {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(IDENTITY_BACKFILL_KEY) as { value: string } | undefined;
  return row?.value === '1';
}

/** H10：回填成功后写入一次性标记。 */
export function markIdentityBackfillDone(): void {
  getDb()
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(IDENTITY_BACKFILL_KEY, '1');
}

export function createSession(s: {
  id: string;
  title: string;
  modelId: string;
  workDir?: string;
  projectId?: string;
  runtime?: 'local' | 'server';
  serverId?: string;
  remoteSessionId?: string;
  userId?: string;
}): Session {
  const now = Date.now();
  const runtime = s.runtime === 'server' ? 'server' : 'local';
  const userId = s.userId ?? 'default';
  getDb()
    .prepare(
      'INSERT INTO sessions (id, title, model_id, work_dir, project_id, created_at, updated_at, message_count, runtime, server_id, remote_session_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
    )
    .run(
      s.id, s.title, s.modelId, s.workDir ?? null, s.projectId ?? null, now, now,
      runtime, s.serverId ?? null, s.remoteSessionId ?? null, userId,
    );
  return {
    id: s.id,
    title: s.title,
    modelId: s.modelId,
    workDir: s.workDir,
    projectId: s.projectId,
    userId,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    runtime,
    serverId: s.serverId,
    remoteSessionId: s.remoteSessionId,
  };
}

/**
 * 按服务器 + 远端会话查找映射行。
 * 传入 userId 时仅命中该身份的映射行（H10：服务器会话按身份隔离）。
 */
export function findSessionByRemote(serverId: string, remoteSessionId: string, userId?: string): Session | undefined {
  const row = (userId === undefined
    ? getDb()
        .prepare('SELECT * FROM sessions WHERE server_id = ? AND remote_session_id = ?')
        .get(serverId, remoteSessionId)
    : getDb()
        .prepare('SELECT * FROM sessions WHERE server_id = ? AND remote_session_id = ? AND user_id = ?')
        .get(serverId, remoteSessionId, userId)) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

/**
 * 按远端会话 ID 查找映射行（不限 server_id），用于认领服务器重建后的孤儿映射。
 * 传入 userId 时仅命中该身份的映射行（避免认领他人行）。
 */
export function findSessionByRemoteId(remoteSessionId: string, userId?: string): Session | undefined {
  const row = (userId === undefined
    ? getDb()
        .prepare("SELECT * FROM sessions WHERE runtime = 'server' AND remote_session_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(remoteSessionId)
    : getDb()
        .prepare("SELECT * FROM sessions WHERE runtime = 'server' AND remote_session_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1")
        .get(remoteSessionId, userId)) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

/** 把映射行改挂到另一个服务器（不改变远端会话 ID）。 */
export function reassignServerSession(id: string, serverId: string): void {
  getDb().prepare('UPDATE sessions SET server_id = ? WHERE id = ?').run(serverId, id);
}

/** 某服务器的映射行；传入 userId 时仅返回该身份的行（H10）。 */
export function listServerSessions(serverId: string, userId?: string): Session[] {
  const rows = (userId === undefined
    ? getDb().prepare('SELECT * FROM sessions WHERE server_id = ? ORDER BY updated_at DESC').all(serverId)
    : getDb()
        .prepare('SELECT * FROM sessions WHERE server_id = ? AND user_id = ? ORDER BY updated_at DESC')
        .all(serverId, userId)) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

function clearMessagesFts(sessionId?: string): void {
  try {
    const db = getDb();
    if (sessionId) db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
    else db.prepare('DELETE FROM messages_fts').run();
  } catch { /* fts 可能未建 */ }
}

export function deleteSessionByRemote(serverId: string, remoteSessionId: string): void {
  const db = getDb();
  const doomed = db
    .prepare('SELECT id FROM sessions WHERE server_id = ? AND remote_session_id = ?')
    .all(serverId, remoteSessionId) as Array<{ id: string }>;
  db.prepare('DELETE FROM sessions WHERE server_id = ? AND remote_session_id = ?')
    .run(serverId, remoteSessionId);
  for (const row of doomed) clearMessagesFts(row.id);
}

export function updateSessionMeta(id: string, patch: { title?: string; updatedAt?: number; modelId?: string }): void {
  const sets: string[] = [];
  const params: Array<string | number> = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    params.push(patch.updatedAt);
  }
  if (patch.modelId !== undefined) {
    sets.push('model_id = ?');
    params.push(patch.modelId);
  }
  if (sets.length === 0) return;
  params.push(id);
  getDb().prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  clearMessagesFts(id);
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
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, attachments, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
  try {
    db.prepare('INSERT INTO messages_fts (session_id, position, content) VALUES (?, ?, ?)')
      .run(msg.sessionId, msg.position, msg.content);
  } catch { /* fts 可能未建 */ }
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
    // P1b：按 (session_id, position) upsert，避免流式期间 DELETE 全表再重插
    const upsert = db.prepare(
      `INSERT INTO messages (session_id, position, role, content, tool_calls, tool_call_id, tool_name, meta, plan_mode, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, position) DO UPDATE SET
         role = excluded.role,
         content = excluded.content,
         tool_calls = excluded.tool_calls,
         tool_call_id = excluded.tool_call_id,
         tool_name = excluded.tool_name,
         meta = excluded.meta,
         plan_mode = excluded.plan_mode,
         attachments = excluded.attachments,
         created_at = excluded.created_at`,
    );
    for (const m of ms) {
      upsert.run(
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
    // 历史变短（压缩/清空）时删掉多余 position
    db.prepare('DELETE FROM messages WHERE session_id = ? AND position >= ?').run(sessionId, ms.length);
    // P8：同步重建该会话的 FTS 索引
    try {
      db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
      const ftsInsert = db.prepare(
        'INSERT INTO messages_fts (session_id, position, content) VALUES (?, ?, ?)',
      );
      for (const m of ms) ftsInsert.run(m.sessionId, m.position, m.content);
    } catch { /* fts 可能未建 */ }
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

export function listProjects(userId: string = 'default'): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : null;
}

/** 校验项目归属；不存在或跨身份访问抛「无权限访问该数据」。返回命中项目。 */
export function assertProjectOwned(id: string, userId: string): Project {
  const project = getProject(id);
  if (!project || project.userId !== userId) throw new Error('无权限访问该数据');
  return project;
}

export function createProject(p: { id: string; name: string; workDir?: string; entryFile?: string; userId?: string }): Project {
  const now = Date.now();
  const userId = p.userId ?? 'default';
  getDb()
    .prepare('INSERT INTO projects (id, name, work_dir, entry_file, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(p.id, p.name, p.workDir ?? null, p.entryFile ?? null, now, now, userId);
  return { id: p.id, name: p.name, workDir: p.workDir, entryFile: p.entryFile, userId, createdAt: now, updatedAt: now };
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
  clearMessagesFts();
  return result.changes;
}

/** 删除某身份的全部会话及其消息（CASCADE），返回删除的会话数。 */
export function deleteSessionsByUser(userId: string): number {
  const db = getDb();
  const doomed = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId) as Array<{ id: string }>;
  const changes = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
  for (const row of doomed) clearMessagesFts(row.id);
  return changes;
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

// ============================================
// Context Hub 数据库表（v0.9.2）
// ============================================

import type { ContextEventEnvelope, VerificationEvidence, ContextCheckpoint } from '../../shared/ipc';

/**
 * 初始化 Context Hub 相关表（幂等）
 */
export function initContextTables(): void {
  const db = getDb();
  db.exec(`
    -- Responses Items 存储
    CREATE TABLE IF NOT EXISTS response_items (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      context_revision INTEGER NOT NULL,
      workspace_revision INTEGER NOT NULL,
      item_type TEXT NOT NULL,          -- 'message' | 'reasoning' | 'function_call' | 'function_call_output'
      item_data TEXT NOT NULL,          -- JSON 序列化的 ResponseItem
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_response_items_session ON response_items(session_id, sequence);

    -- Context Events 存储
    CREATE TABLE IF NOT EXISTS context_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      context_revision INTEGER NOT NULL,
      workspace_revision INTEGER NOT NULL,
      source_agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,                  -- JSON 序列化的事件附加数据
      created_at TEXT NOT NULL,         -- ISO 时间戳
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_context_events_session ON context_events(session_id, sequence);

    -- Context Checkpoints 存储
    CREATE TABLE IF NOT EXISTS context_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      context_revision INTEGER NOT NULL,
      workspace_revision INTEGER NOT NULL,
      objective TEXT NOT NULL,
      constraints TEXT NOT NULL,        -- JSON 数组
      decisions TEXT NOT NULL,          -- JSON 数组
      files_changed TEXT NOT NULL,      -- JSON 数组
      verification TEXT NOT NULL,       -- JSON 数组
      failures TEXT NOT NULL,           -- JSON 数组
      plan_state TEXT NOT NULL,         -- JSON 数组
      pending_work TEXT NOT NULL,       -- JSON 数组
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON context_checkpoints(session_id, context_revision);

    -- Verification Evidence 存储
    CREATE TABLE IF NOT EXISTS verification_evidence (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,               -- 'file_reread' | 'typecheck' | 'test' | 'build' | 'manual'
      command TEXT,
      related_files TEXT NOT NULL,      -- JSON 数组
      plan_step_ids TEXT NOT NULL,      -- JSON 数组
      workspace_revision INTEGER NOT NULL,
      ok INTEGER NOT NULL,              -- 0 或 1
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stale INTEGER DEFAULT 0,          -- 1 表示已过期
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_session ON verification_evidence(session_id, workspace_revision);

    -- Subagent Runs 存储
    CREATE TABLE IF NOT EXISTS subagent_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parent_agent_id TEXT NOT NULL,
      role TEXT NOT NULL,               -- 'research' | 'build' | 'verify'
      model_id TEXT,
      task TEXT NOT NULL,
      status TEXT NOT NULL,             -- 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      context_revision INTEGER NOT NULL,
      workspace_revision INTEGER NOT NULL,
      result_data TEXT,                 -- JSON 序列化的 SubagentContextResult
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_session ON subagent_runs(session_id, status);
  `);
}

/**
 * 插入 Context Event（单写者串行队列）
 */
export function insertContextEvent(event: ContextEventEnvelope): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO context_events (id, session_id, sequence, context_revision, workspace_revision, source_agent_id, event_type, event_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.sessionId,
    event.sequence,
    event.contextRevision,
    event.workspaceRevision,
    event.sourceAgentId,
    event.event,
    event.data ? JSON.stringify(event.data) : null,
    event.createdAt,
  );
}

/**
 * 查询 session 的 Context Events（按 sequence 排序）
 */
export function getContextEventsBySession(sessionId: string, limit?: number): ContextEventEnvelope[] {
  const db = getDb();
  const query = limit
    ? 'SELECT * FROM context_events WHERE session_id = ? ORDER BY sequence DESC LIMIT ?'
    : 'SELECT * FROM context_events WHERE session_id = ? ORDER BY sequence ASC';
  const rows = limit
    ? db.prepare(query).all(sessionId, limit) as Record<string, unknown>[]
    : db.prepare(query).all(sessionId) as Record<string, unknown>[];

  // 如果用了 limit（倒序），再反转为正序
  const ordered = limit ? rows.reverse() : rows;

  return ordered.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    sourceAgentId: row.source_agent_id as string,
    event: row.event_type as ContextEventEnvelope['event'],
    data: row.event_data ? JSON.parse(row.event_data as string) : undefined,
    createdAt: row.created_at as string,
  }));
}

/**
 * 获取 session 的最大 sequence
 */
export function getMaxSequence(sessionId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT MAX(sequence) as max_seq FROM context_events WHERE session_id = ?').get(sessionId) as { max_seq: number | null } | undefined;
  return row?.max_seq ?? 0;
}

/**
 * 插入 Response Item
 */
export function insertResponseItem(item: {
  id: string;
  sessionId: string;
  sequence: number;
  contextRevision: number;
  workspaceRevision: number;
  itemType: string;
  itemData: unknown;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO response_items (id, session_id, sequence, context_revision, workspace_revision, item_type, item_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.sessionId,
    item.sequence,
    item.contextRevision,
    item.workspaceRevision,
    item.itemType,
    JSON.stringify(item.itemData),
    Date.now(),
  );
}

/**
 * 查询 session 的 Response Items（按 sequence 排序）。
 * P5：`offset` 跳过压缩窗口之前的行，避免 JSON.parse 全表。
 */
export function getResponseItemsBySession(
  sessionId: string,
  offset = 0,
): Array<{
  id: string;
  sessionId: string;
  sequence: number;
  contextRevision: number;
  workspaceRevision: number;
  itemType: string;
  itemData: unknown;
}> {
  const db = getDb();
  const rows = (
    offset > 0
      ? db.prepare('SELECT * FROM response_items WHERE session_id = ? ORDER BY sequence ASC LIMIT -1 OFFSET ?')
          .all(sessionId, offset) as Record<string, unknown>[]
      : db.prepare('SELECT * FROM response_items WHERE session_id = ? ORDER BY sequence ASC')
          .all(sessionId) as Record<string, unknown>[]
  );
  return rows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    itemType: row.item_type as string,
    itemData: JSON.parse(row.item_data as string),
  }));
}

/**
 * 取某类型最新一条 Context Event（P5：用于定位压缩窗口，无需全量回放）。
 */
export function getLastContextEventByType(
  sessionId: string,
  eventType: ContextEventEnvelope['event'],
): ContextEventEnvelope | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM context_events WHERE session_id = ? AND event_type = ? ORDER BY sequence DESC LIMIT 1',
  ).get(sessionId, eventType) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    sourceAgentId: row.source_agent_id as string,
    event: row.event_type as ContextEventEnvelope['event'],
    data: row.event_data ? JSON.parse(row.event_data as string) : undefined,
    createdAt: row.created_at as string,
  };
}

/**
 * 查询 sequence >= sinceSequence 的 Context Events（P5：跳过压缩前历史）。
 */
export function getContextEventsSince(
  sessionId: string,
  sinceSequence: number,
): ContextEventEnvelope[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM context_events WHERE session_id = ? AND sequence >= ? ORDER BY sequence ASC',
  ).all(sessionId, sinceSequence) as Record<string, unknown>[];
  return rows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    sourceAgentId: row.source_agent_id as string,
    event: row.event_type as ContextEventEnvelope['event'],
    data: row.event_data ? JSON.parse(row.event_data as string) : undefined,
    createdAt: row.created_at as string,
  }));
}

/**
 * 插入 Verification Evidence
 */
export function insertVerificationEvidence(evidence: VerificationEvidence & { sessionId: string }): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO verification_evidence (id, session_id, kind, command, related_files, plan_step_ids, workspace_revision, ok, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidence.id,
    evidence.sessionId,
    evidence.kind,
    evidence.command ?? null,
    JSON.stringify(evidence.relatedFiles),
    JSON.stringify(evidence.planStepIds),
    evidence.workspaceRevision,
    evidence.ok ? 1 : 0,
    evidence.summary,
    evidence.createdAt,
  );
}

/**
 * 查询 session 的 Verification Evidence
 */
export function getVerificationEvidenceBySession(sessionId: string): Array<VerificationEvidence & { stale: boolean }> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM verification_evidence WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Record<string, unknown>[];
  return rows.map(row => ({
    id: row.id as string,
    kind: row.kind as VerificationEvidence['kind'],
    command: (row.command as string | null) ?? undefined,
    relatedFiles: JSON.parse(row.related_files as string),
    planStepIds: JSON.parse(row.plan_step_ids as string),
    workspaceRevision: row.workspace_revision as number,
    ok: row.ok === 1,
    summary: row.summary as string,
    createdAt: row.created_at as string,
    stale: row.stale === 1,
  }));
}

/**
 * 标记 Evidence 为 stale（文件修改后调用）
 */
export function markEvidenceStale(sessionId: string, workspaceRevision: number): number {
  const db = getDb();
  const result = db.prepare(
    'UPDATE verification_evidence SET stale = 1 WHERE session_id = ? AND workspace_revision < ?',
  ).run(sessionId, workspaceRevision);
  return result.changes;
}

/**
 * 插入 Context Checkpoint
 */
export function insertContextCheckpoint(checkpoint: ContextCheckpoint): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO context_checkpoints (id, session_id, context_revision, workspace_revision, objective, constraints, decisions, files_changed, verification, failures, plan_state, pending_work, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkpoint.id,
    checkpoint.sessionId,
    checkpoint.contextRevision,
    checkpoint.workspaceRevision,
    checkpoint.objective,
    JSON.stringify(checkpoint.constraints),
    JSON.stringify(checkpoint.decisions),
    JSON.stringify(checkpoint.filesChanged),
    JSON.stringify(checkpoint.verification),
    JSON.stringify(checkpoint.failures),
    JSON.stringify(checkpoint.planState),
    JSON.stringify(checkpoint.pendingWork),
    checkpoint.createdAt,
  );
}

/**
 * 获取 session 最新的 Checkpoint
 */
export function getLatestCheckpoint(sessionId: string): ContextCheckpoint | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM context_checkpoints WHERE session_id = ? ORDER BY context_revision DESC LIMIT 1').get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    objective: row.objective as string,
    constraints: JSON.parse(row.constraints as string),
    decisions: JSON.parse(row.decisions as string),
    filesChanged: JSON.parse(row.files_changed as string),
    verification: JSON.parse(row.verification as string),
    failures: JSON.parse(row.failures as string),
    planState: JSON.parse(row.plan_state as string),
    pendingWork: JSON.parse(row.pending_work as string),
    createdAt: row.created_at as string,
  };
}

/**
 * 插入 Subagent Run
 */
export function insertSubagentRun(run: {
  id: string;
  sessionId: string;
  parentAgentId: string;
  role: 'research' | 'build' | 'verify';
  modelId?: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  contextRevision: number;
  workspaceRevision: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO subagent_runs (id, session_id, parent_agent_id, role, model_id, task, status, context_revision, workspace_revision, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.sessionId,
    run.parentAgentId,
    run.role,
    run.modelId ?? null,
    run.task,
    run.status,
    run.contextRevision,
    run.workspaceRevision,
    new Date().toISOString(),
  );
}

/**
 * 更新 Subagent Run 状态
 */
export function updateSubagentRun(id: string, status: string, resultData?: unknown): void {
  const db = getDb();
  db.prepare(`
    UPDATE subagent_runs SET status = ?, result_data = ?, completed_at = ? WHERE id = ?
  `).run(status, resultData ? JSON.stringify(resultData) : null, new Date().toISOString(), id);
}

/**
 * 查询 session 的 Subagent Runs
 */
export function getSubagentRunsBySession(sessionId: string): Array<{
  id: string;
  sessionId: string;
  parentAgentId: string;
  role: string;
  modelId?: string;
  task: string;
  status: string;
  contextRevision: number;
  workspaceRevision: number;
  resultData?: unknown;
  createdAt: string;
  completedAt?: string;
}> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM subagent_runs WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as Record<string, unknown>[];
  return rows.map(row => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    parentAgentId: row.parent_agent_id as string,
    role: row.role as string,
    modelId: (row.model_id as string | null) ?? undefined,
    task: row.task as string,
    status: row.status as string,
    contextRevision: row.context_revision as number,
    workspaceRevision: row.workspace_revision as number,
    resultData: row.result_data ? JSON.parse(row.result_data as string) : undefined,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string | null) ?? undefined,
  }));
}

// ============================================
// 调度器（已安排）仓储（v0.9.3）
// ============================================

function rowToScheduledTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    name: row.name as string,
    prompt: row.prompt as string,
    projectId: (row.project_id as string | null) ?? undefined,
    workDir: (row.work_dir as string | null) ?? undefined,
    runtime: ((row.runtime as string | null) ?? 'local') === 'server' ? 'server' : 'local',
    serverId: (row.server_id as string | null) ?? undefined,
    modelId: (row.model_id as string | null) ?? undefined,
    scheduleKind: row.schedule_kind as ScheduledTask['scheduleKind'],
    scheduleExpr: row.schedule_expr as string,
    enabled: row.enabled === 1,
    nextRunAt: (row.next_run_at as number | null) ?? null,
    lastRunAt: (row.last_run_at as number | null) ?? null,
    lastStatus: (row.last_status as string | null) ?? null,
    policy: parseStoredPolicy(row.policy),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    userId: (row.user_id as string | null) ?? 'default',
  };
}

function parseStoredPolicy(value: unknown): ScheduledTask['policy'] {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return JSON.parse(value) as ScheduledTask['policy'];
  } catch {
    return undefined;
  }
}

function rowToScheduledRun(row: Record<string, unknown>): ScheduledRun {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    startedAt: row.started_at as number,
    finishedAt: (row.finished_at as number | null) ?? null,
    status: row.status as ScheduledRun['status'],
    sessionId: (row.session_id as string | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
    userId: (row.user_id as string | null) ?? 'default',
  };
}

export function listScheduledTasks(userId: string = 'default'): ScheduledTask[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToScheduledTask);
}

export function getScheduledTask(id: string): ScheduledTask | null {
  const row = getDb().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToScheduledTask(row) : null;
}

/** 按 id 取任务；归属不匹配（跨身份访问）时返回 undefined */
export function getOwnedScheduledTask(id: string, userId: string): ScheduledTask | undefined {
  const task = getScheduledTask(id);
  return task && task.userId === userId ? task : undefined;
}

/** 校验任务归属；不存在或跨身份访问抛「无权限访问该数据」。返回命中任务。 */
export function assertScheduledTaskOwned(id: string, userId: string): ScheduledTask {
  const task = getOwnedScheduledTask(id, userId);
  if (!task) throw new Error('无权限访问该数据');
  return task;
}

export function createScheduledTask(input: {
  id: string;
  name: string;
  prompt: string;
  projectId?: string;
  workDir?: string;
  runtime?: 'local' | 'server';
  serverId?: string;
  modelId?: string;
  scheduleKind: ScheduledTask['scheduleKind'];
  scheduleExpr: string;
  enabled?: boolean;
  nextRunAt?: number | null;
  /** 写操作预声明策略（缺省 = 只读） */
  policy?: ScheduledTaskPolicy;
  userId?: string;
}): ScheduledTask {
  const now = Date.now();
  const runtime = input.runtime === 'server' ? 'server' : 'local';
  const enabled = input.enabled ?? true;
  const nextRunAt = input.nextRunAt ?? null;
  const userId = input.userId ?? 'default';
  getDb()
    .prepare(
      `INSERT INTO scheduled_tasks (id, name, prompt, project_id, work_dir, runtime, server_id, model_id, schedule_kind, schedule_expr, enabled, next_run_at, policy, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id, input.name, input.prompt, input.projectId ?? null, input.workDir ?? null,
      runtime, input.serverId ?? null, input.modelId ?? null, input.scheduleKind, input.scheduleExpr,
      enabled ? 1 : 0, nextRunAt, input.policy ? JSON.stringify(input.policy) : null, now, now, userId,
    );
  return {
    id: input.id,
    name: input.name,
    prompt: input.prompt,
    projectId: input.projectId,
    workDir: input.workDir,
    runtime,
    serverId: input.serverId,
    modelId: input.modelId,
    scheduleKind: input.scheduleKind,
    scheduleExpr: input.scheduleExpr,
    enabled,
    nextRunAt,
    lastRunAt: null,
    lastStatus: null,
    policy: input.policy,
    createdAt: now,
    updatedAt: now,
    userId,
  };
}

/** 局部更新任务；id 不存在抛「任务不存在或已被删除」。userId 不可更改。 */
export function updateScheduledTask(id: string, patch: {
  name?: string;
  prompt?: string;
  projectId?: string | null;
  workDir?: string | null;
  runtime?: 'local' | 'server';
  serverId?: string | null;
  modelId?: string | null;
  scheduleKind?: ScheduledTask['scheduleKind'];
  scheduleExpr?: string;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastStatus?: string | null;
  /** 写操作预声明策略；null 显式清空，undefined 不动 */
  policy?: ScheduledTaskPolicy | null;
}): ScheduledTask {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  const add = (column: string, value: string | number | null): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.prompt !== undefined) add('prompt', patch.prompt);
  if (patch.projectId !== undefined) add('project_id', patch.projectId);
  if (patch.workDir !== undefined) add('work_dir', patch.workDir);
  if (patch.runtime !== undefined) add('runtime', patch.runtime === 'server' ? 'server' : 'local');
  if (patch.serverId !== undefined) add('server_id', patch.serverId);
  if (patch.modelId !== undefined) add('model_id', patch.modelId);
  if (patch.scheduleKind !== undefined) add('schedule_kind', patch.scheduleKind);
  if (patch.scheduleExpr !== undefined) add('schedule_expr', patch.scheduleExpr);
  if (patch.enabled !== undefined) add('enabled', patch.enabled ? 1 : 0);
  if (patch.nextRunAt !== undefined) add('next_run_at', patch.nextRunAt);
  if (patch.lastRunAt !== undefined) add('last_run_at', patch.lastRunAt);
  if (patch.lastStatus !== undefined) add('last_status', patch.lastStatus);
  if (patch.policy !== undefined) add('policy', patch.policy ? JSON.stringify(patch.policy) : null);
  if (sets.length > 0) {
    add('updated_at', Date.now());
    params.push(id);
    const result = getDb()
      .prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
    if (result.changes !== 1) throw new Error('任务不存在或已被删除');
  }
  const task = getScheduledTask(id);
  if (!task) throw new Error('任务不存在或已被删除');
  return task;
}

/** 删除任务（执行记录经外键 CASCADE 一并删除）；id 不存在抛「任务不存在或已被删除」。 */
export function deleteScheduledTask(id: string): void {
  const result = getDb().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
  if (result.changes !== 1) throw new Error('任务不存在或已被删除');
}

/**
 * 记录一次执行：按 run.id upsert。首次插入（通常 status='running'），
 * 后续只更新调用方提供的字段（status / finishedAt / sessionId / error）。
 * user_id 取调用方传入，缺省继承任务归属。
 */
export function recordRun(taskId: string, run: ScheduledRun): void {
  const db = getDb();
  const task = getScheduledTask(taskId);
  if (!task) throw new Error('任务不存在或已被删除');
  const exists = db.prepare('SELECT 1 AS present FROM scheduled_runs WHERE id = ?').get(run.id);
  if (!exists) {
    db.prepare(
      `INSERT INTO scheduled_runs (id, task_id, started_at, finished_at, status, session_id, error, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id, taskId, run.startedAt, run.finishedAt ?? null, run.status,
      run.sessionId ?? null, run.error ?? null, run.userId ?? task.userId ?? 'default',
    );
    return;
  }
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (run.status !== undefined) { sets.push('status = ?'); params.push(run.status); }
  if (run.finishedAt !== undefined) { sets.push('finished_at = ?'); params.push(run.finishedAt); }
  if (run.sessionId !== undefined) { sets.push('session_id = ?'); params.push(run.sessionId); }
  if (run.error !== undefined) { sets.push('error = ?'); params.push(run.error); }
  if (sets.length === 0) return;
  params.push(run.id);
  db.prepare(`UPDATE scheduled_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function listRuns(taskId: string, limit: number = 20): ScheduledRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?')
    .all(taskId, limit) as Record<string, unknown>[];
  return rows.map(rowToScheduledRun);
}

/** 只保留任务最近 keep 条执行记录，返回删除条数 */
export function pruneRuns(taskId: string, keep: number = 200): number {
  return getDb()
    .prepare(
      `DELETE FROM scheduled_runs
       WHERE task_id = ?
         AND id NOT IN (
           SELECT id FROM scheduled_runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?
         )`,
    )
    .run(taskId, taskId, keep).changes;
}
