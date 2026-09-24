import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { grantWorkDir, _resetGrantedForTests } from '../security/workdir-grants';
import { assertScheduledWorkDir, isScheduledWorkDirTrusted } from './workdir';

describe('assertScheduledWorkDir (S1)', () => {
  let tmpRoot: string;
  let workDir: string;
  let projectDir: string;
  let evilDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sched-wd-'));
    workDir = path.join(tmpRoot, 'work');
    projectDir = path.join(tmpRoot, 'project');
    evilDir = path.join(tmpRoot, 'evil');
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(evilDir, { recursive: true });
    _resetGrantedForTests();
  });

  afterEach(async () => {
    _resetGrantedForTests();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const emptySources = { projectWorkDirs: [], modelWorkDirs: [] };

  it('rejects an ungranted arbitrary workDir (renderer cannot plant)', async () => {
    await expect(assertScheduledWorkDir(evilDir, emptySources)).rejects.toThrow('未经选择器或项目授权');
    expect(await isScheduledWorkDirTrusted(evilDir, emptySources)).toBe(false);
  });

  it('accepts a picker-granted workDir', async () => {
    await grantWorkDir(workDir);
    await expect(assertScheduledWorkDir(workDir, emptySources)).resolves.toBeUndefined();
  });

  it('accepts an existing project workDir', async () => {
    await expect(
      assertScheduledWorkDir(projectDir, { projectWorkDirs: [projectDir], modelWorkDirs: [] }),
    ).resolves.toBeUndefined();
  });

  it('accepts a configured model workDir', async () => {
    await expect(
      assertScheduledWorkDir(workDir, { projectWorkDirs: [], modelWorkDirs: [workDir] }),
    ).resolves.toBeUndefined();
  });

  it('does not trust session-only workDirs via sources that omit projects/models', async () => {
    // 模拟「会话里已有 workDir」—— sources 不含 projects/models 时必须拒绝
    await expect(
      assertScheduledWorkDir(evilDir, { projectWorkDirs: [], modelWorkDirs: [] }),
    ).rejects.toThrow();
  });

  it('treats empty / null workDir as deferred to model at run time', async () => {
    await expect(assertScheduledWorkDir(undefined, emptySources)).resolves.toBeUndefined();
    await expect(assertScheduledWorkDir(null, emptySources)).resolves.toBeUndefined();
    await expect(assertScheduledWorkDir('', emptySources)).resolves.toBeUndefined();
  });

  it('rejects non-string workDir', async () => {
    await expect(
      assertScheduledWorkDir({ evil: true } as unknown as string, emptySources),
    ).rejects.toThrow('工作目录无效');
  });
});
