import { describe, it, expect, vi } from 'vitest';
import { hardenSession, hardenSessionNetwork, hardenSessionPermissions } from './session-hardening';

type RequestListener = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void;

function fakeSession() {
  const webRequest = { onBeforeRequest: vi.fn() };
  return {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    webRequest,
  };
}

function captureNetworkListener(
  ses: ReturnType<typeof fakeSession>,
  lookup: (host: string) => Promise<Array<{ address: string; family?: number }>>,
): RequestListener {
  hardenSessionNetwork(ses as any, { lookup });
  return ses.webRequest.onBeforeRequest.mock.calls[0]![1] as RequestListener;
}

function runListener(listener: RequestListener, url: string): Promise<{ cancel: boolean }> {
  return new Promise((resolve) => {
    listener({ url }, resolve);
  });
}

describe('hardenSessionPermissions', () => {
  it('registers deny-all permission handlers', () => {
    const ses = fakeSession();
    hardenSessionPermissions(ses as any);
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
  });

  it('permission request callback always returns false', () => {
    const ses = fakeSession();
    hardenSessionPermissions(ses as any);
    const handler = ses.setPermissionRequestHandler.mock.calls[0]![0] as (
      wc: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void;
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      const cb = vi.fn();
      handler({}, permission, cb);
      expect(cb).toHaveBeenCalledWith(false);
    }
  });

  it('permission check handler always returns false', () => {
    const ses = fakeSession();
    hardenSessionPermissions(ses as any);
    const handler = ses.setPermissionCheckHandler.mock.calls[0]![0] as () => boolean;
    expect(handler()).toBe(false);
  });

  it('does not touch webRequest', () => {
    const ses = fakeSession();
    hardenSessionPermissions(ses as any);
    expect(ses.webRequest.onBeforeRequest).not.toHaveBeenCalled();
  });
});

describe('hardenSessionNetwork (SSRF request filter)', () => {
  it('registers onBeforeRequest with a url filter covering network schemes', () => {
    const ses = fakeSession();
    hardenSessionNetwork(ses as any, { lookup: vi.fn() });
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    const filter = ses.webRequest.onBeforeRequest.mock.calls[0]![0] as { urls: string[] };
    expect(filter.urls.some((u) => u.startsWith('http'))).toBe(true);
    expect(filter.urls.some((u) => u.startsWith('https'))).toBe(true);
  });

  it('does not stack duplicate filters when called again for the same session', () => {
    const ses = fakeSession();
    hardenSessionNetwork(ses as any, { lookup: vi.fn() });
    hardenSessionNetwork(ses as any, { lookup: vi.fn() });
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  it('cancels literal private IP destinations without DNS', async () => {
    const ses = fakeSession();
    const lookup = vi.fn();
    const listener = captureNetworkListener(ses, lookup);
    const res = await runListener(listener, 'http://169.254.169.254/latest/meta-data');
    expect(res).toEqual({ cancel: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('cancels hex-encoded IPv4-mapped IPv6 destinations (H3)', async () => {
    const ses = fakeSession();
    const listener = captureNetworkListener(ses, vi.fn());
    const res = await runListener(listener, 'http://[::ffff:7f00:1]/');
    expect(res).toEqual({ cancel: true });
  });

  it('cancels restricted hostnames without DNS', async () => {
    const ses = fakeSession();
    const lookup = vi.fn();
    const listener = captureNetworkListener(ses, lookup);
    for (const url of ['http://localhost:3000/', 'http://foo.local/', 'http://0.0.0.0/']) {
      const res = await runListener(listener, url);
      expect(res, url).toEqual({ cancel: true });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('cancels hostnames that resolve to private IPs (covers redirects)', async () => {
    const ses = fakeSession();
    const lookup = vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const listener = captureNetworkListener(ses, lookup);
    const res = await runListener(listener, 'https://redirect-target.example.com/');
    expect(res).toEqual({ cancel: true });
    expect(lookup).toHaveBeenCalledWith('redirect-target.example.com');
  });

  it('allows public destinations', async () => {
    const ses = fakeSession();
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const listener = captureNetworkListener(ses, lookup);
    const res = await runListener(listener, 'https://example.com/index.html');
    expect(res).toEqual({ cancel: false });
  });

  it('fails closed when DNS resolution errors', async () => {
    const ses = fakeSession();
    const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const listener = captureNetworkListener(ses, lookup);
    const res = await runListener(listener, 'https://dns-broken.example.com/');
    expect(res).toEqual({ cancel: true });
  });
});

describe('hardenSession', () => {
  it('installs both permission handlers and the request filter', () => {
    const ses = fakeSession();
    hardenSession(ses as any, { lookup: vi.fn() });
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  it('is safe for partially-implemented sessions (test doubles without handlers)', () => {
    expect(() => hardenSession({} as any)).not.toThrow();
    expect(() => hardenSession({ setPermissionRequestHandler: vi.fn() } as any)).not.toThrow();
  });
});
