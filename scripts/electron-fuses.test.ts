import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FUSE_POLICY, resolveElectronBinaryPath } = require('./electron-fuses.cjs');

describe('electron-fuses policy (S24)', () => {
  it('disables RunAsNode and inspect; enables cookie/ASAR hardening', () => {
    expect(FUSE_POLICY.runAsNode).toBe(false);
    expect(FUSE_POLICY.enableNodeCliInspectArguments).toBe(false);
    expect(FUSE_POLICY.enableNodeOptionsEnvironmentVariable).toBe(false);
    expect(FUSE_POLICY.enableCookieEncryption).toBe(true);
    expect(FUSE_POLICY.enableEmbeddedAsarIntegrityValidation).toBe(true);
    expect(FUSE_POLICY.onlyLoadAppFromAsar).toBe(true);
  });

  it('resolves electron binary per platform', () => {
    expect(resolveElectronBinaryPath('/out', 'darwin', 'Stellara Work')).toBe(
      '/out/Stellara Work.app/Contents/MacOS/Stellara Work',
    );
    expect(resolveElectronBinaryPath('/out', 'win32', 'Stellara Work')).toBe(
      '/out/Stellara Work.exe',
    );
    expect(resolveElectronBinaryPath('/out', 'linux', 'stellara-work')).toBe(
      '/out/stellara-work',
    );
  });

  it('after-pack hook is loadable', () => {
    const hook = require('./after-pack-fuses.cjs');
    expect(typeof hook.default).toBe('function');
  });
});
