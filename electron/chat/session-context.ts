import type { ModelConfig } from '../../shared/ipc';
import type { AppConfig } from '../config/config-v2';
import type { Project, Session } from '../store/db';

export interface SessionContextDependencies {
  getSession: (id: string) => Session | null;
  getProject: (id: string) => Project | null;
  loadConfig: () => Promise<AppConfig>;
  getKey: (modelId: string) => string | null;
  isDirectory: (path: string) => Promise<boolean>;
}

/**
 * Resolves a chat's immutable execution context. The session is the source
 * of truth for the model; a linked project is the source of truth for files.
 * Global active-model changes must not reroute existing chats.
 */
export async function resolveSessionModel(
  sessionId: string,
  dependencies: SessionContextDependencies,
): Promise<ModelConfig> {
  if (!sessionId) throw new Error('缺少会话 ID，无法启动任务');
  const session = dependencies.getSession(sessionId);
  if (!session) throw new Error('会话不存在或已删除');

  const config = await dependencies.loadConfig();
  const entry = config.models.find((candidate) => candidate.id === session.modelId);
  if (!entry) throw new Error('该会话绑定的模型已被删除，请在设置中重新配置模型');

  const project = session.projectId ? dependencies.getProject(session.projectId) : null;
  const workDir = project?.workDir ?? session.workDir ?? entry.workDir;
  if (!workDir) throw new Error('该会话未关联项目文件，请先创建或选择项目');
  if (!(await dependencies.isDirectory(workDir))) {
    throw new Error(`工作目录不存在或无法访问：${workDir}`);
  }

  const apiKey = dependencies.getKey(entry.id);
  if (!apiKey) throw new Error('该会话绑定的模型没有 API key，请在设置中配置');
  return {
    id: entry.id as ModelConfig['id'],
    label: entry.label,
    baseUrl: entry.baseUrl,
    model: entry.model,
    apiKey,
    workDir,
    isCustom: entry.id === 'custom',
  };
}
