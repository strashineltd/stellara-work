// url-policy.test.ts
import { describe, it, expect } from 'vitest';
import { isAllowedBrowserUrl } from './url-policy';
describe('isAllowedBrowserUrl', () => {
  it('allows https', () => expect(isAllowedBrowserUrl('https://example.com/a').ok).toBe(true));
  it('blocks file and javascript', () => {
    expect(isAllowedBrowserUrl('file:///etc/passwd').ok).toBe(false);
    expect(isAllowedBrowserUrl('javascript:alert(1)').ok).toBe(false);
  });
  it('blocks localhost', () => expect(isAllowedBrowserUrl('http://localhost:3000').ok).toBe(false));
  it('S13 blocks private / metadata IP literals', () => {
    for (const url of [
      'http://127.0.0.1:631/',
      'http://10.0.0.1/admin',
      'http://192.168.1.1/',
      'http://169.254.169.254/',
      'http://[::1]/',
      'http://[::ffff:169.254.169.254]/',
    ]) {
      expect(isAllowedBrowserUrl(url).ok, url).toBe(false);
    }
  });
});
