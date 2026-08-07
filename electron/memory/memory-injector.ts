/**
 * Memory OS — 记忆注入器
 *
 * Agent 启动前，检索相关记忆并注入 system prompt。
 */

import type { Memory } from '../../shared/ipc';
import { searchMemoriesSafe, listMemories, bumpAccess } from './memory-store';

/** 记忆注入配置 */
export interface MemoryInjectionConfig {
  enabled: boolean;
  maxMemories: number;
  projectId?: string;
}

const DEFAULT_CONFIG: MemoryInjectionConfig = {
  enabled: true,
  maxMemories: 10,
};

/**
 * 检索相关记忆并格式化为 prompt 注入文本
 *
 * @param userMessage 用户消息（用于语义搜索）
 * @param config 注入配置
 * @returns 结构化记忆列表 + 格式化注入文本（无记忆时为 null），可直接拼接到 system prompt
 */
export async function retrieveMemoriesForInjection(
  userMessage: string,
  config: Partial<MemoryInjectionConfig> = {},
): Promise<{ memories: Memory[]; promptBlock: string | null }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!cfg.enabled) return { memories: [], promptBlock: null };

  try {
    const allMemories: Memory[] = [];

    // 1. 搜索与当前消息相关的个人记忆
    if (userMessage.length > 10) {
      const personalResults = searchMemoriesSafe({
        query: userMessage.slice(0, 200), // 截断避免太长
        scope: 'personal',
        limit: 3,
      });
      if (personalResults) allMemories.push(...personalResults);
    }

    // 2. 获取当前项目的记忆
    if (cfg.projectId) {
      const projectMemories = listMemories({
        scope: 'project',
        scopeId: cfg.projectId,
        limit: 5,
      });
      allMemories.push(...projectMemories);
    }

    // 3. 获取 workspace 记忆（企业规则等）
    const workspaceMemories = listMemories({
      scope: 'workspace',
      limit: 3,
    });
    allMemories.push(...workspaceMemories);

    // 4. 获取高重要性的个人记忆（用户偏好等）
    const highImportance = listMemories({
      scope: 'personal',
      kind: 'preference',
      limit: 3,
    });
    allMemories.push(...highImportance);

    // 去重（按 ID）
    const unique = new Map<string, Memory>();
    for (const m of allMemories) {
      if (!unique.has(m.id)) unique.set(m.id, m);
    }

    // 按重要性排序，取 Top N
    const sorted = [...unique.values()]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, cfg.maxMemories);

    if (sorted.length === 0) return { memories: [], promptBlock: null };

    // 更新访问计数
    for (const m of sorted) {
      bumpAccess(m.id);
    }

    // 格式化
    const lines = sorted.map((m) => {
      const confidence = Math.round(m.confidence * 100);
      const source = m.source?.startsWith('session:') ? m.source.replace('session:', '会话 ') : m.source;
      return `- ${m.content}（置信度 ${confidence}%${source ? `，来源：${source}` : ''}）`;
    });

    return { memories: sorted, promptBlock: `[相关记忆]\n${lines.join('\n')}` };
  } catch (err) {
    console.error('[MemoryInjector] 检索失败:', err);
    return { memories: [], promptBlock: null };
  }
}

/**
 * 检索相关记忆并格式化为 prompt 注入文本（兼容旧 API）
 *
 * @deprecated 请使用 retrieveMemoriesForInjection（同时返回结构化记忆）
 */
export async function retrieveAndFormatMemories(
  userMessage: string,
  config: Partial<MemoryInjectionConfig> = {},
): Promise<string | null> {
  const { promptBlock } = await retrieveMemoriesForInjection(userMessage, config);
  return promptBlock;
}
