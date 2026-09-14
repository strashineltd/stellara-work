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

  it('still succeeds and broadcasts once when the cloud guard rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guardCloud = vi.fn(async () => {
      throw new Error('cloud exploded');
    });
    const deps = makeDeps({ guardCloud });

    try {
      await expect(switchIdentity(deps, 'u1')).resolves.toEqual({ ok: true, user: USER_IDENTITY });
      expect(guardCloud).toHaveBeenCalledWith('u1');
      expect(deps.calls).toEqual(['set:u1', 'broadcast:u1']);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('backfillIdentityOwnership (R2)', () => {
  /** 一次性标记的内存实现（真实持久化由 db-identity.test.ts 覆盖） */
  function markerDeps(overrides: Partial<ReturnType<typeof baseDeps>> = {}) {
    return { ...baseDeps(), ...overrides };
  }

  function baseDeps() {
    let done = false;
    const markDone = vi.fn(() => {
      done = true;
    });
    return {
      getActiveUserId: () => 'u1',
      migrate: vi.fn(() => 3),
      isDone: () => done,
      markDone,
    };
  }

  it('backfills legacy rows once for the active real user and sets the marker', () => {
    const deps = markerDeps();

    expect(backfillIdentityOwnership(deps)).toBe(3);
    expect(deps.migrate).toHaveBeenCalledTimes(1);
    expect(deps.migrate).toHaveBeenCalledWith('u1');
    expect(deps.markDone).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on the second run, even when new default rows exist', () => {
    const deps = markerDeps();

    expect(backfillIdentityOwnership(deps)).toBe(3);
    // 第二次运行：migrate 可能发现新的 default 行（模拟），但标记已存在 → 不允许再迁
    deps.migrate.mockReturnValue(5);
    expect(backfillIdentityOwnership(deps)).toBe(0);
    expect(deps.migrate).toHaveBeenCalledTimes(1);
    expect(deps.markDone).toHaveBeenCalledTimes(1);
  });

  it('marks the migration as evaluated on a default-profile first run and never migrates later default rows', () => {
    const deps = markerDeps({ getActiveUserId: () => 'default', migrate: vi.fn(() => 0) });

    // 首次启动：默认档不迁移，但「迁移时刻」已过 → 必须落标记
    expect(backfillIdentityOwnership(deps)).toBe(0);
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.markDone).toHaveBeenCalledTimes(1);

    // 之后用户创建本地身份并重启：标记已存在，H10 之后新建的默认行不得被划走
    deps.getActiveUserId = () => 'u1';
    expect(backfillIdentityOwnership(deps)).toBe(0);
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.markDone).toHaveBeenCalledTimes(1);
  });

  it('does not mark done when the backfill throws', () => {
    const deps = markerDeps({
      migrate: vi.fn(() => {
        throw new Error('db exploded');
      }),
    });

    expect(() => backfillIdentityOwnership(deps)).toThrow('db exploded');
    expect(deps.markDone).not.toHaveBeenCalled();
  });
});
