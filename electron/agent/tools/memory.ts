/**
 * Memory OS — Agent 记忆工具
 *
 * 让 Agent 可以主动搜索和保存记忆。
 */

import type { OpenAITool, ToolResult } from '../../../shared/ipc';
import { searchMemories, saveMemory } from '../../memory/memory-store';

export async function memorySearch(args: { query: string; scope?: string; kind?: string; limit?: number }, _cwd: string): Promise<ToolResult> {
  try {
    const results = searchMemories({
      query: args.query,
      scope: args.scope as 'personal' | 'project' | 'workspace' | undefined,
      kind: args.kind as 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting' | undefined,
      limit: args.limit ?? 5,
    });

    if (results.length === 0) {
      return { ok: true, output: '(未找到相关记忆)' };
    }

    const lines = results.map((m) => {
      const confidence = Math.round(m.confidence * 100);
      return `[${m.kind}] ${m.content} (置信度 ${confidence}%, 重要性 ${m.importance})`;
    });

    return { ok: true, output: lines.join('\n') };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function memorySave(args: { content: string; kind: string; scope?: string; tags?: string[] }, _cwd: string): Promise<ToolResult> {
  try {
    const validKinds = ['fact', 'preference', 'decision', 'codebase', 'requirement', 'meeting'];
    if (!validKinds.includes(args.kind)) {
      return { ok: false, output: '', error: `无效的 kind: ${args.kind}，可选值: ${validKinds.join(', ')}` };
    }

    const memory = saveMemory({
      scope: (args.scope as 'personal' | 'project' | 'workspace') ?? 'personal',
      kind: args.kind as 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting',
      content: args.content,
      source: 'agent',
      importance: 0.7,
      confidence: 0.9,
      tags: args.tags,
    });

    return { ok: true, output: `已保存记忆: ${memory.content} (${memory.kind})` };
  } catch (err) {
    return { ok: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export const memoryTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description: '搜索记忆库。查找之前会话中保存的事实、偏好、决策、代码库知识等。用于回忆用户的需求、偏好或项目相关信息。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或描述' },
          scope: { type: 'string', description: '搜索范围：personal（个人偏好）、project（项目知识）、workspace（企业规则）' },
          kind: { type: 'string', description: '记忆类型：fact/preference/decision/codebase/requirement/meeting' },
          limit: { type: 'number', description: '返回结果数量（默认 5）' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description: '保存一条新记忆到记忆库。当发现值得长期记住的信息时使用，如用户偏好、项目决策、技术选型等。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容（简洁的一句话）' },
          kind: { type: 'string', description: '记忆类型：fact（事实）、preference（偏好）、decision（决策）、codebase（代码库知识）、requirement（需求）、meeting（会议记录）' },
          scope: { type: 'string', description: '作用域：personal（个人）、project（项目）、workspace（企业），默认 personal' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签数组' },
        },
        required: ['content', 'kind'],
        additionalProperties: false,
      },
    },
  },
];
