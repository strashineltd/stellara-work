/**
 * 附件来源校验（attachments:add 处理器核心）。
 *
 * 工作区内的附件直接复制；工作区外（且非原生附件选择器来源）的路径
 * 必须先经原生确认，用户取消则整体中止，不做任何复制（C2）。
 * 不使用渲染层提供的任何来源标记。
 */
import type { AttachmentMeta } from './attachments';

export interface AttachmentProvenanceDeps {
  /** 返回不在授权工作区/授权来源内的绝对源路径 */
  findUngranted: (filePaths: string[], allowedWorkDirs: string[]) => Promise<string[]>;
  /** 原生确认框；用户取消返回 false */
  confirmOutside: (outsidePaths: string[]) => Promise<boolean>;
  add: (sessionId: string, workDir: string, filePaths: string[]) => Promise<AttachmentMeta[]>;
}

export async function addAttachmentsWithProvenance(
  sessionId: string,
  workDir: string,
  filePaths: string[],
  deps: AttachmentProvenanceDeps,
): Promise<AttachmentMeta[]> {
  const outside = await deps.findUngranted(filePaths, [workDir]);
  if (outside.length > 0) {
    const confirmed = await deps.confirmOutside(outside);
    if (!confirmed) throw new Error('已取消添加工作区外的附件');
  }
  return deps.add(sessionId, workDir, filePaths);
}
