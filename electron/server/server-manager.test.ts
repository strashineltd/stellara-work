import { describe, expect, it, vi } from 'vitest';
import { ServerManager, type ServerManagerDeps } from './server-manager';

function entry(id: string, url = 'http://localhost:4096') {
  return { id, name: id, url, createdAt: '2026-09-10T00:00:00Z' };
}

function makeManager(overrides: Partial<ServerManagerDeps> = {}) {
  const entries = new Map([['srv-1', entry('srv-1')]]);
  const statuses: string[] = [];
  const clients = new Map<string, { health: ReturnType<typeof vi.fn>; subscribeEvents: ReturnType<typeof vi.fn>; listSessions: ReturnType<typeof vi.fn> }>();
  const deps: ServerManagerDeps = {
    loadEntries: async () => [...entries.values()],
    addEntry: async (e) => { entries.set(e.id, e); },
    updateEntry: async (id, patch) => { entries.set(id, { ...entries.get(id)!, ...patch }); },
    removeEntry: async (id) => { entries.delete(id); },
    getPassword: () => null,
    setPassword: async () => {},
    deletePassword: async () => {},
    createClient: (e) => {
      const client = {
        health: vi.fn(async () => ({ healthy: true, version: '1.0.0' })),
        subscribeEvents: vi.fn(() => () => {}),
        listSessions: vi.fn(async () => []),
      };
      clients.set(e.id, client);
      return client as never;
    },
    ...overrides,
  };
  const manager = new ServerManager(deps);
  manager.onStatusChanged((s) => statuses.push(s.map((x) => `${x.id}:${x.status}`).join(',')));
  return { manager, entries, statuses, clients };
}

