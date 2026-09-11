import { describe, expect, it, vi } from 'vitest';
import { SessionBridge } from './session-bridge';

function makeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    listSessions: () => [...rows.values()],
    getSession: (id: string) => rows.get(id),
    createSession: (input: Record<string, unknown>) => {
      const row = { ...input, messageCount: 0, createdAt: 1, updatedAt: 1 };
      rows.set(input.id as string, row);
      return row;
    },
    findSessionByRemote: (_sid: string, remote: string) => [...rows.values()].find((r) => r.remoteSessionId === remote),
    listServerSessions: (sid: string) => [...rows.values()].filter((r) => r.serverId === sid),
    deleteSession: (id: string) => { rows.delete(id); },
    deleteSessionByRemote: (sid: string, remote: string) => {
      const row = [...rows.values()].find((r) => r.serverId === sid && r.remoteSessionId === remote);
      if (row) rows.delete(row.id as string);
    },
    renameSession: (id: string, title: string) => { rows.set(id, { ...rows.get(id)!, title }); },
    updateSessionMeta: (id: string, patch: Record<string, unknown>) => { rows.set(id, { ...rows.get(id)!, ...patch }); },
    getMessages: () => [],
    saveMessages: vi.fn(),
    appendMessage: vi.fn(),
  };
}

function makeManager(client: Record<string, unknown> | null, status = 'connected') {
  return {
    list: async () => [],
    statuses: () => [{ id: 'srv-1', status }],
    getClient: () => client,
    onEvent: () => () => {},
  };
}

const remoteSession = { id: 'ses_1', title: '远端', time: { created: 100, updated: 200 } };

