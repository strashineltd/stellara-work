import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logWarnMock } = vi.hoisted(() => ({ logWarnMock: vi.fn() }));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: logWarnMock, error: vi.fn() },
}));

import { CloudNotConfiguredError, describeCloudError } from './cloud-errors';

describe('describeCloudError unknown branch (M6)', () => {
  beforeEach(() => {
    logWarnMock.mockClear();
  });

  it('returns a generic Chinese message instead of the raw server payload', () => {
    const err = {
      code: 'weird_server_error',
      category: 'SOMETHING_NEW',
      message: 'Internal failure at https://api.internal.example/secret?token=abc123',
      helpMessage: 'raw help text with server details',
    };

    const result = describeCloudError(err);

    expect(result.message).toBe('操作失败，请稍后重试');
    expect(result.code).toBe('weird_server_error');
    expect(JSON.stringify(result)).not.toContain('api.internal.example');
    expect(JSON.stringify(result)).not.toContain('token=abc123');
    expect(JSON.stringify(result)).not.toContain('raw help text');
  });

  it('sanitizes a code that carries payload-like text', () => {
    const result = describeCloudError({ code: 'not a code with spaces', message: 'boom' });

    expect(result.code).toBe('unknown');
    expect(result.message).toBe('操作失败，请稍后重试');
  });

  it('logs the unmapped details locally for diagnostics', () => {
    describeCloudError({ code: 'weird', message: 'server said secret detail' });

    expect(logWarnMock).toHaveBeenCalled();
    const logged = logWarnMock.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(logged).toContain('server said secret detail');
  });
});

describe('describeCloudError mapped branches stay intact', () => {
  it('reports a missing publishable key without treating it as a user failure', () => {
    const result = describeCloudError(new CloudNotConfiguredError());
    expect(result.code).toBe('CLOUD_NOT_CONFIGURED');
    expect(result.message).toContain('Publishable Key');
  });

  it('maps known categories and network errors', () => {
    expect(
      describeCloudError({ category: 'INVALID_CREDENTIALS', message: 'bad' }).code,
    ).toBe('invalid_credentials');
    expect(
      describeCloudError({ message: 'fetch failed' }).code,
    ).toBe('network');
  });
});
