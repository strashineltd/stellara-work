import { getDb } from './db';

/**
 * 云账号绑定表（Phase 3）
 *
 * 数据边界：本表 **只存账号元数据**（云端 uid / 邮箱 / 用户名 / 昵称）。
 * 工作区、会话、记忆一概留在本机，绝不上云 —— 与 Phase 1 的 local-first 承诺一致。
 *
 * 关系：local_users.id (1) ── (1) cloud_uid
 * - 一个本地身份最多绑定一个云账号
 * - 一个云账号最多绑定一个本地身份（唯一索引兜底），避免同一账号在多身份间产生歧义
 *
 * 不声明 FOREIGN KEY：SQLite 默认 foreign_keys=OFF，且本地身份删除的级联
 * 由调用方显式清理（见 deleteLinkForLocalUser），不依赖 PRAGMA 是否开启。
 */

export interface CloudLink {
  /** local_users.id */
  localUserId: string;
  /** CloudBase 用户 uid */
  cloudUid: string;
  email?: string;
  username?: string;
  /** 云端昵称（CloudBase user_metadata.name） */
  displayName?: string;
  phone?: string;
  linkedAt: number;
  updatedAt: number;
}

/** 绑定信息入参（从 CloudBase 用户对象提取后传入） */
export interface CloudLinkInput {
  localUserId: string;
  cloudUid: string;
  email?: string;
  username?: string;
  displayName?: string;
  phone?: string;
}

interface CloudLinkRow {
  local_user_id: string;
  cloud_uid: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  phone: string | null;
  linked_at: number;
  updated_at: number;
}

function rowToLink(row: CloudLinkRow): CloudLink {
  return {
    localUserId: row.local_user_id,
    cloudUid: row.cloud_uid,
    email: row.email ?? undefined,
    username: row.username ?? undefined,
    displayName: row.display_name ?? undefined,
    phone: row.phone ?? undefined,
    linkedAt: row.linked_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 初始化云绑定表（幂等）。
 * 调用时机：应用启动时，**必须在 initLocalUsers() 之后**（本表引用 local_users.id）。
 */
export function initCloudLinks(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_links (
      local_user_id TEXT PRIMARY KEY,
      cloud_uid     TEXT NOT NULL,
      email         TEXT,
      username      TEXT,
      display_name  TEXT,
      phone         TEXT,
      linked_at     INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    -- 同一云账号只能绑定一个本地身份
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_links_cloud_uid
      ON cloud_links(cloud_uid);
  `);
}

/** 取某个本地身份绑定的云账号 */
export function getLinkForLocalUser(localUserId: string): CloudLink | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM cloud_links WHERE local_user_id = ?')
    .get(localUserId) as CloudLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

/** 取某个云账号绑定的本地身份 */
export function getLinkByCloudUid(cloudUid: string): CloudLink | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM cloud_links WHERE cloud_uid = ?')
    .get(cloudUid) as CloudLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

/** 全部绑定（按绑定时间升序） */
export function listCloudLinks(): CloudLink[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM cloud_links ORDER BY linked_at ASC')
    .all() as CloudLinkRow[];
  return rows.map(rowToLink);
}

/**
 * 写入 / 更新绑定。
 *
 * 注意 cloud_uid 上有唯一索引：若该云账号已绑定到**另一个**本地身份，
 * 这里会抛错 —— 由调用方决定是提示用户还是先解绑旧身份。
 */
export function upsertCloudLink(input: CloudLinkInput): CloudLink {
  const db = getDb();
  const now = Date.now();
  const existing = getLinkForLocalUser(input.localUserId);

  if (existing) {
    db.prepare(
      `UPDATE cloud_links
         SET cloud_uid = ?, email = ?, username = ?, display_name = ?, phone = ?, updated_at = ?
       WHERE local_user_id = ?`,
    ).run(
      input.cloudUid,
      input.email ?? null,
      input.username ?? null,
      input.displayName ?? null,
      input.phone ?? null,
      now,
      input.localUserId,
    );
  } else {
    db.prepare(
      `INSERT INTO cloud_links
         (local_user_id, cloud_uid, email, username, display_name, phone, linked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.localUserId,
      input.cloudUid,
      input.email ?? null,
      input.username ?? null,
      input.displayName ?? null,
      input.phone ?? null,
      now,
      now,
    );
  }

  const saved = getLinkForLocalUser(input.localUserId);
  if (!saved) throw new Error('云账号绑定写入失败');
  return saved;
}

/** 解绑（本地身份删除时也应调用） */
export function deleteLinkForLocalUser(localUserId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM cloud_links WHERE local_user_id = ?').run(localUserId);
}
