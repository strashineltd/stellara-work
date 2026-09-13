/**
 * 项目创建（projects:create 处理器核心）。
 *
 * workDir 必须已由原生选择器授权（grantWorkDir），
 * 防止渲染层用任意路径创建项目来种子化工作区白名单（C2）。
 */
import path from 'node:path';
import { assertWorkDirGranted } from '../security/workdir-grants';
import type { ProjectFileSelection } from '../../shared/ipc';
import type { Project } from '../store/db';

export interface ProjectCreateInput {
  name: string;
  workDir: string;
  entryFile?: string;
}

export interface ProjectCreateDeps {
  newId: () => string;
  verifySelection: (workDir: string, filePath: string) => Promise<ProjectFileSelection>;
  persist: (project: { id: string; name: string; workDir: string; entryFile?: string }) => Project;
}

export async function createProjectGuarded(input: ProjectCreateInput, deps: ProjectCreateDeps): Promise<Project> {
  if (typeof input?.name !== 'string' || !input.name.trim()) throw new Error('项目名称不能为空');
  if (typeof input?.workDir !== 'string' || !input.workDir.trim()) throw new Error('请选择项目文件夹');

  const workDir = path.resolve(input.workDir.trim());
  await assertWorkDirGranted(workDir);

  let entryFile: string | undefined;
  if (typeof input.entryFile === 'string' && input.entryFile.trim()) {
    const selection = await deps.verifySelection(workDir, input.entryFile.trim());
    entryFile = selection.path;
  }

  return deps.persist({
    id: deps.newId(),
    name: input.name.trim().slice(0, 50),
    workDir,
    entryFile,
  });
}
