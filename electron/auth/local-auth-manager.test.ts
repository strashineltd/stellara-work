import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _setDbPath, getDb, initDb } from '../store/db';
import { createLocalUser, getCurrentLocalUser, initLocalUsers, listLocalUsers } from '../store/local-users';
import {
  DEFAULT_USER_ID,
  getActiveUserId,
  listIdentities,
  localAuth,
  setActiveUserId,
} from './local-auth-manager';

let dir: string;

/** 直接清空激活行，模拟「本地默认」档（不依赖被测代码本身） */
function clearActiveRow(): void {
  getDb().prepare('DELETE FROM active_local_user').run();
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-localauth-'));
  _setDbPath(path.join(dir, 't.db'));
  initDb();
  initLocalUsers();
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(dir, { recursive: true, force: true });
});

describe('local identity (H10)', () => {
  it('returns the default identity when no local user is active', () => {
    clearActiveRow();

    expect(DEFAULT_USER_ID).toBe('default');
    expect(getActiveUserId()).toBe('default');
  });

  it('returns the active local user id when one is active', () => {
    const user = getCurrentLocalUser()!;
    expect(getActiveUserId()).toBe(user.id);

    const other = createLocalUser('B');
    setActiveUserId(other.id);
    expect(getActiveUserId()).toBe(other.id);
  });

  it('lists the default profile first, then local users', () => {
    clearActiveRow();
    const user = createLocalUser('Ada');

    const identities = listIdentities();

    expect(identities[0]).toEqual({ id: 'default', name: '本地默认', kind: 'default' });
    expect(identities).toHaveLength(listLocalUsers().length + 1);
    expect(identities).toContainEqual({ id: user.id, name: 'Ada', kind: 'user' });
  });

  it('rejects unknown switches without changing the active identity', () => {
    const user = getCurrentLocalUser()!;

    expect(() => setActiveUserId('nope')).toThrow(/不存在/);
    expect(getActiveUserId()).toBe(user.id);
  });

  it('clears the active local user when switching to the default profile', () => {
    expect(getCurrentLocalUser()).not.toBeNull();

    setActiveUserId('default');

    expect(getCurrentLocalUser()).toBeNull();
    expect(getActiveUserId()).toBe('default');
  });

  it('keeps the default profile across a restart (no auto-resurrection)', () => {
    setActiveUserId('default');

    // 模拟应用重启：初始化逻辑不应把历史用户重新设为活动身份
    initLocalUsers();

    expect(getActiveUserId()).toBe('default');
  });

  it('keeps the localAuth switch flow consistent for users and default', () => {
    const other = createLocalUser('B');

    expect(localAuth.switch(other.id)).toMatchObject({ id: other.id, displayName: 'B' });
    expect(getActiveUserId()).toBe(other.id);

    expect(localAuth.switch(DEFAULT_USER_ID)).toBeNull();
    expect(getActiveUserId()).toBe('default');

    expect(() => localAuth.switch('nope')).toThrow(/不存在/);
  });
});
