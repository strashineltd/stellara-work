import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  _setDbPath, initDb, createSession, createProject, listSessions, listProjects, migrateIdentityOwnership,
  getOwnedSession, assertSessionOwned, assertProjectOwned, deleteSessionsByUser,
  listServerSessions, findSessionByRemote, findSessionByRemoteId, appendMessage, getMessages,
} from './db';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-id-')); _setDbPath(path.join(dir, 't.db')); initDb(); });
afterEach(async () => { _setDbPath(null); await fs.rm(dir, { recursive: true, force: true }); });

describe('identity ownership', () => {
  it('defaults new rows to default and filters by user', () => {
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1 });
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    createSession({ id: 's2', title: 'y', modelId: 'm', userId: 'u2' });
    expect(listProjects('default').map((p) => p.id)).toEqual(['p1']);
    expect(listSessions('u1').map((s) => s.id)).toEqual(['s1']);
    expect(listSessions('u2').map((s) => s.id)).toEqual(['s2']);
    expect(listSessions('u3')).toEqual([]);
  });

  it('rejects cross-user id access', () => {
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    expect(getOwnedSession('s1', 'u1')).toBeTruthy();
    expect(getOwnedSession('s1', 'u2')).toBeUndefined();
  });

  it('backfills legacy rows to the given user, idempotently', () => {
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1 }); // default 档
    const n = migrateIdentityOwnership('u1');
    expect(n).toBeGreaterThan(0);
    expect(listProjects('default')).toEqual([]);
    expect(listProjects('u1').map((p) => p.id)).toEqual(['p1']);
    expect(migrateIdentityOwnership('u1')).toBe(0); // 幂等
  });

  it('is a no-op when the target is the default profile', () => {
    createSession({ id: 's1', title: 'x', modelId: 'm' });
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1 });
    expect(migrateIdentityOwnership('default')).toBe(0);
    expect(listSessions('default').map((s) => s.id)).toEqual(['s1']);
    expect(listProjects('default').map((p) => p.id)).toEqual(['p1']);
  });
});

describe('ownership guards', () => {
  it('authorization helper rejects foreign sessions', () => {
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    expect(() => assertSessionOwned('s1', 'u2')).toThrow(/无权限/);
    expect(() => assertSessionOwned('s1', 'u1')).not.toThrow();
  });

  it('rejects missing sessions instead of leaking them', () => {
    expect(() => assertSessionOwned('nope', 'u1')).toThrow(/无权限访问该数据/);
  });

  it('guards projects and keeps server session mappings owned', () => {
    createProject({ id: 'p1', name: 'A', workDir: '/tmp', createdAt: 1, updatedAt: 1, userId: 'u1' });
    expect(() => assertProjectOwned('p1', 'u2')).toThrow(/无权限访问该数据/);
    expect(() => assertProjectOwned('p1', 'u1')).not.toThrow();
    expect(() => assertProjectOwned('nope', 'u1')).toThrow(/无权限访问该数据/);

    createSession({
      id: 'srv1', title: 'x', modelId: 'm', runtime: 'server',
      serverId: 'srv', remoteSessionId: 'r1', userId: 'u1',
    });
    expect(findSessionByRemote('srv', 'r1')?.id).toBe('srv1');
    expect(findSessionByRemoteId('r1')?.id).toBe('srv1');
    expect(listServerSessions('srv').map((s) => s.id)).toEqual(['srv1']);
    expect(() => assertSessionOwned('srv1', 'u2')).toThrow(/无权限访问该数据/);
    expect(() => assertSessionOwned('srv1', 'u1')).not.toThrow();
  });

  it('deletes only the target user sessions and their messages', () => {
    createSession({ id: 's1', title: 'x', modelId: 'm', userId: 'u1' });
    createSession({ id: 's2', title: 'y', modelId: 'm', userId: 'u2' });
    createSession({ id: 's3', title: 'z', modelId: 'm' });
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'hi', createdAt: 1 });
    appendMessage({ sessionId: 's2', position: 0, role: 'user', content: 'hi', createdAt: 1 });

    expect(deleteSessionsByUser('u1')).toBe(1);
    expect(listSessions('u1')).toEqual([]);
    expect(getMessages('s1')).toEqual([]);
    expect(getOwnedSession('s1', 'u1')).toBeUndefined();
    expect(listSessions('u2').map((s) => s.id)).toEqual(['s2']);
    expect(listSessions('default').map((s) => s.id)).toEqual(['s3']);
    expect(getMessages('s2')).toHaveLength(1);
  });
});
