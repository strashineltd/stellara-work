/**
 * 调度任务 workDir 信任校验（S1）。
 *
 * 渲染层不得用任意路径种子化工作区白名单。调度创建/更新时，
 * workDir 必须已由原生选择器授予，或来自已有项目 / 模型配置。
 * 会话行不作为信任来源（否则「先种调度 → 跑出 Session → 永久放行」可逃逸）。
 */
import path from 'node:path';
import { isWorkDirGranted, normalizeWorkDir } from '../security/workdir-grants';

export interface ScheduledWorkDirSources {
  projectWorkDirs: readonly (string | null | undefined)[];
  modelWorkDirs: readonly (string | null | undefined)[];
}

export async function isScheduledWorkDirTrusted(
  workDir: string,
  sources: ScheduledWorkDirSources,
): Promise<boolean> {
  if (typeof workDir !== 'string' || !workDir.trim()) return false;
  const target = await normalizeWorkDir(workDir);
  if (await isWorkDirGranted(workDir)) return true;
  for (const dir of [...sources.projectWorkDirs, ...sources.modelWorkDirs]) {
    if (typeof dir !== 'string' || !dir.trim()) continue;
    if ((await normalizeWorkDir(dir)) === target) return true;
  }
  return false;
}

export async function assertScheduledWorkDir(
  workDir: string | null | undefined,
  sources: ScheduledWorkDirSources,
): Promise<void> {
  if (workDir === null || workDir === undefined || workDir === '') return;
  if (typeof workDir !== 'string') {
    throw new Error('工作目录无效');
  }
  const resolved = path.resolve(workDir.trim());
  if (!(await isScheduledWorkDirTrusted(resolved, sources))) {
    throw new Error('工作目录未经选择器或项目授权，请通过选择器重新选择');
  }
}
