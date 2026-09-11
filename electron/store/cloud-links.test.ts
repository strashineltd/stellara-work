import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _setDbPath, getDb } from './db';
import { createLocalUser, getCurrentLocalUser, initLocalUsers } from './local-users';
import {
  deleteLinkForLocalUser,
  getLinkByCloudUid,
  getLinkForLocalUser,
  initCloudLinks,
  listCloudLinks,
  upsertCloudLink,
} from './cloud-links';

let tmpDir: string;
let localUserId: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-cloud-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  getDb();
  initLocalUsers();
  initCloudLinks();
  localUserId = getCurrentLocalUser()!.id;
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('cloud_links 绑定表', () => {
  it('initCloudLinks 建表且幂等', () => {
    const db = getDb();
    initCloudLinks(); // 重复调用不应报错

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('cloud_links');

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cloud_links'")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('idx_cloud_links_cloud_uid');
  });

  it('upsertCloudLink 新建绑定并回读', () => {
    const saved = upsertCloudLink({
      localUserId,
      cloudUid: 'uid-001',
      email: 'a@example.com',
      username: 'alice',
      displayName: 'Alice',
    });

    expect(saved.localUserId).toBe(localUserId);
    expect(saved.cloudUid).toBe('uid-001');
    expect(saved.email).toBe('a@example.com');
    expect(saved.linkedAt).toBeGreaterThan(0);

    const read = getLinkForLocalUser(localUserId);
    expect(read?.cloudUid).toBe('uid-001');
    expect(read?.displayName).toBe('Alice');
  });

  it('同一本地身份再次 upsert 走更新而非新增', () => {
    upsertCloudLink({ localUserId, cloudUid: 'uid-001', email: 'a@example.com' });
    const updated = upsertCloudLink({ localUserId, cloudUid: 'uid-002', email: 'b@example.com' });

    expect(updated.cloudUid).toBe('uid-002');
    expect(updated.email).toBe('b@example.com');
    expect(listCloudLinks()).toHaveLength(1);
    expect(getLinkByCloudUid('uid-001')).toBeNull();
  });

  it('getLinkByCloudUid 可反查本地身份', () => {
    upsertCloudLink({ localUserId, cloudUid: 'uid-001', email: 'a@example.com' });
    expect(getLinkByCloudUid('uid-001')?.localUserId).toBe(localUserId);
    expect(getLinkByCloudUid('uid-not-exist')).toBeNull();
  });

  it('同一云账号不能绑定到两个本地身份（唯一索引兜底）', () => {
    const other = createLocalUser('Second User');
    upsertCloudLink({ localUserId, cloudUid: 'uid-001' });

    expect(() => upsertCloudLink({ localUserId: other.id, cloudUid: 'uid-001' })).toThrow();
    expect(getLinkForLocalUser(other.id)).toBeNull();
  });

  it('deleteLinkForLocalUser 只清目标绑定', () => {
    const other = createLocalUser('Second User');
    upsertCloudLink({ localUserId, cloudUid: 'uid-001' });
    upsertCloudLink({ localUserId: other.id, cloudUid: 'uid-002' });

    deleteLinkForLocalUser(localUserId);

    expect(getLinkForLocalUser(localUserId)).toBeNull();
    expect(getLinkForLocalUser(other.id)?.cloudUid).toBe('uid-002');
    expect(listCloudLinks()).toHaveLength(1);
  });

  it('可选字段缺省时读回为 undefined', () => {
    const saved = upsertCloudLink({ localUserId, cloudUid: 'uid-001' });
    expect(saved.email).toBeUndefined();
    expect(saved.username).toBeUndefined();
    expect(saved.displayName).toBeUndefined();
    expect(saved.phone).toBeUndefined();
  });
});