describe('SessionBridge', () => {
  it('creates a server session and stores a local mapping row', async () => {
    const db = makeDb();
    const client = { createSession: vi.fn(async () => remoteSession) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'local-1' });
    const session = await bridge.create({ runtime: 'server', serverId: 'srv-1' });
    expect(session).toMatchObject({ id: 'local-1', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1', title: '远端' });
    expect(db.rows.get('local-1')).toMatchObject({ remoteSessionId: 'ses_1', modelId: '' });
  });

  it('stores the server model in the mapping row when provided', async () => {
    const db = makeDb();
    const client = { createSession: vi.fn(async () => remoteSession) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'local-1' });
    const session = await bridge.create({
      runtime: 'server',
      serverId: 'srv-1',
      serverModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
    });
    expect(session.modelId).toBe('anthropic/claude-sonnet-4');
    expect(db.rows.get('local-1')).toMatchObject({ modelId: 'anthropic/claude-sonnet-4' });
  });

  it('merges server sessions when connected and marks offline rows otherwise', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '本地', modelId: 'm1', runtime: 'local' });
    const client = { listSessions: vi.fn(async () => [remoteSession]) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const merged = await bridge.list();
    expect(merged.map((s) => s.id).sort()).toEqual(['l1', 'u1']);
    const offlineBridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u2' });
    const offline = await offlineBridge.list();
    expect(offline.find((s) => s.id === 'u1')).toMatchObject({ offline: true });
  });

  it('reconciles mappings that no longer exist on the server', async () => {
    const db = makeDb();
    db.createSession({ id: 'stale', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_gone' });
    const client = { listSessions: vi.fn(async () => []) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    await bridge.list();
    expect(db.rows.has('stale')).toBe(false);
  });

  it('skips child sessions from the server list', async () => {
    const db = makeDb();
    const parent = { id: 'ses_parent', title: '父', time: { created: 1, updated: 2 } };
    const child = { id: 'ses_child', title: 'Review 2B-T6 (@general subagent)', parentID: 'ses_parent', time: { created: 1, updated: 2 } };
    const client = { listSessions: vi.fn(async () => [parent, child]) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const list = await bridge.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'u1', runtime: 'server', remoteSessionId: 'ses_parent' });
    expect([...db.rows.values()].some((r) => r.remoteSessionId === 'ses_child')).toBe(false);
  });

  it('treats an empty parentID as a top-level session', async () => {
    const db = makeDb();
    const client = { listSessions: vi.fn(async () => [{ ...remoteSession, parentID: '' }]) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const list = await bridge.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'u1', remoteSessionId: 'ses_1' });
  });

  it('reconciles cached mapping rows for child sessions on the next list', async () => {
    const db = makeDb();
    db.createSession({ id: 'child-map', title: '子', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_child' });
    const parent = { id: 'ses_parent', title: '父' };
    const child = { id: 'ses_child', title: '子', parentID: 'ses_parent' };
    const client = { listSessions: vi.fn(async () => [parent, child]) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    await bridge.list();
    expect(db.rows.has('child-map')).toBe(false);
    expect([...db.rows.values()].some((r) => r.remoteSessionId === 'ses_parent')).toBe(true);
  });

  it('reads server session messages through the adapter', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const client = {
      listMessages: vi.fn(async () => [
        { info: { id: 'm1', role: 'user', sessionID: 'ses_1' }, parts: [{ type: 'text', id: 'p', sessionID: 'ses_1', messageID: 'm1', text: 'hi' }] },
      ]),
    };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const { session, messages } = await bridge.get('l1');
    expect(session.runtime).toBe('server');
    expect(messages[0]!.content).toBe('hi');
    expect(db.saveMessages).not.toHaveBeenCalled();
    expect(db.appendMessage).not.toHaveBeenCalled();
  });

  it('labels local sessions with runtime local', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '本地', modelId: 'm1', runtime: 'local' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    const list = await bridge.list();
    expect(list.find((s) => s.id === 'l1')).toMatchObject({ runtime: 'local' });
    expect(list.find((s) => s.id === 'l1')).not.toHaveProperty('offline');
  });

  it('keeps cached mapping rows when listSessions fails', async () => {
    const db = makeDb();
    db.createSession({ id: 'cached', title: 'C', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_x' });
    const client = { listSessions: vi.fn(async () => { throw new Error('boom'); }) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const list = await bridge.list();
    expect(db.rows.has('cached')).toBe(true);
    expect(list.find((s) => s.id === 'cached')).toMatchObject({ offline: true, remoteSessionId: 'ses_x' });
  });

  it('refreshes mapped rows from the remote list', async () => {
    const db = makeDb();
    db.createSession({ id: 'map', title: '旧', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const client = { listSessions: vi.fn(async () => [{ ...remoteSession, title: '新', time: { created: 100, updated: 300 } }]) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    const list = await bridge.list();
    expect(list.find((s) => s.id === 'map')).toMatchObject({
      title: '新', updatedAt: 300, runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1',
    });
  });

  it('creates local sessions through the local path', async () => {
    const db = makeDb();
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    const session = await bridge.create({ title: '本地会话', modelId: 'm1' });
    expect(session).toMatchObject({ id: 'u1', title: '本地会话', modelId: 'm1', runtime: 'local' });
  });

  it('rejects creating a server session without a connected server', async () => {
    const db = makeDb();
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await expect(bridge.create({ runtime: 'server', serverId: 'srv-1' })).rejects.toThrow('服务器未连接');
  });

  it('reads local session messages from the database', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '本地', modelId: 'm1', runtime: 'local' });
    db.getMessages = () => [{ sessionId: 'l1', position: 0, role: 'user', content: '本地消息', createdAt: 1 }];
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    const { messages } = await bridge.get('l1');
    expect(messages[0]!.content).toBe('本地消息');
  });

  it('throws when reading an offline server session', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await expect(bridge.get('l1')).rejects.toThrow('服务器未连接');
  });

  it('removes server sessions remotely and locally', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const client = { deleteSession: vi.fn(async () => true) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    await bridge.remove('l1');
    expect(client.deleteSession).toHaveBeenCalledWith('ses_1');
    expect(db.rows.has('l1')).toBe(false);
  });

  it('deletes the local mapping row when the server is offline', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await expect(bridge.remove('l1')).resolves.toBeUndefined();
    expect(db.rows.has('l1')).toBe(false);
  });

  it('deletes the local mapping row when the server is unknown', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-deleted', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await expect(bridge.remove('l1')).resolves.toBeUndefined();
    expect(db.rows.has('l1')).toBe(false);
  });

  it('removes local sessions from the database', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: 'X', modelId: 'm1', runtime: 'local' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await bridge.remove('l1');
    expect(db.rows.has('l1')).toBe(false);
  });

  it('renames server sessions remotely and locally', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '旧', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const client = { updateSession: vi.fn(async () => remoteSession) };
    const bridge = new SessionBridge({ manager: makeManager(client as never) as never, db: db as never, uuid: () => 'u1' });
    await bridge.rename('l1', '新');
    expect(client.updateSession).toHaveBeenCalledWith('ses_1', '新');
    expect(db.rows.get('l1')).toMatchObject({ title: '新' });
  });

  it('renames an offline server session locally', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '旧', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await bridge.rename('l1', '新');
    expect(db.rows.get('l1')).toMatchObject({ title: '新' });
  });

  it('renames local sessions in the database', async () => {
    const db = makeDb();
    db.createSession({ id: 'l1', title: '旧', modelId: 'm1', runtime: 'local' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    await bridge.rename('l1', '新');
    expect(db.rows.get('l1')).toMatchObject({ title: '新' });
  });

  it('applies session.updated fields to the mapped row', () => {
    const db = makeDb();
    db.createSession({ id: 'map', title: '旧', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    bridge.applyRemoteUpdate('srv-1', {
      id: 'ses_1',
      title: '新',
      time: { updated: 500 },
      model: { providerID: 'anthropic', id: 'claude-sonnet-4' },
    });
    expect(db.rows.get('map')).toMatchObject({
      title: '新', updatedAt: 500, modelId: 'anthropic/claude-sonnet-4',
    });
  });

  it('ignores unmapped remote updates and partial model info', () => {
    const db = makeDb();
    db.createSession({ id: 'map', title: '旧', modelId: 'old/model', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    bridge.applyRemoteUpdate('srv-1', { id: 'ses_unknown', title: 'x' });
    bridge.applyRemoteUpdate('srv-1', { id: 'ses_1', model: { providerID: 'anthropic' } });
    expect(db.rows.size).toBe(1);
    expect(db.rows.get('map')).toMatchObject({ title: '旧', modelId: 'old/model' });
  });

  it('removes the mapping row by remote session id', () => {
    const db = makeDb();
    db.createSession({ id: 'map', title: 'X', modelId: '', runtime: 'server', serverId: 'srv-1', remoteSessionId: 'ses_1' });
    const bridge = new SessionBridge({ manager: makeManager(null, 'error') as never, db: db as never, uuid: () => 'u1' });
    bridge.removeByRemote('srv-1', 'ses_1');
    expect(db.rows.has('map')).toBe(false);
    bridge.removeByRemote('srv-1', 'ses_missing');
    expect(db.rows.size).toBe(0);
  });
});
