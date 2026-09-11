import { describe, expect, it } from 'vitest';
import type { CreateSessionArgs, ServerEntry, SessionSummary } from './ipc';

describe('server ipc contract', () => {
  it('server entry view never carries a password field', () => {
    const entry: ServerEntry = {
      id: 'srv-1', name: '本地服务器', url: 'http://localhost:4096',
      username: 'opencode', hasPassword: true, isDefault: false,
      createdAt: '2026-09-10T00:00:00Z',
    };
    expect(entry.hasPassword).toBe(true);
    expect(Object.keys(entry)).not.toContain('password');
  });

  it('session summaries may describe server sessions', () => {
    const summary: SessionSummary = {
      id: 's1', title: '远端', modelId: '', messageCount: 0, updatedAt: 1,
      runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1', offline: true,
    };
    expect(summary.runtime).toBe('server');
  });

  it('create session args accept runtime target', () => {
    const args: CreateSessionArgs = { modelId: undefined, runtime: 'server', serverId: 'srv-1' };
    expect(args.serverId).toBe('srv-1');
  });
});
