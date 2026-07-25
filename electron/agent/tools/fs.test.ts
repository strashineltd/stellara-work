import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFile, writeFile, editFile } from './fs';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readFile', () => {
  it('reads file content', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello');
    const result = await readFile({ path: 'test.txt' }, tmpDir);
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hello');
  });

  it('returns error for non-existent file', async () => {
    const result = await readFile({ path: 'missing.txt' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('writeFile', () => {
  it('writes file', async () => {
    const result = await writeFile({ path: 'out.txt', content: 'world' }, tmpDir);
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'out.txt'), 'utf-8');
    expect(content).toBe('world');
  });

  it('creates parent directories', async () => {
    const result = await writeFile(
      { path: 'a/b/c/out.txt', content: 'nested' },
      tmpDir,
    );
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'a/b/c/out.txt'), 'utf-8');
    expect(content).toBe('nested');
  });

  it('returns edit meta (before=null for new file, after=content)', async () => {
    const result = await writeFile({ path: 'fresh.txt', content: 'fresh' }, tmpDir);
    expect(result.meta).toEqual({ kind: 'edit', path: 'fresh.txt', before: null, after: 'fresh' });
  });

  it('returns edit meta with before content when overwriting', async () => {
    await fs.writeFile(path.join(tmpDir, 'over.txt'), 'old');
    const result = await writeFile({ path: 'over.txt', content: 'new' }, tmpDir);
    expect(result.meta).toEqual({ kind: 'edit', path: 'over.txt', before: 'old', after: 'new' });
  });
});

describe('editFile', () => {
  it('replaces exact text', async () => {
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'hello world\n');
    const result = await editFile(
      { path: 'edit.txt', oldText: 'world', newText: 'planet' },
      tmpDir,
    );
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'edit.txt'), 'utf-8');
    expect(content).toBe('hello planet\n');
  });

  it('returns error when oldText not found', async () => {
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'hello');
    const result = await editFile(
      { path: 'edit.txt', oldText: 'missing', newText: 'replaced' },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未找到');
  });

  it('returns edit meta with before and after content', async () => {
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'line1\nline2\nline3\n');
    const result = await editFile(
      { path: 'edit.txt', oldText: 'line2', newText: 'LINE2' },
      tmpDir,
    );
    expect(result.meta).toEqual({
      kind: 'edit',
      path: 'edit.txt',
      before: 'line1\nline2\nline3\n',
      after: 'line1\nLINE2\nline3\n',
    });
  });
});
