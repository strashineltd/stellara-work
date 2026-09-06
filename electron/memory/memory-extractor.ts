/**
 * Memory OS — 记忆提取器
 *
 * 从对话历史中自动提取值得长期记忆的信息。
 * 使用 LLM 分析对话，提取事实、偏好、决策等。
 */

import type { ChatMessage, Memory, MessageRow } from '../../shared/ipc';
import { saveMemory, findDuplicateMemory } from './memory-store';

/** 提取结果 */
interface ExtractedMemory {
  kind: Memory['kind'];
  content: string;
  importance: number;
  tags: string[];
}

const BROWSER_TOOL_RE = /^(web_search|browser_)/;
const BROWSER_MATERIAL_MAX = 30_000;

/** 从消息历史构建浏览材料：仅成功的 web_search/browser_* 工具结果，[工具名] 前缀，30k 截断 */
export function buildBrowserMaterial(messages: MessageRow[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool' || !m.toolName) continue;
    if (!BROWSER_TOOL_RE.test(m.toolName)) continue;
    let ok = true;
    if (m.meta) {
      try {
        const meta = JSON.parse(m.meta) as { ok?: boolean };
        if (meta.ok === false) ok = false;
      } catch {
        // meta 解析失败按成功处理（老数据无 ok 字段）
      }
    }
    if (!ok) continue;
    lines.push(`[${m.toolName}] ${m.content}`);
  }
  if (!lines.length) return '';
  let joined = lines.join('\n');
  if (joined.length > BROWSER_MATERIAL_MAX) {
    joined = joined.slice(0, BROWSER_MATERIAL_MAX) + '…[已截断]';
  }
  return joined;
}

const EXTRACTION_PROMPT = `分析以下对话，提取值得长期记忆的信息。只提取用户明确表达的、有长期价值的信息。

返回 JSON 数组（不要包含其他文本），每项包含：
- kind: "fact" | "preference" | "decision" | "codebase" | "requirement" | "meeting" | "web"
- content: 简洁的记忆内容（一句话）
- importance: 0-1（重要性评分）
- tags: 标签数组

不要提取：
- 临时性信息（如"帮我看看这个文件"）
- 通用知识（如"JavaScript 是编程语言"）
- 模型自己的回答内容
- 非浏览材料的凭空网页总结；web 条目必须来自浏览材料

要提取：
- 用户的技术偏好（如"我喜欢极简 UI"）
- 项目决策（如"我们决定用 SQLite 而不是 PostgreSQL"）
- 代码库知识（如"这个项目使用 Electron + React"）
- 需求变更（如"v0.9 不做 MCP 支持"）
- 用户的个人偏好（如"我偏好中文回复"）
- web：网页浏览材料中值得长期记忆的调研结论/事实（tags 含来源站点与话题）

如果对话中没有值得记忆的信息，返回空数组 []。`;

/**
 * 从对话历史中提取记忆
 *
 * @param messages 会话消息历史
 * @param scope 记忆作用域
 * @param scopeId 作用域 ID（如项目 ID）
 * @param source 来源标记
 * @param llmCall LLM 调用函数（传入避免循环依赖）
 */
export async function extractMemories(
  messages: ChatMessage[],
  scope: Memory['scope'],
  scopeId: string | undefined,
  source: string,
  llmCall: (systemPrompt: string, userMessage: string) => Promise<string>,
  browserMaterial?: string,
): Promise<Memory[]> {
  // 只分析用户和 assistant 的消息
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
    .join('\n');

  const withMaterial = browserMaterial
    ? `${transcript}\n\n--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---\n${browserMaterial}`
    : transcript;

  if (withMaterial.length < 50) return []; // 太短的对话不提取

  try {
    const response = await llmCall(EXTRACTION_PROMPT, withMaterial);

    // 解析 JSON
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const extracted: ExtractedMemory[] = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(extracted)) return [];

    const saved: Memory[] = [];

    for (const item of extracted) {
      // 验证结构
      if (!item.kind || !item.content) continue;
      if (!['fact', 'preference', 'decision', 'codebase', 'requirement', 'meeting', 'web'].includes(item.kind)) continue;

      // 去重检查
      const duplicate = findDuplicateMemory(item.content);
      if (duplicate) continue;

      const memory = saveMemory({
        scope,
        scopeId,
        kind: item.kind,
        content: item.content,
        source,
        importance: Math.min(1, Math.max(0, item.importance ?? 0.5)),
        confidence: 0.8,
        tags: item.tags ?? [],
      });

      saved.push(memory);
    }

    return saved;
  } catch (err) {
    console.error('[MemoryExtractor] 提取失败:', err);
    return [];
  }
}

/**
 * 手动保存一条记忆（用户主动触发）
 */
export function saveManualMemory(opts: {
  content: string;
  kind: Memory['kind'];
  scope?: Memory['scope'];
  scopeId?: string;
  tags?: string[];
}): Memory {
  return saveMemory({
    scope: opts.scope ?? 'personal',
    scopeId: opts.scopeId,
    kind: opts.kind,
    content: opts.content,
    source: 'manual',
    importance: 0.8,
    confidence: 1.0,
    tags: opts.tags,
  });
}
