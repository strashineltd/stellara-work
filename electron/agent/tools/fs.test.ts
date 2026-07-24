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
});
