import { v4 as uuid } from 'uuid';
import { getDb } from './db';

/**
 * 本地用户（Phase 1：本地身份体系）
 *
 * 每个本地用户是一个"本机身份"，拥有自己的显示名（头像预留）。
 * 首次启动自动创建一个默认用户并置为激活，保证应用始终有"当前使用者"概念。
 *
 * 设计要点：
 * - 表结构幂等创建，与 initContextTables() 同模式，不侵入 db.ts 的 schema 初始化
 * - 用 active_local_user 单行表记录当前激活身份（SQLite 没有会话状态概念）
 * - 不依赖任何云服务；未来 CloudBase 云账号绑定挂在这张表的 id 上（Phase 3）
 */
export interface LocalUser {
  id: string;
  displayName: string;
  /** 头像文件绝对路径（Phase 1 预留，UI 暂用显示名首字母） */
  avatarPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalUserPatch {
  displayName?: string;
  avatarPath?: string | null;
}

const DEFAULT_DISPLAY_NAME = 'Local User';

interface IdRow {
  id: string;
}

interface LocalUserRow {
  id: string;
  display_name: string;
  avatar_path: string | null;
  created_at: number;
  updated_at: number;
}

function rowToUser(row: LocalUserRow): LocalUser {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarPath: row.avatar_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 初始化本地用户表（幂等）。
 *
 * 调用时机：应用启动时（main.ts，initContextTables 之后）。
 * 首次调用会自动创建默认本地用户并置为激活。
 */
export function initLocalUsers(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 当前激活的本地身份（最多一行）
    CREATE TABLE IF NOT EXISTS active_local_user (
      id TEXT PRIMARY KEY,
      FOREIGN KEY (id) REFERENCES local_users(id) ON DELETE CASCADE
    );
  `);

  // 激活行有效（且指向存在的用户）→ 无需修复
  const active = db.prepare('SELECT id FROM active_local_user LIMIT 1').get() as IdRow | undefined;
  if (active) {
    const exists = db.prepare('SELECT id FROM local_users WHERE id = ?').get(active.id);
    if (exists) return;
    db.prepare('DELETE FROM active_local_user').run();
  }

  // 已有用户但激活行丢失 → 复活最早创建的那个
  const existing = db
    .prepare('SELECT id FROM local_users ORDER BY created_at ASC LIMIT 1')
    .get() as IdRow | undefined;
  if (existing) {
    db.prepare('INSERT INTO active_local_user (id) VALUES (?)').run(existing.id);
    return;
  }

  // 全新安装 → 创建默认用户
  const id = uuid();
  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO local_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, DEFAULT_DISPLAY_NAME, now, now);
    db.prepare('INSERT INTO active_local_user (id) VALUES (?)').run(id);
  });
  tx();
}

/** 当前激活的本地用户；极端情况下（表未初始化）返回 null */
export function getCurrentLocalUser(): LocalUser | null {
  const db = getDb();
  const active = db.prepare('SELECT id FROM active_local_user LIMIT 1').get() as IdRow | undefined;
  if (!active) return null;
  const row = db.prepare('SELECT * FROM local_users WHERE id = ?').get(active.id) as
    | LocalUserRow
    | undefined;
  return row ? rowToUser(row) : null;
}

/** 全部本地用户（按创建时间升序） */
export function listLocalUsers(): LocalUser[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM local_users ORDER BY created_at ASC')
    .all() as LocalUserRow[];
  return rows.map(rowToUser);
}

/** 更新指定本地用户的显示名 / 头像 */
export function updateLocalUser(id: string, patch: LocalUserPatch): LocalUser {
  const db = getDb();
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.avatarPath !== undefined) {
    sets.push('avatar_path = ?');
    values.push(patch.avatarPath);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    db.prepare(`UPDATE local_users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.prepare('SELECT * FROM local_users WHERE id = ?').get(id) as LocalUserRow | undefined;
  if (!row) throw new Error(`本地用户不存在: ${id}`);
  return rowToUser(row);
}

/** 新建本地用户；不自动切换激活态（由 switchLocalUser 显式切换） */
export function createLocalUser(displayName?: string): LocalUser {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const name = displayName?.trim() || DEFAULT_DISPLAY_NAME;
  db.prepare(
    'INSERT INTO local_users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, name, now, now);
  return { id, displayName: name, createdAt: now, updatedAt: now };
}

/** 切换当前激活的本地用户，返回切换后的身份 */
export function switchLocalUser(id: string): LocalUser {
  const db = getDb();
  const row = db.prepare('SELECT * FROM local_users WHERE id = ?').get(id) as LocalUserRow | undefined;
  if (!row) throw new Error(`本地用户不存在: ${id}`);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM active_local_user').run();
    db.prepare('INSERT INTO active_local_user (id) VALUES (?)').run(id);
  });
  tx();

  return rowToUser(row);
}
