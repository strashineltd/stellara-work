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

  describe('senderFrame 子框架校验', () => {
    const mainFrame = { frame: 'main' };
    const subFrame = { frame: 'sub' };
    const liveWithFrames = { isDestroyed: () => false, mainFrame };

    it('接受主框架事件', () => {
      expect(isTrustedIpcSender(liveWithFrames, liveWithFrames, mainFrame)).toBe(true);
    });

    it('拒绝子框架事件', () => {
      expect(isTrustedIpcSender(liveWithFrames, liveWithFrames, subFrame)).toBe(false);
    });

    it('拒绝 frame 为空（已销毁）的事件', () => {
      expect(isTrustedIpcSender(liveWithFrames, liveWithFrames, null)).toBe(false);
    });

    it('兼容测试替身未提供 senderFrame（既有行为）', () => {
      expect(isTrustedIpcSender(live, live)).toBe(true);
    });

    it('senderFrame 可用但 trusted 缺少 mainFrame 时拒绝', () => {
      expect(isTrustedIpcSender(live, live, mainFrame)).toBe(false);
    });
  });
});
