import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolvePath,
  isWithinDir,
  verifyExistingPath,
  verifyWritePath,
} from './path-security';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-ps-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('resolvePath', () => {
  it('resolves relative path against cwd', () => {
    expect(resolvePath('foo.txt', tmpDir)).toBe(path.normalize(path.resolve(tmpDir, 'foo.txt')));
  });

  it('returns normalized absolute path', () => {
    const abs = path.join(tmpDir, 'foo.txt');
    expect(resolvePath(abs, tmpDir)).toBe(path.normalize(abs));
  });
});

describe('isWithinDir', () => {
  it('accepts path within dir', () => {
    expect(isWithinDir(path.join(tmpDir, 'a.txt'), tmpDir)).toBe(true);
  });

  it('accepts nested path', () => {
    expect(isWithinDir(path.join(tmpDir, 'sub', 'a.txt'), tmpDir)).toBe(true);
  });

  it('rejects .. traversal', () => {
    expect(isWithinDir(path.join(tmpDir, '..', 'escape.txt'), tmpDir)).toBe(false);
  });

  it('rejects absolute path outside', () => {
    expect(isWithinDir('/some/other/path', tmpDir)).toBe(false);
  });

  it('accepts cwd itself', () => {
    expect(isWithinDir(tmpDir, tmpDir)).toBe(true);
  });
});

describe('verifyExistingPath', () => {
  it('accepts normal file', async () => {
    const f = path.join(tmpDir, 'ok.txt');
    await fs.writeFile(f, 'data');
    const result = await verifyExistingPath(f, tmpDir);
    expect(result.ok).toBe(true);
  });

  it('rejects path outside cwd', async () => {
    const outside = path.join(os.tmpdir(), 'outside-' + Date.now() + '.txt');
    await fs.writeFile(outside, 'x');
    try {
      const result = await verifyExistingPath(outside, tmpDir);
      expect(result.ok).toBe(false);
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
      const result = await verifyExistingPath(link, tmpDir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('符号链接');
    } finally {
      await fs.rm(target, { force: true });
    }
  });

  it('accepts symlink pointing inside cwd', async () => {
    const target = path.join(tmpDir, 'real.txt');
    await fs.writeFile(target, 'data');
    const link = path.join(tmpDir, 'link.txt');
    await fs.symlink(target, link);
    const result = await verifyExistingPath(link, tmpDir);
    expect(result.ok).toBe(true);
  });

  it('rejects broken symlink', async () => {
    const link = path.join(tmpDir, 'broken.txt');
    await fs.symlink(path.join(tmpDir, 'nonexistent'), link);
    const result = await verifyExistingPath(link, tmpDir);
    expect(result.ok).toBe(false);
  });

  it('rejects non-existent path', async () => {
    const result = await verifyExistingPath(path.join(tmpDir, 'nope.txt'), tmpDir);
    expect(result.ok).toBe(false);
  });

  it('rejects directory symlink pointing outside', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    const linkDir = path.join(tmpDir, 'linkdir');
    try {
      await fs.symlink(outsideDir, linkDir, 'junction');
      const result = await verifyExistingPath(linkDir, tmpDir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('符号链接');
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('verifyWritePath', () => {
  it('accepts new file in existing dir', async () => {
    const target = path.join(tmpDir, 'new.txt');
    const result = await verifyWritePath(target, tmpDir);
    expect(result.ok).toBe(true);
  });

  it('accepts new file in nested existing dir', async () => {
    await fs.mkdir(path.join(tmpDir, 'sub'));
    const target = path.join(tmpDir, 'sub', 'new.txt');
    const result = await verifyWritePath(target, tmpDir);
    expect(result.ok).toBe(true);
  });

  it('rejects write to path outside cwd', async () => {
    const target = path.join(os.tmpdir(), 'outside-write-' + Date.now() + '.txt');
    const result = await verifyWritePath(target, tmpDir);
    expect(result.ok).toBe(false);
  });

  it('rejects write under symlink directory', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-outside-'));
    const linkDir = path.join(tmpDir, 'linkdir');
    try {
      await fs.symlink(outsideDir, linkDir, 'junction');
      const target = path.join(linkDir, 'new.txt');
      const result = await verifyWritePath(target, tmpDir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('符号链接');
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('accepts existing file within cwd', async () => {
    const f = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(f, 'data');
    const result = await verifyWritePath(f, tmpDir);
    expect(result.ok).toBe(true);
  });

  it('rejects existing symlink pointing outside', async () => {
    const target = path.join(os.tmpdir(), 'ext-' + Date.now() + '.txt');
    await fs.writeFile(target, 'x');
    const link = path.join(tmpDir, 'link.txt');
    try {
      await fs.symlink(target, link);
      const result = await verifyWritePath(link, tmpDir);
      expect(result.ok).toBe(false);
    } finally {
      await fs.rm(target, { force: true });
    }
  });
});
