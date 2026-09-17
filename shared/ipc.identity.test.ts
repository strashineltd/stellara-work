// shared/ipc.identity.test.ts
//
// H10 契约回归：user_id 一律由主进程按活动身份注入，
// 渲染层可调用的 IPC 入参不得出现 userId 字段。
import { describe, expect, it } from 'vitest';
import type { ElectronAPI, IdentitySwitchResult, LocalIdentity, LocalUser } from './ipc';

/** 仅类型层断言：入参类型若含 userId，赋值 false 会在 typecheck 失败 */
type HasUserId<T> = 'userId' extends keyof T ? true : false;

/** 类型相等断言：任一侧不匹配时赋值 true 会在 typecheck 失败 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

describe('identity ipc contract (H10)', () => {
  it('memory.save 不接受渲染层 userId', () => {
    type Args = Parameters<ElectronAPI['memory']['save']>[0];
    const leak: HasUserId<Args> = false;
    expect(leak).toBe(false);
  });

  it('memory.update 不接受渲染层 userId', () => {
    type Args = Parameters<ElectronAPI['memory']['update']>[1];
    const leak: HasUserId<Args> = false;
    expect(leak).toBe(false);
  });

  it('sessions.create 不接受渲染层 userId', () => {
    type Args = Parameters<ElectronAPI['sessions']['create']>[0];
    const leak: HasUserId<Args> = false;
    expect(leak).toBe(false);
  });

  it('projects.create 不接受渲染层 userId', () => {
    type Args = Parameters<ElectronAPI['projects']['create']>[0];
    const leak: HasUserId<Args> = false;
    expect(leak).toBe(false);
  });
});

describe('identity ipc contract (H10)', () => {
  it('identity.list returns LocalIdentity[]', () => {
    type Actual = Awaited<ReturnType<ElectronAPI['identity']['list']>>;
    const check: Equal<Actual, LocalIdentity[]> = true;
    expect(check).toBe(true);
  });

  it('identity.getCurrent returns LocalIdentity', () => {
    type Actual = Awaited<ReturnType<ElectronAPI['identity']['getCurrent']>>;
    const check: Equal<Actual, LocalIdentity> = true;
    expect(check).toBe(true);
  });

  it('identity.switch resolves to ok+user or busy+count', () => {
    type Actual = Awaited<ReturnType<ElectronAPI['identity']['switch']>>;
    const check: Equal<Actual, IdentitySwitchResult> = true;
    const busy: IdentitySwitchResult = { ok: false, busy: true, count: 2 };
    const switched: IdentitySwitchResult = {
      ok: true,
      user: { id: 'u1', name: 'Ada', kind: 'user' },
    };
    expect([check, busy.ok, switched.ok]).toEqual([true, false, true]);
  });

  it('identity.onChanged receives a LocalIdentity and returns an unsubscribe', () => {
    type Callback = Parameters<ElectronAPI['identity']['onChanged']>[0];
    type Unsubscribe = ReturnType<ElectronAPI['identity']['onChanged']>;
    const callback: Equal<Callback, (user: LocalIdentity) => void> = true;
    const unsubscribe: Equal<Unsubscribe, () => void> = true;
    expect([callback, unsubscribe]).toEqual([true, true]);
  });

  it('auth.local.list returns identities and switch may return null', () => {
    type List = Awaited<ReturnType<ElectronAPI['auth']['local']['list']>>;
    type Switch = Awaited<ReturnType<ElectronAPI['auth']['local']['switch']>>;
    const list: Equal<List, LocalIdentity[]> = true;
    const sw: Equal<Switch, LocalUser | null> = true;
    expect([list, sw]).toEqual([true, true]);
  });

  it('LocalIdentity kind is default or user', () => {
    const kinds: LocalIdentity['kind'][] = ['default', 'user'];
    expect(kinds).toEqual(['default', 'user']);
  });
});
