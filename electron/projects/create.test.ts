import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProjectGuarded, type ProjectCreateDeps } from './create';
import { grantWorkDir, _resetGrantedForTests } from '../security/workdir-grants';

let tmpRoot: string;
let workDir: string;

beforeEach(async () => {
  _resetGrantedForTests();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-proj-'));
  workDir = path.join(tmpRoot, 'workspace');
  await fs.mkdir(workDir, { recursive: true });
});

afterEach(async () => {
  _resetGrantedForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function deps(over: Partial<ProjectCreateDeps> = {}): ProjectCreateDeps {
  return {
    newId: () => 'id-1',
    verifySelection: vi.fn(async (dir: string, file: string) => ({ workDir: dir, path: file })),
    persist: vi.fn((p) => ({ ...p, createdAt: 1, updatedAt: 1 })),
    ...over,
  };
}

describe('createProjectGuarded', () => {
  it('rejects an ungranted workDir and never persists', async () => {
    const persist = vi.fn();
    await expect(
      createProjectGuarded({ name: 'P', workDir }, deps({ persist })),
    ).rejects.toThrow('工作目录未经选择器授权，请重新选择');
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists after the workDir is granted through the native picker path', async () => {
    await grantWorkDir(workDir);
    const persist = vi.fn((p) => ({ ...p, createdAt: 1, updatedAt: 1 }));
    const project = await createProjectGuarded(
      { name: '  My Project  ', workDir },
      deps({ persist, newId: () => 'id-42' }),
    );
    expect(persist).toHaveBeenCalledWith({
      id: 'id-42',
      name: 'My Project',
      workDir: path.resolve(workDir),
      entryFile: undefined,
    });
    expect(project.workDir).toBe(path.resolve(workDir));
  });

  it('verifies the entry file only when provided', async () => {
    await grantWorkDir(workDir);
    const verifySelection = vi.fn(async (dir: string, file: string) => ({ workDir: dir, path: file }));
    const persist = vi.fn((p) => ({ ...p, createdAt: 1, updatedAt: 1 }));
    const entry = path.join(workDir, 'README.md');
    const project = await createProjectGuarded(
      { name: 'P', workDir, entryFile: entry },
      deps({ verifySelection, persist }),
    );
    expect(verifySelection).toHaveBeenCalledWith(path.resolve(workDir), entry);
    expect(project.entryFile).toBe(entry);
  });

  it('propagates entry verification failures without persisting', async () => {
    await grantWorkDir(workDir);
    const persist = vi.fn();
    const verifySelection = vi.fn(async () => {
      throw new Error('项目入口必须是文件');
    });
    await expect(
      createProjectGuarded({ name: 'P', workDir, entryFile: '/outside/x' }, deps({ verifySelection, persist })),
    ).rejects.toThrow('项目入口必须是文件');
    expect(persist).not.toHaveBeenCalled();
  });

  it('keeps name/workDir validation', async () => {
    await expect(createProjectGuarded({ name: '   ', workDir }, deps())).rejects.toThrow('项目名称不能为空');
    await expect(createProjectGuarded({ name: 'P', workDir: '  ' }, deps())).rejects.toThrow('请选择项目文件夹');
  });
});
