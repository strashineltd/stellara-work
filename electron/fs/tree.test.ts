import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDirectory, createEmptyFile, listTree, readFileContent } from './tree';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-fs-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('listTree', () => {
  it('returns empty children for empty dir', async () => {
    const tree = await listTree(tmpDir, 3);
    expect(tree.type).toBe('dir');
    expect(tree.children).toEqual([]);
  });

  it('lists files and dirs', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await fs.writeFile(path.join(tmpDir, 'sub', 'b.txt'), 'world');
    const tree = await listTree(tmpDir, 3);
    expect(tree.children).toHaveLength(2);
    const names = tree.children!.map((c) => c.name).sort();
    expect(names).toEqual(['a.txt', 'sub']);
  });

  it('skips node_modules, .git, .stellara, build, dist', async () => {
    await fs.writeFile(path.join(tmpDir, 'keep.txt'), 'x');
    await fs.mkdir(path.join(tmpDir, 'node_modules'));
    await fs.mkdir(path.join(tmpDir, '.git'));
    await fs.mkdir(path.join(tmpDir, '.stellara'));
    await fs.mkdir(path.join(tmpDir, 'dist'));
    await fs.mkdir(path.join(tmpDir, 'src'));
    const tree = await listTree(tmpDir, 3);
    const names = tree.children!.map((c) => c.name).sort();
    expect(names).toEqual(['keep.txt', 'src']);
  });

  it('respects maxDepth (children stop at depth N)', async () => {
    await fs.mkdir(path.join(tmpDir, 'a/b/c/d'), { recursive: true });
    // maxDepth=2: root(0) > a(1) > b(2, no children)
    const treeDepth2 = await listTree(tmpDir, 2);
    const a = treeDepth2.children!.find((c) => c.name === 'a');
    expect(a).toBeDefined();
    expect(a!.children).toBeDefined(); // a at depth 1 has children
    const b = a!.children!.find((c) => c.name === 'b');
    expect(b).toBeDefined();
    expect(b!.children).toBeUndefined(); // b at depth 2 has NO children
  });

  it('allows some dot files (.gitignore, .env)', async () => {
    await fs.writeFile(path.join(tmpDir, '.hidden'), 'x');
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'y');
    await fs.writeFile(path.join(tmpDir, '.env'), 'SECRET=1');
    const tree = await listTree(tmpDir, 2);
    const names = tree.children!.map((c) => c.name).sort();
    expect(names).toContain('.gitignore');
    expect(names).toContain('.env');
    expect(names).not.toContain('.hidden');
  });

  it('sorts dirs first, then files', async () => {
    await fs.writeFile(path.join(tmpDir, 'z.txt'), '');
    await fs.mkdir(path.join(tmpDir, 'a-dir'));
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
    const tree = await listTree(tmpDir, 2);
    const types = tree.children!.map((c) => `${c.type}:${c.name}`);
    expect(types).toEqual(['dir:a-dir', 'file:a.txt', 'file:z.txt']);
  });

  it('does not follow symlink pointing outside cwd', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');
    const linkDir = path.join(tmpDir, 'linkdir');
    try {
      await fs.symlink(outsideDir, linkDir, 'junction');
      const tree = await listTree(tmpDir, 3);
      const linkNode = tree.children!.find((c) => c.name === 'linkdir');
      expect(linkNode).toBeDefined();
      // symlink 应显示为 file 类型，不递归
      expect(linkNode!.type).toBe('file');
      expect(linkNode!.children).toBeUndefined();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not follow symlink pointing inside cwd', async () => {
    const realDir = path.join(tmpDir, 'real');
    await fs.mkdir(realDir);
    await fs.writeFile(path.join(realDir, 'inner.txt'), 'data');
    const linkDir = path.join(tmpDir, 'linkdir');
    await fs.symlink(realDir, linkDir, 'junction');
    const tree = await listTree(tmpDir, 3);
    const linkNode = tree.children!.find((c) => c.name === 'linkdir');
    expect(linkNode).toBeDefined();
    // 即使指向内部，symlink 也不递归
    expect(linkNode!.type).toBe('file');
    expect(linkNode!.children).toBeUndefined();
  });

  it('handles broken symlink', async () => {
    const linkDir = path.join(tmpDir, 'broken-link');
    await fs.symlink(path.join(tmpDir, 'nonexistent'), linkDir);
    const tree = await listTree(tmpDir, 3);
    const linkNode = tree.children!.find((c) => c.name === 'broken-link');
    expect(linkNode).toBeDefined();
    expect(linkNode!.type).toBe('file');
  });
});

