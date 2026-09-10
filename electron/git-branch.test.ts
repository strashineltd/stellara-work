import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGitBranch } from './git-branch';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'stellara-git-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readGitBranch', () => {
  it('reads a symbolic ref from .git/HEAD', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/shell\n');
    expect(await readGitBranch(dir)).toBe('feature/shell');
  });

  it('walks up to find .git/HEAD', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const nested = path.join(dir, 'src', 'deep');
    await mkdir(nested, { recursive: true });
    expect(await readGitBranch(nested)).toBe('main');
  });

  it('returns a short hash for detached HEAD', async () => {
    const dir = await fixture();
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'HEAD'), '9c4f1a2b3d4e5f60718293a4b5c6d7e8f9012345\n');
    expect(await readGitBranch(dir)).toBe('9c4f1a2');
  });

  it('returns null outside a repository and for missing paths', async () => {
    const dir = await fixture();
    expect(await readGitBranch(dir)).toBeNull();
    expect(await readGitBranch(path.join(dir, 'missing'))).toBeNull();
  });
});
