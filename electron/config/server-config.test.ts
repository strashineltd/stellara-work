import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as secrets from './secrets';
import * as config from './config-v2';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'stellara-cfg-'));
  secrets._setSecretsDir(dir);
  config._setConfigDir(dir);
});

afterEach(async () => {
  secrets._setSecretsDir(null);
  config._setConfigDir(null);
  await rm(dir, { recursive: true, force: true });
});

describe('server config', () => {
  it('normalizes only http/https urls', () => {
    expect(config.normalizeServerUrl('http://localhost:4096/')).toBe('http://localhost:4096');
    expect(config.normalizeServerUrl('https://example.com/base/')).toBe('https://example.com/base');
    expect(config.normalizeServerUrl('file:///etc/passwd')).toBeNull();
    expect(config.normalizeServerUrl('not a url')).toBeNull();
  });

  it('adds, updates and removes server entries', async () => {
    const entry = { id: 'srv-1', name: '本地服务器', url: 'http://localhost:4096', username: 'opencode', createdAt: '2026-09-10T00:00:00Z' };
    await config.addServerEntry(entry);
    expect(config.listServerEntries().map((s) => s.id)).toEqual(['srv-1']);

    await config.updateServerEntry('srv-1', { name: '改名' });
    expect(config.getServerEntry('srv-1')?.name).toBe('改名');

    await config.removeServerEntry('srv-1');
    expect(config.getServerEntry('srv-1')).toBeUndefined();
  });

  it('sets default server id and clears it on remove', async () => {
    await config.addServerEntry({ id: 'srv-2', name: 'B', url: 'http://127.0.0.1:4096', createdAt: 'x' });
    await config.setDefaultServerId('srv-2');
    expect((await config.loadConfig()).app.defaultServerId).toBe('srv-2');
    await config.removeServerEntry('srv-2');
    expect((await config.loadConfig()).app.defaultServerId ?? null).toBeNull();
  });

  it('loadConfig deep-copies server entries (no shared references)', async () => {
    await config.addServerEntry({ id: 'srv-3', name: 'C', url: 'http://localhost:4096', createdAt: 'x' });
    const first = await config.loadConfig();
    const firstEntry = first.app.servers?.[0];
    if (!firstEntry) throw new Error('expected server entry');
    firstEntry.name = 'mutated';
    first.app.servers?.push({ id: 'ghost', name: 'G', url: 'http://x', createdAt: 'x' });
    const second = await config.loadConfig();
    expect(second.app.servers?.map((s) => s.id)).toEqual(['srv-3']);
    expect(second.app.servers?.[0]?.name).toBe('C');
  });

  it('sanitizes settings patches to the whitelist', () => {
    const result = config.sanitizeSettingsPatch({ theme: 'dark', servers: [{ id: 'x' }] as never, defaultServerId: 'x', unknown: 1 } as never);
    expect(result.patch).toEqual({ theme: 'dark' });
    expect(result.rejected.sort()).toEqual(['defaultServerId', 'servers', 'unknown']);
  });

  it('keeps every whitelisted settings key', () => {
    const patch = {
      workDirDefault: '/tmp/work',
      shortcuts: { 'session.new': 'Mod+N' },
      theme: 'light' as const,
      workspaceMode: 'tabs' as const,
      browser: { execJsEnabled: true },
    };
    const result = config.sanitizeSettingsPatch(patch as never);
    expect(result.rejected).toEqual([]);
    expect(result.patch).toEqual(patch);
  });

  it('stores the password encrypted and readable only by main', async () => {
    secrets._setCipher({ encrypt: (p) => `enc(${p})`, decrypt: (b) => b.slice(4, -1) });
    await secrets.setServerPassword('srv-1', 'secret');
    expect(secrets.getServerPassword('srv-1')).toBe('secret');
    await secrets.deleteServerPassword('srv-1');
    expect(secrets.getServerPassword('srv-1')).toBeNull();
    secrets._setCipher(null);
  });
});
