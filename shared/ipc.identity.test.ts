// shared/ipc.identity.test.ts
//
// H10 契约回归：user_id 一律由主进程按活动身份注入，
// 渲染层可调用的 IPC 入参不得出现 userId 字段。
import { describe, expect, it } from 'vitest';
import type { ElectronAPI } from './ipc';

/** 仅类型层断言：入参类型若含 userId，赋值 false 会在 typecheck 失败 */
type HasUserId<T> = 'userId' extends keyof T ? true : false;

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