describe('readFileContent', () => {
  it('reads text file', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world');
    const result = await readFileContent(tmpDir, path.join(tmpDir, 'test.txt'));
    expect(result.content).toBe('hello world');
    expect(result.size).toBe(11);
    expect(result.truncated).toBe(false);
  });

  it('truncates large files', async () => {
    await fs.writeFile(path.join(tmpDir, 'big.txt'), 'x'.repeat(1000));
    const result = await readFileContent(tmpDir, path.join(tmpDir, 'big.txt'), 100);
    expect(result.content).toHaveLength(100);
    expect(result.size).toBe(1000);
    expect(result.truncated).toBe(true);
  });

  it('rejects paths outside workDir', async () => {
    // 写一个 tmpDir 外的文件，试着读
    const outsidePath = path.join(os.tmpdir(), 'stellara-fs-outside-' + Date.now() + '.txt');
    await fs.writeFile(outsidePath, 'outside');
    try {
      await expect(readFileContent(tmpDir, outsidePath)).rejects.toThrow(/超出/);
    } finally {
      await fs.rm(outsidePath, { force: true });
    }
  });

  it('handles missing file', async () => {
    await expect(
      readFileContent(tmpDir, path.join(tmpDir, 'missing.txt')),
    ).rejects.toThrow();
  });

  it('handles directory instead of file', async () => {
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await expect(
      readFileContent(tmpDir, path.join(tmpDir, 'sub')),
    ).rejects.toThrow(/不是文件/);
  });

  it('rejects symlink pointing outside workDir', async () => {
    const target = path.join(os.tmpdir(), 'tree-symlink-target-' + Date.now() + '.txt');
    await fs.writeFile(target, 'secret');
    const link = path.join(tmpDir, 'link.txt');
    try {
      await fs.symlink(target, link);
      await expect(readFileContent(tmpDir, link)).rejects.toThrow(/符号链接/);
    } finally {
      await fs.rm(target, { force: true });
    }
  });

  it('rejects broken symlink', async () => {
    const link = path.join(tmpDir, 'broken-link.txt');
    await fs.symlink(path.join(tmpDir, 'nonexistent'), link);
    await expect(readFileContent(tmpDir, link)).rejects.toThrow(/符号链接/);
  });
});

describe('createEmptyFile', () => {
  it('creates an empty file inside an existing work directory', async () => {
    const result = await createEmptyFile(tmpDir, 'notes.md');
    expect(result.path).toBe(path.join(tmpDir, 'notes.md'));
    expect(await fs.readFile(result.path, 'utf-8')).toBe('');
  });

  it('creates a file in an existing nested directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'));
    const result = await createEmptyFile(tmpDir, 'docs/brief.md');
    expect(result.path).toBe(path.join(tmpDir, 'docs', 'brief.md'));
  });

  it('never overwrites an existing file', async () => {
    const target = path.join(tmpDir, 'keep.txt');
    await fs.writeFile(target, 'keep');
    await expect(createEmptyFile(tmpDir, 'keep.txt')).rejects.toThrow(/已存在/);
    expect(await fs.readFile(target, 'utf-8')).toBe('keep');
  });

  it('rejects traversal and missing parent directories', async () => {
    await expect(createEmptyFile(tmpDir, '../outside.txt')).rejects.toThrow(/超出/);
    await expect(createEmptyFile(tmpDir, 'missing/file.txt')).rejects.toThrow(/父目录不存在/);
  });
});

describe('createDirectory', () => {
  it('creates a directory inside an existing work directory', async () => {
    const result = await createDirectory(tmpDir, 'new-folder');
    expect(result.path).toBe(path.join(tmpDir, 'new-folder'));
    expect((await fs.stat(result.path)).isDirectory()).toBe(true);
  });

  it('creates a directory in an existing nested directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'));
    const result = await createDirectory(tmpDir, 'docs/notes');
    expect(result.path).toBe(path.join(tmpDir, 'docs', 'notes'));
    expect((await fs.stat(result.path)).isDirectory()).toBe(true);
  });

  it('rejects an existing target', async () => {
    await fs.mkdir(path.join(tmpDir, 'exists'));
    await expect(createDirectory(tmpDir, 'exists')).rejects.toThrow(/已存在/);
  });

  it('rejects absolute paths', async () => {
    const abs = path.join(tmpDir, 'evil');
    await expect(createDirectory(tmpDir, abs)).rejects.toThrow(/相对路径/);
  });

  it('rejects traversal and missing parent directories', async () => {
    await expect(createDirectory(tmpDir, '../outside')).rejects.toThrow(/超出/);
    await expect(createDirectory(tmpDir, 'missing/sub')).rejects.toThrow(/父目录不存在/);
  });
});