describe('ServerManager', () => {
  it('connects and reports status transitions', async () => {
    const { manager, statuses } = makeManager();
    await manager.connectAll();
    expect(statuses.at(-1)).toBe('srv-1:connected');
    expect(manager.getClient('srv-1')).not.toBeNull();
    expect(manager.statuses()[0]).toMatchObject({ id: 'srv-1', status: 'connected', version: '1.0.0' });
  });

  it('reports error status when health fails', async () => {
    const { manager } = makeManager({
      createClient: () => ({ health: async () => { throw new Error('HTTP 401: unauthorized'); }, subscribeEvents: () => () => {}, listSessions: async () => [] }) as never,
    });
    await manager.connectAll();
    expect(manager.statuses()[0]).toMatchObject({ id: 'srv-1', status: 'error' });
    expect(manager.statuses()[0]!.error).toContain('401');
    expect(manager.getClient('srv-1')).toBeNull();
  });

  it('validates urls on add and does not save them', async () => {
    const addEntry = vi.fn();
    const { manager } = makeManager({ addEntry });
    await expect(manager.add({ url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
    expect(addEntry).not.toHaveBeenCalled();
  });

  it('adds a valid server, stores password and hides it from list()', async () => {
    const setPassword = vi.fn(async () => {});
    const { manager } = makeManager({ setPassword });
    const added = await manager.add({ url: 'http://127.0.0.1:4096', name: 'B', password: 'pw' });
    expect(added).toMatchObject({ name: 'B', hasPassword: true, isDefault: false });
    expect(JSON.stringify(added)).not.toContain('pw');
    expect(setPassword).toHaveBeenCalledWith(added.id, 'pw');
  });

  it('forwards remote events from subscribed clients', async () => {
    const listeners: Array<(e: unknown) => void> = [];
    const { manager } = makeManager({
      createClient: () => ({ health: async () => ({ healthy: true }), subscribeEvents: (cb: (e: unknown) => void) => { listeners.push(cb); return () => {}; }, listSessions: async () => [] }) as never,
    });
    const received: string[] = [];
    manager.onEvent((id, event) => received.push(`${id}:${(event as { type: string }).type}`));
    await manager.connectAll();
    listeners[0]!({ type: 'session.idle', properties: { sessionID: 's1' } });
    expect(received).toEqual(['srv-1:session.idle']);
  });

  it('reports stored password presence and default flag in list()', async () => {
    const { manager } = makeManager({
      getPassword: (id) => (id === 'srv-1' ? 'stored-secret' : null),
      getDefaultServerId: () => 'srv-1',
    });
    const list = await manager.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'srv-1', hasPassword: true, isDefault: true });
    expect(JSON.stringify(list)).not.toContain('stored-secret');
  });

  it('rejects auth failures on add with 鉴权失败 and persists nothing', async () => {
    const addEntry = vi.fn();
    const setPassword = vi.fn(async () => {});
    const { manager } = makeManager({
      addEntry,
      setPassword,
      createClient: () => ({ health: async () => { throw new Error('HTTP 401: unauthorized'); }, subscribeEvents: () => () => {}, listSessions: async () => [] }) as never,
    });
    await expect(manager.add({ url: 'http://127.0.0.1:4096', password: 'bad' })).rejects.toThrow(/鉴权失败/);
    expect(addEntry).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('rejects network failures on add with 连接失败', async () => {
    const { manager } = makeManager({
      createClient: () => ({ health: async () => { throw new TypeError('fetch failed'); }, subscribeEvents: () => () => {}, listSessions: async () => [] }) as never,
    });
    await expect(manager.add({ url: 'http://127.0.0.1:4096' })).rejects.toThrow(/连接失败/);
  });

  it('updates entry fields and revalidates urls before persisting', async () => {
    const updateEntry = vi.fn(async () => {});
    const { manager } = makeManager({ updateEntry });
    const updated = await manager.update('srv-1', { url: 'http://127.0.0.1:5000/', name: 'Renamed' });
    expect(updated).toMatchObject({ id: 'srv-1', name: 'Renamed', url: 'http://127.0.0.1:5000' });
    expect(updateEntry).toHaveBeenCalledWith('srv-1', { url: 'http://127.0.0.1:5000', name: 'Renamed' });
    await expect(manager.update('srv-1', { url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
    expect(updateEntry).toHaveBeenCalledTimes(1);
    await expect(manager.update('ghost', { name: 'x' })).rejects.toThrow(/不存在/);
  });

  it('clears password through update with an empty string', async () => {
    const deletePassword = vi.fn(async () => {});
    const setPassword = vi.fn(async () => {});
    const { manager } = makeManager({ deletePassword, setPassword });
    await manager.update('srv-1', { password: '' });
    expect(deletePassword).toHaveBeenCalledWith('srv-1');
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('reconnects a connected server after url change', async () => {
    const health = vi.fn(async () => ({ healthy: true, version: '3.0.0' }));
    const unsub = vi.fn(() => {});
    const { manager } = makeManager({
      createClient: () => ({ health, subscribeEvents: () => unsub, listSessions: async () => [] }) as never,
    });
    await manager.connectAll();
    expect(health).toHaveBeenCalledTimes(1);
    await manager.update('srv-1', { url: 'http://127.0.0.1:6000' });
    expect(health).toHaveBeenCalledTimes(2);
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(manager.statuses()[0]).toMatchObject({ id: 'srv-1', status: 'connected' });
  });

  it('removes server, credentials and runtime status', async () => {
    const removeEntry = vi.fn(async () => {});
    const deletePassword = vi.fn(async () => {});
    const { manager } = makeManager({ removeEntry, deletePassword });
    await manager.connectAll();
    await manager.remove('srv-1');
    expect(manager.getClient('srv-1')).toBeNull();
    expect(deletePassword).toHaveBeenCalledWith('srv-1');
    expect(removeEntry).toHaveBeenCalledWith('srv-1');
    expect(manager.statuses()).toEqual([]);
  });

  it('sets the default server and rejects unknown ids', async () => {
    const setDefaultServerId = vi.fn(async () => {});
    const { manager } = makeManager({ setDefaultServerId });
    await manager.setDefault('srv-1');
    expect(setDefaultServerId).toHaveBeenCalledWith('srv-1');
    await manager.setDefault(null);
    expect(setDefaultServerId).toHaveBeenLastCalledWith(null);
    await expect(manager.setDefault('ghost')).rejects.toThrow(/不存在/);
  });

  it('treats setDefault as a no-op without a default setter', async () => {
    const { manager } = makeManager();
    await expect(manager.setDefault('srv-1')).resolves.toBeUndefined();
    expect((await manager.list())[0]!.isDefault).toBe(false);
  });

  it('tests a server without changing its runtime status', async () => {
    const { manager } = makeManager({
      createClient: () => ({ health: async () => ({ healthy: true, version: '2.0.0' }), subscribeEvents: () => () => {}, listSessions: async () => [] }) as never,
    });
    const result = await manager.test('srv-1');
    expect(result).toEqual({ ok: true, status: 'connected', version: '2.0.0' });
    expect(manager.statuses()).toEqual([{ id: 'srv-1', status: 'disconnected' }]);
    expect(manager.getClient('srv-1')).toBeNull();
  });

  it('reports distinguishable test errors for auth failures', async () => {
    const { manager } = makeManager({
      createClient: () => ({ health: async () => { throw new Error('HTTP 401: unauthorized'); }, subscribeEvents: () => () => {}, listSessions: async () => [] }) as never,
    });
    const result = await manager.test('srv-1');
    expect(result).toMatchObject({ ok: false, status: 'error' });
    expect(result.error).toContain('鉴权失败');
  });

  it('disconnects all and unsubscribes clients', async () => {
    const unsub = vi.fn(() => {});
    const { manager } = makeManager({
      createClient: () => ({ health: async () => ({ healthy: true }), subscribeEvents: () => unsub, listSessions: async () => [] }) as never,
    });
    await manager.connectAll();
    manager.disconnectAll();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(manager.getClient('srv-1')).toBeNull();
    expect(manager.statuses()).toEqual([{ id: 'srv-1', status: 'disconnected' }]);
  });

  it('maps client reconnect events to connecting/connected statuses', async () => {
    let statusCallback: ((status: 'connected' | 'reconnecting') => void) | undefined;
    const { manager } = makeManager({
      createClient: () => ({
        health: async () => ({ healthy: true }),
        subscribeEvents: (_cb: (event: unknown) => void, cb: (status: 'connected' | 'reconnecting') => void) => {
          statusCallback = cb;
          return () => {};
        },
        listSessions: async () => [],
      }) as never,
    });
    await manager.connectAll();
    statusCallback!('reconnecting');
    expect(manager.statuses()[0]).toMatchObject({ status: 'connecting' });
    statusCallback!('connected');
    expect(manager.statuses()[0]).toMatchObject({ status: 'connected' });
  });
});
