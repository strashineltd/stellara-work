// electron/identity-switch.test.ts
//
// H10 Task 4：identity:switch 语义（busy/force/未知 id/云守卫/广播）
// 与启动回填（R2：只在启动时、只在活动身份是真实用户时执行一次）。
import { describe, expect, it, vi } from 'vitest';
import type { LocalIdentity } from '../shared/ipc';
import {
  backfillIdentityOwnership,
  switchIdentity,
  type IdentitySwitchDeps,
} from './identity-switch';

const DEFAULT_IDENTITY: LocalIdentity = { id: 'default', name: '本地默认', kind: 'default' };
const USER_IDENTITY: LocalIdentity = { id: 'u1', name: 'Ada', kind: 'user' };

interface TestDeps extends IdentitySwitchDeps {
  calls: string[];
}

function makeDeps(overrides: Partial<IdentitySwitchDeps> = {}): TestDeps {
  const calls: string[] = [];
  return {
    calls,
    activeStreamCount: () => 0,
    setActive: (id) => {
      calls.push(`set:${id}`);
      return id === 'default' ? DEFAULT_IDENTITY : { ...USER_IDENTITY, id };
    },
    guardCloud: (activeId) => {
      calls.push(`guard:${activeId}`);
    },
    broadcast: (user) => {
      calls.push(`broadcast:${user.id}`);
    },
    ...overrides,
  };
}

describe('switchIdentity (H10)', () => {
  it('refuses switching while streams are active unless forced', async () => {
    const deps = makeDeps({ activeStreamCount: () => 2 });

    await expect(switchIdentity(deps, 'u1', false)).resolves.toEqual({
      ok: false,
      busy: true,
      count: 2,
    });
    expect(deps.calls).toEqual([]);
  });

  it('reports busy before validating the target', async () => {
    const deps = makeDeps({
      activeStreamCount: () => 1,
      setActive: () => {
        throw new Error('用户不存在: nope');
      },
    });

    await expect(switchIdentity(deps, 'nope', false)).resolves.toEqual({
      ok: false,
      busy: true,
      count: 1,
    });
  });

  it('switches while idle, then guards the cloud session and broadcasts', async () => {
    const deps = makeDeps();

    await expect(switchIdentity(deps, 'u1')).resolves.toEqual({ ok: true, user: USER_IDENTITY });
    expect(deps.calls).toEqual(['set:u1', 'guard:u1', 'broadcast:u1']);
  });

  it('forces the switch through even with active streams', async () => {
    const deps = makeDeps({ activeStreamCount: () => 2 });

    await expect(switchIdentity(deps, 'u1', true)).resolves.toEqual({
      ok: true,
      user: USER_IDENTITY,
    });
    expect(deps.calls).toEqual(['set:u1', 'guard:u1', 'broadcast:u1']);
  });

  it('broadcasts the default profile identity when switching back to default', async () => {
    const deps = makeDeps();

    await expect(switchIdentity(deps, 'default', true)).resolves.toEqual({
      ok: true,
      user: DEFAULT_IDENTITY,
    });
    expect(deps.calls).toEqual(['set:default', 'guard:default', 'broadcast:default']);
  });

  it('rejects unknown identities without guarding or broadcasting', async () => {
    const deps = makeDeps({
      setActive: () => {
        throw new Error('用户不存在: nope');
      },
    });

    await expect(switchIdentity(deps, 'nope', true)).rejects.toThrow(/不存在/);
    expect(deps.calls).toEqual([]);
  });
});

describe('backfillIdentityOwnership (R2)', () => {
  it('backfills legacy rows once for the active real user', () => {
    const migrate = vi.fn(() => 3);

    expect(backfillIdentityOwnership({ getActiveUserId: () => 'u1', migrate })).toBe(3);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate).toHaveBeenCalledWith('u1');
  });

  it('leaves data with the default profile when it is active', () => {
    const migrate = vi.fn(() => 0);

    expect(backfillIdentityOwnership({ getActiveUserId: () => 'default', migrate })).toBe(0);
    expect(migrate).not.toHaveBeenCalled();
  });
});
