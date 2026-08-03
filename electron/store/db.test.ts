import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import {
  initDb, listSessions, getSession, createSession, deleteSession, renameSession,
  getMessages, appendMessage, saveMessages, bumpSession, _setDbPath,
  createProject, getProject, listProjects, renameProject, deleteProject, moveSession, updateProjectFile,
  countAllMessages,
} from './db';

let tmpDir: string;
let dbFile: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-db-'));
  dbFile = path.join(tmpDir, 'test.db');
  _setDbPath(dbFile);
});

afterEach(async () => {
  _setDbPath(null);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('db', () => {
  it('initDb creates schema (listSessions empty)', () => {
    initDb();
    expect(listSessions()).toEqual([]);
  });

  it('migrates a legacy sessions table before creating the project index', () => {
    const legacyDb = new Database(dbFile);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model_id TEXT NOT NULL,
        work_dir TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
      INSERT INTO sessions (
        id, title, model_id, work_dir, created_at, updated_at, message_count
      ) VALUES (
        'legacy-session', 'Legacy task', 'm1', NULL, 1, 1, 0
      );
    `);
    legacyDb.close();

    expect(() => initDb()).not.toThrow();
    expect(getSession('legacy-session')?.projectId).toBeUndefined();

    createProject({ id: 'legacy-project', name: 'Legacy project' });
    moveSession('legacy-session', 'legacy-project');
    deleteProject('legacy-project');

    expect(getSession('legacy-session')?.projectId).toBeUndefined();
    expect(getProject('legacy-project')).toBeNull();
  });

  it('adds and persists the project entry file for legacy project tables', () => {
    const legacyDb = new Database(dbFile);
    legacyDb.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        work_dir TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO projects (id, name, work_dir, created_at, updated_at)
      VALUES ('legacy-project', 'Legacy', 'D:/old', 1, 1);
    `);
    legacyDb.close();

    initDb();
    expect(getProject('legacy-project')?.entryFile).toBeUndefined();
    const updated = updateProjectFile('legacy-project', 'D:/new', 'D:/new/README.md');
    expect(updated.workDir).toBe('D:/new');
    expect(updated.entryFile).toBe('D:/new/README.md');

    const created = createProject({ id: 'new-project', name: 'New', workDir: 'D:/new', entryFile: 'D:/new/index.ts' });
    expect(created.entryFile).toBe('D:/new/index.ts');
    expect(getProject('new-project')?.entryFile).toBe('D:/new/index.ts');
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

  it('renames a project and rejects missing or empty targets', () => {
    createProject({ id: 'p1', name: 'Old name', workDir: 'D:/workspace' });
    expect(getProject('p1')?.workDir).toBe('D:/workspace');
    renameProject('p1', '  New name  ');
    expect(getProject('p1')?.name).toBe('New name');
    expect(() => renameProject('missing', 'Name')).toThrow('项目不存在');
    expect(() => renameProject('p1', '   ')).toThrow('项目名称不能为空');
  });

  it('deletes a project and explicitly moves its sessions to unassigned', () => {
    createProject({ id: 'p1', name: 'Project' });
    createSession({ id: 's1', title: 'Task', modelId: 'm1', projectId: 'p1' });

    deleteProject('p1');

    expect(listProjects()).toEqual([]);
    expect(getSession('s1')?.projectId).toBeUndefined();
    expect(() => deleteProject('p1')).toThrow('项目不存在');
  });

  // 复现 user 报的 bug：A 聊完后创建 B，再切回 A，A 的内容不能丢
  it('regression: chat in A, create B, switch back to A — A content preserved', () => {
    // 1. 建 A
    createSession({ id: 'A', title: 'A', modelId: 'm1' });
    // 2. 在 A 里聊（user 消息 + assistant 回复）
    appendMessage({ sessionId: 'A', position: 0, role: 'user', content: 'A 里的问题', createdAt: Date.now() });
    appendMessage({ sessionId: 'A', position: 1, role: 'assistant', content: 'A 里的回答', createdAt: Date.now() });
    // 3. 触发 autosave（renderer 里 debounce 300ms 后会调 saveMessages，这里直接调）
    saveMessages('A', [
      { sessionId: 'A', position: 0, role: 'user', content: 'A 里的问题', createdAt: Date.now() },
      { sessionId: 'A', position: 1, role: 'assistant', content: 'A 里的回答', createdAt: Date.now() },
    ]);
    // 4. 创建 B
    createSession({ id: 'B', title: 'B', modelId: 'm1' });
    // 5. 切回 A，重新读 A 的消息
    const aMsgs = getMessages('A');
    expect(aMsgs).toHaveLength(2);
    expect(aMsgs[0]?.content).toBe('A 里的问题');
    expect(aMsgs[1]?.content).toBe('A 里的回答');
  });

  // 切 session 时的 flush 行为：有 N 条消息，save 回去 N 条，不应该把 A 的内容清掉
  it('regression: flush save with same count preserves A content (not delete-all bug)', () => {
    createSession({ id: 'A', title: 'A', modelId: 'm1' });
    saveMessages('A', [
      { sessionId: 'A', position: 0, role: 'user', content: 'q', createdAt: Date.now() },
      { sessionId: 'A', position: 1, role: 'assistant', content: 'a', createdAt: Date.now() },
    ]);
    // 模拟切 session 时 flush：还是这 2 条消息
    saveMessages('A', [
      { sessionId: 'A', position: 0, role: 'user', content: 'q', createdAt: Date.now() },
      { sessionId: 'A', position: 1, role: 'assistant', content: 'a', createdAt: Date.now() },
    ]);
    const msgs = getMessages('A');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('q');
    expect(msgs[1]?.content).toBe('a');
  });

  it('countAllMessages returns the total message count across sessions', () => {
    initDb();
    createSession({ id: 'a', title: 'A', modelId: 'm' });
    createSession({ id: 'b', title: 'B', modelId: 'm' });
    appendMessage({ sessionId: 'a', position: 0, role: 'user', content: 'hi', createdAt: Date.now() });
    appendMessage({ sessionId: 'a', position: 1, role: 'assistant', content: 'yo', createdAt: Date.now() });
    appendMessage({ sessionId: 'b', position: 0, role: 'user', content: 'x', createdAt: Date.now() });
    expect(countAllMessages()).toBe(3);
  });
});
