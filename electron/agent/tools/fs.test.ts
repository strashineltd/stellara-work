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

  it('rejects .. path traversal', async () => {
    await fs.writeFile(path.join(tmpDir, '..', 'escape.txt'), 'x');
    const result = await readFile({ path: '../escape.txt' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超出');
  });

  it('rejects absolute path outside cwd', async () => {
    const outside = path.join(os.tmpdir(), 'outside-read-' + Date.now() + '.txt');
    await fs.writeFile(outside, 'x');
    try {
      const result = await readFile({ path: outside }, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('超出');
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('rejects symlink pointing outside cwd', async () => {
    const target = path.join(os.tmpdir(), 'symlink-target-' + Date.now() + '.txt');
    await fs.writeFile(target, 'secret');
    const link = path.join(tmpDir, 'link.txt');
    try {
      await fs.symlink(target, link);
      const result = await readFile({ path: 'link.txt' }, tmpDir);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('符号链接');
    } finally {
      await fs.rm(target, { force: true });
    }
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

  it('rejects write to symlink parent directory pointing outside', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    const linkDir = path.join(tmpDir, 'linkdir');
    try {
      await fs.symlink(outsideDir, linkDir, 'junction');
      const result = await writeFile(
        { path: path.join('linkdir', 'evil.txt'), content: 'pwned' },
        tmpDir,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('符号链接');
      // 确保文件未被创建
      await expect(fs.access(path.join(outsideDir, 'evil.txt'))).rejects.toThrow();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
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

  it('rejects ambiguous oldText that matches multiple places', async () => {
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'foo\nfoo\nbar\n');
    const result = await editFile(
      { path: 'edit.txt', oldText: 'foo', newText: 'baz' },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/匹配到.*2/);
    // 文件未变
    const content = await fs.readFile(path.join(tmpDir, 'edit.txt'), 'utf-8');
    expect(content).toBe('foo\nfoo\nbar\n');
  });

  it('rejects absolute path outside workDir', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    try {
      const result = await writeFile(
        { path: path.join(outsideDir, 'sneaky.txt'), content: 'pwned' },
        tmpDir,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('路径超出');
      // 目标文件不应被创建
      await expect(fs.access(path.join(outsideDir, 'sneaky.txt'))).rejects.toThrow();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
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

  it('rejects edit on symlink pointing outside', async () => {
    const target = path.join(os.tmpdir(), 'edit-target-' + Date.now() + '.txt');
    await fs.writeFile(target, 'original content');
    const link = path.join(tmpDir, 'link.txt');
    try {
      await fs.symlink(target, link);
      const result = await editFile(
        { path: 'link.txt', oldText: 'original', newText: 'hacked' },
        tmpDir,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('符号链接');
      // 确保目标文件未被修改
      const content = await fs.readFile(target, 'utf-8');
      expect(content).toBe('original content');
    } finally {
      await fs.rm(target, { force: true });
    }
  });
});
