import { describe, it, expect } from 'vitest';
import { decideSafeStorage } from './safe-storage';

describe('decideSafeStorage (M3)', () => {
  it('uses encryption when available and backend info is missing', () => {
    expect(
      decideSafeStorage({ platform: 'linux', encryptionAvailable: true, backend: undefined }),
    ).toEqual({ usable: true });
  });

  it('rejects the Linux basic_text backend even when Electron claims encryption is available', () => {
    expect(
      decideSafeStorage({ platform: 'linux', encryptionAvailable: true, backend: 'basic_text' }),
    ).toEqual({ usable: false, reason: 'linux-basic-text' });
  });

  it('accepts Linux keyring backends', () => {
    expect(
      decideSafeStorage({ platform: 'linux', encryptionAvailable: true, backend: 'gnome_libsecret' }),
    ).toEqual({ usable: true });
    expect(
      decideSafeStorage({ platform: 'linux', encryptionAvailable: true, backend: 'kwallet6' }),
    ).toEqual({ usable: true });
  });

  it('ignores the backend value on non-Linux platforms', () => {
    expect(
      decideSafeStorage({ platform: 'darwin', encryptionAvailable: true, backend: 'basic_text' }),
    ).toEqual({ usable: true });
    expect(
      decideSafeStorage({ platform: 'win32', encryptionAvailable: true, backend: undefined }),
    ).toEqual({ usable: true });
  });

  it('rejects when encryption is unavailable regardless of backend', () => {
    expect(
      decideSafeStorage({ platform: 'linux', encryptionAvailable: false, backend: 'gnome_libsecret' }),
    ).toEqual({ usable: false, reason: 'unavailable' });
    expect(
      decideSafeStorage({ platform: 'darwin', encryptionAvailable: false }),
    ).toEqual({ usable: false, reason: 'unavailable' });
  });
});
