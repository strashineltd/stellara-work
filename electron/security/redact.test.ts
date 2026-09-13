import { describe, it, expect } from 'vitest';
import { redactSensitiveText, redactAccountRef } from './redact';

describe('redactSensitiveText (M5)', () => {
  it('redacts email addresses but keeps the surrounding message', () => {
    const out = redactSensitiveText('2026-09-13 [warn] 云账号登录成功: alice@example.com');
    expect(out).not.toContain('alice@example.com');
    expect(out).toContain('云账号登录成功');
    expect(out).toContain('2026-09-13');
  });

  it('redacts STELLARA secret assignments while keeping the key name useful', () => {
    const out = redactSensitiveText(
      'STELLARA_KEY_openai=sk-abc123def456\nSTELLARA_SERVER_srv=server-pw\nSTELLARA_CLOUD_ACCESS_TOKEN=jwtlikevalue',
    );
    expect(out).not.toContain('sk-abc123def456');
    expect(out).not.toContain('server-pw');
    expect(out).not.toContain('jwtlikevalue');
    expect(out).toContain('STELLARA_KEY_openai=<redacted>');
    expect(out).toContain('STELLARA_SERVER_srv=<redacted>');
    expect(out).toContain('STELLARA_CLOUD_ACCESS_TOKEN=<redacted>');
  });

  it('redacts generic *_TOKEN / *_PASSWORD assignments', () => {
    const out = redactSensitiveText('GITHUB_TOKEN=ghp_realtoken123\nDB_PASSWORD=hunter2secret');
    expect(out).not.toContain('ghp_realtoken123');
    expect(out).not.toContain('hunter2secret');
  });

  it('redacts bearer tokens and JWT blobs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactSensitiveText(`Authorization: Bearer ${jwt}\n`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('Authorization: Bearer <redacted>');
  });

  it('redacts sk- style API keys used inline', () => {
    const out = redactSensitiveText('calling with sk-1234567890abcdef done');
    expect(out).not.toContain('sk-1234567890abcdef');
    expect(out).toContain('done');
  });

  it('keeps ordinary log lines intact and useful', () => {
    const line = '2026-09-13 10:00:00 [info] window ready in 123ms';
    expect(redactSensitiveText(line)).toBe(line);
  });
});

describe('redactAccountRef (M5)', () => {
  it('never returns the raw email, username or uid', () => {
    expect(redactAccountRef({ email: 'a@b.com', username: 'alice', uid: 'u1' })).toBe('email=<redacted>');
    expect(redactAccountRef({ username: 'alice', uid: 'u1' })).toBe('username=<redacted>');
    expect(redactAccountRef({ uid: 'u1' })).toBe('uid=<redacted>');
    expect(redactAccountRef({})).toBe('uid=<redacted>');
  });
});
