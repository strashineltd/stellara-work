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
});
