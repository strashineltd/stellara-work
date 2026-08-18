import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender } from './ipc-guard';

describe('isTrustedIpcSender', () => {
  const live = { isDestroyed: () => false };
  const destroyed = { isDestroyed: () => true };

  it('接受与受信 webContents 相同的 sender', () => {
    expect(isTrustedIpcSender(live, live)).toBe(true);
  });

  it('拒绝不同对象 sender', () => {
    expect(isTrustedIpcSender({}, live)).toBe(false);
    expect(isTrustedIpcSender(live, {})).toBe(false);
  });

  it('拒绝 null/undefined', () => {
    expect(isTrustedIpcSender(null, live)).toBe(false);
    expect(isTrustedIpcSender(undefined, live)).toBe(false);
    expect(isTrustedIpcSender(live, null)).toBe(false);
  });

  it('拒绝已销毁窗口的 sender', () => {
    expect(isTrustedIpcSender(destroyed, destroyed)).toBe(false);
    expect(isTrustedIpcSender(live, destroyed)).toBe(false);
  });
});
