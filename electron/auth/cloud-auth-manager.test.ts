import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { sdkAuth, resetCloudClientMock } = vi.hoisted(() => ({
  sdkAuth: {
    signOut: vi.fn(async () => ({ error: null })),
    signInWithPassword: vi.fn(),
    setSession: vi.fn(),
    getUser: vi.fn(),
  },
  resetCloudClientMock: vi.fn(),
}));

vi.mock('../cloud/cloudbase-client', () => ({
  getCloudAuth: () => sdkAuth,
  isCloudConfigured: () => true,
  resetCloudClient: resetCloudClientMock,
  describeCloudError: (err: unknown) => ({
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err),
    hint: '',
  }),
}));

import { cloudAuth } from './cloud-auth-manager';
import { _setDbPath, getDb } from '../store/db';
import { createLocalUser, getCurrentLocalUser, initLocalUsers, switchLocalUser } from '../store/local-users';
import { getLinkForLocalUser, initCloudLinks, upsertCloudLink } from '../store/cloud-links';
import { _setSecretsDir, getCloudSecret, setCloudSecret } from '../config/secrets';

let tmpDir: string;

async function seedSession(uid: string): Promise<void> {
  await setCloudSecret('ACCESS_TOKEN', `access-${uid}`);
  await setCloudSecret('REFRESH_TOKEN', `refresh-${uid}`);
  await setCloudSecret('SESSION_CLOUD_UID', uid);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-cloudauth-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  _setSecretsDir(tmpDir);
  getDb();
  initLocalUsers();
  initCloudLinks();
  sdkAuth.signOut.mockClear();
  sdkAuth.signInWithPassword.mockReset();
  sdkAuth.setSession.mockReset();
  sdkAuth.getUser.mockReset();
  resetCloudClientMock.mockClear();
});

afterEach(async () => {
  _setDbPath(null);
  _setSecretsDir(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('cloudAuth.reconcileLocalIdentitySwitch (H10)', () => {
  it('is a no-op when there is no cloud session', async () => {
    const user = getCurrentLocalUser()!;
    const cleared = await cloudAuth.reconcileLocalIdentitySwitch(user.id);

    expect(cleared).toBe(false);
    expect(sdkAuth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the session uid matches the new identity link', async () => {
    const user = getCurrentLocalUser()!;
    upsertCloudLink({ localUserId: user.id, cloudUid: 'uid-A' });
    await seedSession('uid-A');

    const cleared = await cloudAuth.reconcileLocalIdentitySwitch(user.id);

    expect(cleared).toBe(false);
    expect(getCloudSecret('ACCESS_TOKEN')).toBe('access-uid-A');
    expect(getCloudSecret('REFRESH_TOKEN')).toBe('refresh-uid-A');
    expect(sdkAuth.signOut).not.toHaveBeenCalled();
  });

  it('clears the session when the new identity has a different cloud link', async () => {
    const userA = getCurrentLocalUser()!;
    const userB = createLocalUser('B');
    upsertCloudLink({ localUserId: userA.id, cloudUid: 'uid-A' });
    upsertCloudLink({ localUserId: userB.id, cloudUid: 'uid-B' });
    await seedSession('uid-A');
    switchLocalUser(userB.id);

    const cleared = await cloudAuth.reconcileLocalIdentitySwitch(userB.id);

    expect(cleared).toBe(true);
    expect(sdkAuth.signOut).toHaveBeenCalledTimes(1);
    expect(resetCloudClientMock).toHaveBeenCalledTimes(1);
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
    expect(getCloudSecret('REFRESH_TOKEN')).toBeNull();
    expect(getCloudSecret('SESSION_CLOUD_UID')).toBeNull();
    // 绑定保留：下次可用同一云账号重新登录
    expect(getLinkForLocalUser(userA.id)?.cloudUid).toBe('uid-A');
    expect(getLinkForLocalUser(userB.id)?.cloudUid).toBe('uid-B');
  });

  it('clears the session when the new identity has no cloud link', async () => {
    const userA = getCurrentLocalUser()!;
    const userB = createLocalUser('B');
    upsertCloudLink({ localUserId: userA.id, cloudUid: 'uid-A' });
    await seedSession('uid-A');

    const cleared = await cloudAuth.reconcileLocalIdentitySwitch(userB.id);

    expect(cleared).toBe(true);
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
  });

  it('clears a legacy session without a recorded uid (cannot verify subject)', async () => {
    const user = getCurrentLocalUser()!;
    upsertCloudLink({ localUserId: user.id, cloudUid: 'uid-A' });
    await setCloudSecret('ACCESS_TOKEN', 'access-legacy');
    await setCloudSecret('REFRESH_TOKEN', 'refresh-legacy');

    const cleared = await cloudAuth.reconcileLocalIdentitySwitch(user.id);

    expect(cleared).toBe(true);
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
  });
});

describe('cloudAuth session bookkeeping', () => {
  it('records the session subject uid on sign-in', async () => {
    sdkAuth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'uid-signin', user_metadata: {} },
        session: { access_token: 'a', refresh_token: 'r' },
      },
    });

    const res = await cloudAuth.signInWithPassword({ identifier: 'alice@example.com', password: 'pw' });

    expect(res.ok).toBe(true);
    expect(getCloudSecret('SESSION_CLOUD_UID')).toBe('uid-signin');
    const user = getCurrentLocalUser()!;
    expect(getLinkForLocalUser(user.id)?.cloudUid).toBe('uid-signin');
  });

  it('signOut clears tokens and the recorded uid but keeps the link', async () => {
    const user = getCurrentLocalUser()!;
    upsertCloudLink({ localUserId: user.id, cloudUid: 'uid-A' });
    await seedSession('uid-A');

    const res = await cloudAuth.signOut();

    expect(res.ok).toBe(true);
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
    expect(getCloudSecret('SESSION_CLOUD_UID')).toBeNull();
    expect(getLinkForLocalUser(user.id)?.cloudUid).toBe('uid-A');
  });
});
