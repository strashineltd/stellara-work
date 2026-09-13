import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  grantWorkDir,
  isWorkDirGranted,
  assertWorkDirGranted,
  grantAttachmentSources,
  findUngrantedAttachmentSources,
  normalizeWorkDir,
  _resetGrantedForTests,
} from './workdir-grants';

let tmpRoot: string;
let workDir: string;
let outsideDir: string;

beforeEach(async () => {
  _resetGrantedForTests();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-grant-'));
  workDir = path.join(tmpRoot, 'work');
  outsideDir = path.join(tmpRoot, 'outside');
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });
});

afterEach(async () => {
  _resetGrantedForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function makeFile(dir: string, name: string): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, 'x');
  return p;
}

describe('workDir grants', () => {
  it('rejects a workDir that no native picker has granted', async () => {
    await expect(assertWorkDirGranted(workDir)).rejects.toThrow('工作目录未经选择器授权，请重新选择');
    expect(await isWorkDirGranted(workDir)).toBe(false);
  });

  it('accepts a workDir after grantWorkDir (native picker path)', async () => {
    const returned = await grantWorkDir(workDir);
    expect(returned).toBe(path.resolve(workDir));
    expect(await isWorkDirGranted(workDir)).toBe(true);
    await expect(assertWorkDirGranted(workDir)).resolves.toBeUndefined();
  });

  it('normalizes equivalent spellings of the granted directory', async () => {
    await grantWorkDir(workDir);
    await expect(assertWorkDirGranted(path.join(workDir, '.'))).resolves.toBeUndefined();
  });

  it('normalizeWorkDir resolves symlinked tmp roots via realpath', async () => {
    expect(await normalizeWorkDir(workDir)).toBe(await fs.realpath(workDir));
  });

  it('does not treat a subdirectory as the granted directory', async () => {
    await grantWorkDir(workDir);
    await expect(assertWorkDirGranted(path.join(workDir, 'sub'))).rejects.toThrow('工作目录未经选择器授权');
  });
});

describe('attachment source provenance', () => {
  it('does not flag files inside a granted work dir', async () => {
    await grantWorkDir(workDir);
    const file = await makeFile(workDir, 'a.txt');
    await expect(findUngrantedAttachmentSources([file], [])).resolves.toEqual([]);
  });

  it('flags absolute paths outside every granted dir', async () => {
    await grantWorkDir(workDir);
    const file = await makeFile(outsideDir, 'secret.txt');
    await expect(findUngrantedAttachmentSources([file], [])).resolves.toEqual([path.resolve(file)]);
  });

  it('treats the current session workDir (already asserted) as frictionless', async () => {
    const file = await makeFile(workDir, 'a.txt');
    await expect(findUngrantedAttachmentSources([file], [workDir])).resolves.toEqual([]);
  });

  it('treats dialog-picked attachment sources as granted even outside work dirs', async () => {
    const file = await makeFile(outsideDir, 'picked.txt');
    await grantAttachmentSources([file]);
    await expect(findUngrantedAttachmentSources([file], [])).resolves.toEqual([]);
  });
});
