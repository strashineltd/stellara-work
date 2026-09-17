import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { sdkAuth, resetCloudClientMock, logInfoMock, logWarnMock } = vi.hoisted(() => ({
  sdkAuth: {
    signOut: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    setSession: vi.fn(),
    getUser: vi.fn(),
  },
  resetCloudClientMock: vi.fn(),
  logInfoMock: vi.fn(),
  logWarnMock: vi.fn(),
}));

vi.mock('electron-log/main', () => ({
  default: { info: logInfoMock, warn: logWarnMock, error: vi.fn() },
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

import { cloudAuth, requireRealIdentityForCloud } from './cloud-auth-manager';
import { _setDbPath, getDb } from '../store/db';
import { clearActiveLocalUser, createLocalUser, getCurrentLocalUser, initLocalUsers, switchLocalUser } from '../store/local-users';
import { getLinkForLocalUser, initCloudLinks, upsertCloudLink } from '../store/cloud-links';
import { _setSecretsDir, getCloudSecret, setCloudSecret } from '../config/secrets';
import * as secretsModule from '../config/secrets';
import * as cloudLinksModule from '../store/cloud-links';

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
  sdkAuth.signUp.mockReset();
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
    const setSecretSpy = vi.spyOn(secretsModule, 'setCloudSecret');
    try {
      sdkAuth.signInWithPassword.mockResolvedValue({
        data: {
          user: { id: 'uid-signin', user_metadata: {} },
          session: { access_token: 'a', refresh_token: 'r' },
        },
      });

      const res = await cloudAuth.signInWithPassword({ identifier: 'alice@example.com', password: 'pw' });

      expect(res.ok).toBe(true);
      // 证明对模块命名空间的 spy 能截获内部调用（guard 测试的 not.toHaveBeenCalled 才有意义）
      expect(setSecretSpy).toHaveBeenCalledWith('ACCESS_TOKEN', 'a');
      expect(getCloudSecret('SESSION_CLOUD_UID')).toBe('uid-signin');
      const user = getCurrentLocalUser()!;
      expect(getLinkForLocalUser(user.id)?.cloudUid).toBe('uid-signin');
    } finally {
      setSecretSpy.mockRestore();
    }
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

  it('never logs the raw account identifier (M5)', async () => {
    logInfoMock.mockClear();
    logWarnMock.mockClear();
    sdkAuth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'uid-signin', user_metadata: {} },
        session: { access_token: 'a', refresh_token: 'r' },
      },
    });

    await cloudAuth.signInWithPassword({ identifier: 'alice@example.com', password: 'pw' });

    const logged = [...logInfoMock.mock.calls, ...logWarnMock.mock.calls]
      .map((call) => call.map(String).join(' '))
      .join('\n');
    expect(logged).not.toContain('alice@example.com');
    expect(logged).not.toContain('uid-signin');
    expect(logged).toContain('云账号登录成功');
  });
});

describe('cloudAuth identity guard (H10)', () => {
  const IDENTITY_REQUIRED = {
    code: 'identity_required',
    message: '请先创建本地身份后再登录云账号',
    hint: expect.any(String),
  };

  it('requireRealIdentityForCloud rejects the default profile and passes real users', () => {
    expect(requireRealIdentityForCloud()).toBeNull();

    clearActiveLocalUser();
    expect(requireRealIdentityForCloud()).toEqual(IDENTITY_REQUIRED);
  });

  it('rejects password sign-in on the default profile before persisting tokens, session uid or link', async () => {
    const user = getCurrentLocalUser()!;
    clearActiveLocalUser();
    const setSecretSpy = vi.spyOn(secretsModule, 'setCloudSecret');
    const linkSpy = vi.spyOn(cloudLinksModule, 'upsertCloudLink');
    sdkAuth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'uid-blocked', user_metadata: {} },
        session: { access_token: 'a', refresh_token: 'r' },
      },
    });

    const res = await cloudAuth.signInWithPassword({ identifier: 'alice@example.com', password: 'pw' });

    expect(res).toEqual({ ok: false, error: IDENTITY_REQUIRED });
    expect(setSecretSpy).not.toHaveBeenCalled();
    expect(linkSpy).not.toHaveBeenCalled();
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
    expect(getCloudSecret('REFRESH_TOKEN')).toBeNull();
    expect(getCloudSecret('SESSION_CLOUD_UID')).toBeNull();
    expect(getLinkForLocalUser(user.id)).toBeNull();
  });

  it('rejects sign-up completion on the default profile before persisting', async () => {
    clearActiveLocalUser();
    const setSecretSpy = vi.spyOn(secretsModule, 'setCloudSecret');
    sdkAuth.signUp.mockResolvedValue({
      data: {
        user: { id: 'uid-signup-blocked', user_metadata: {} },
        session: { access_token: 'a', refresh_token: 'r' },
      },
    });

    const res = await cloudAuth.sendSignUpCode({ email: 'alice@example.com', password: 'pw12345' });

    expect(res).toEqual({ ok: false, error: IDENTITY_REQUIRED });
    expect(setSecretSpy).not.toHaveBeenCalled();
    expect(getCloudSecret('ACCESS_TOKEN')).toBeNull();
  });
});
