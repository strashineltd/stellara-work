import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initDb, listSessions, getSession, createSession, deleteSession, renameSession, getMessages, appendMessage, saveMessages, bumpSession, _setDbPath } from './db';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-db-'));
  _setDbPath(path.join(tmpDir, 'test.db'));
  initDb();
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('db', () => {
  it('initDb creates schema (listSessions empty)', () => {
    expect(listSessions()).toEqual([]);
  });

  it('createSession + listSessions round-trips', () => {
    const s = createSession({ id: 's1', title: 'Test', modelId: 'm1' });
    expect(s.messageCount).toBe(0);
    expect(s.title).toBe('Test');
    expect(s.modelId).toBe('m1');
    const all = listSessions();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('s1');
  });

  it('listSessions orders by updatedAt DESC', async () => {
    createSession({ id: 's1', title: 'First', modelId: 'm1' });
    await new Promise((r) => setTimeout(r, 10));
    createSession({ id: 's2', title: 'Second', modelId: 'm1' });
    const all = listSessions();
    expect(all[0]?.id).toBe('s2'); // newer first
    expect(all[1]?.id).toBe('s1');
  });

  it('appendMessage + getMessages returns ordered messages', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'hi', createdAt: Date.now() });
    appendMessage({ sessionId: 's1', position: 1, role: 'assistant', content: 'hello', createdAt: Date.now() });
    const msgs = getMessages('s1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('hi');
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.content).toBe('hello');
    expect(msgs[1]?.role).toBe('assistant');
  });

  it('appendMessage updates session messageCount', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    expect(getSession('s1')?.messageCount).toBe(0);
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'a', createdAt: Date.now() });
    expect(getSession('s1')?.messageCount).toBe(1);
    appendMessage({ sessionId: 's1', position: 1, role: 'assistant', content: 'b', createdAt: Date.now() });
    expect(getSession('s1')?.messageCount).toBe(2);
  });

  it('saveMessages overwrites all', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'old', createdAt: Date.now() });
    saveMessages('s1', [
      { sessionId: 's1', position: 0, role: 'user', content: 'new1', createdAt: Date.now() },
      { sessionId: 's1', position: 1, role: 'user', content: 'new2', createdAt: Date.now() },
    ]);
    const msgs = getMessages('s1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('new1');
    expect(msgs[1]?.content).toBe('new2');
    expect(getSession('s1')?.messageCount).toBe(2);
  });

  it('renameSession updates title and bumps updatedAt', async () => {
    createSession({ id: 's1', title: 'Old', modelId: 'm1' });
    const before = getSession('s1')?.updatedAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    renameSession('s1', 'New');
    const after = getSession('s1');
    expect(after?.title).toBe('New');
    expect((after?.updatedAt ?? 0) > before).toBe(true);
  });

  it('deleteSession removes session and cascades messages', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'x', createdAt: Date.now() });
    deleteSession('s1');
    expect(getSession('s1')).toBeNull();
    expect(getMessages('s1')).toEqual([]);
  });

  it('bumpSession updates messageCount', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    bumpSession('s1', 5);
    expect(getSession('s1')?.messageCount).toBe(5);
  });

  it('handles tool messages with meta + toolCallId + toolName', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    appendMessage({
      sessionId: 's1', position: 0, role: 'user', content: 'read README', createdAt: Date.now(),
    });
    appendMessage({
      sessionId: 's1', position: 1, role: 'tool', content: 'hello world',
      toolCallId: 'call_1', toolName: 'read_file',
      meta: JSON.stringify({ kind: 'edit', path: 'README.md', before: null, after: 'hello world' }),
      createdAt: Date.now(),
    });
    const msgs = getMessages('s1');
    expect(msgs).toHaveLength(2);
    expect(msgs[1]?.role).toBe('tool');
    expect(msgs[1]?.toolName).toBe('read_file');
    expect(msgs[1]?.toolCallId).toBe('call_1');
    expect(msgs[1]?.meta).toContain('README.md');
  });

  it('foreign key cascade actually works (manual test)', () => {
    createSession({ id: 's1', title: 'T', modelId: 'm1' });
    appendMessage({ sessionId: 's1', position: 0, role: 'user', content: 'a', createdAt: Date.now() });
    deleteSession('s1');
    // The FK ON DELETE CASCADE should have removed the message
    expect(getMessages('s1')).toEqual([]);
  });
});
