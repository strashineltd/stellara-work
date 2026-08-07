import { encoding_for_model, type Tiktoken } from 'tiktoken';
import type { ChatMessage } from '../../shared/ipc';

/**
 * 上下文压缩（Context Compaction）
 *
 * 当 messages 累积超阈值时，把最早一批消息压缩成一条 summary message，
 * 保留 system + 最近 N 轮对话。LLM 上下文窗口不会无限膨胀。
 *
 * 触发时机：agent loop 每次 LLM 调用前。
 * 失败兜底：summarize 调用失败 → 跳过压缩，下一轮再判定。
 */

/** 鸭子类型的 LLM 客户端：compress 只用到 summarize 方法 */
export interface SummarizableClient {
  summarize(messages: ChatMessage[], systemPrompt: string): Promise<string>;
}

export interface CompressionConfig {
  /** 超过此 token 数触发压缩，默认 24000 */
  thresholdTokens: number;
  /** 保留最近多少轮（user-assistant 对算 1 轮），默认 12 */
  keepRecentTurns: number;
}

export const DEFAULT_COMPRESSION: CompressionConfig = {
  thresholdTokens: 24000,
  keepRecentTurns: 12,
};

/**
 * 按模型 contextWindow 生成压缩配置：
 * 阈值 = contextWindow × 90%；未配置窗口时回退默认 24K 阈值。
 */
export function compressionForContextWindow(contextWindow?: number): Partial<CompressionConfig> {
  if (!contextWindow || contextWindow <= 0) return {};
  return { thresholdTokens: Math.floor(contextWindow * 0.9) };
}

export interface CompressionResult {
  messages: ChatMessage[];
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
  compressedCount?: number;
}

// tiktoken 单例（避免每次都重新加载）
let _encoder: Tiktoken | null = null;
function getEncoder(): Tiktoken | null {
  if (_encoder) return _encoder;
  try {
    // cl100k_base 对中英文都准；不绑具体厂商（gpt-4 / DeepSeek / GLM 都兼容）
    _encoder = encoding_for_model('gpt-4');
    return _encoder;
  } catch (err) {
    console.warn('[compress] tiktoken 加载失败，回退到字符粗估:', err);
    return null;
  }
}

/**
 * 估算一组 messages 的总 token 数。
 * 用 tiktoken（准）；加载失败时回退到 字符/4 粗估。
 */
export function estimateTokens(messages: ChatMessage[]): number {
  const enc = getEncoder();
  let total = 0;
  for (const m of messages) {
    const parts: string[] = [m.content ?? ''];
    if (m.name) parts.push(m.name);
    if (m.tool_calls) parts.push(JSON.stringify(m.tool_calls));
    const text = parts.join('\n');
    if (enc) {
      try {
        total += enc.encode(text).length;
        total += 4; // 每条消息 metadata 开销（OpenAI 标准）
      } catch {
        total += Math.ceil(text.length / 4);
      }
    } else {
      total += Math.ceil(text.length / 4);
    }
  }
  total += 2; // 对话起始 token
  return total;
}

/**
 * 把 messages 数组格式化成纯文本（喂给 LLM 摘要用）
 */
function messagesToTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      let header = `[${m.role}]`;
      if (m.name) header += ` (${m.name})`;
      let body = m.content ?? '';
      if (m.tool_calls && m.tool_calls.length > 0) {
        body += '\n  tool_calls: ' + JSON.stringify(m.tool_calls);
      }
      return `${header}\n${body}`;
    })
    .join('\n\n');
}

/**
 * 找出保留窗口的边界索引：从尾向前数 keepRecentTurns*2 条消息，
 * 同时把 tool 消息绑到所属 assistant 那轮（一起保留）。
 *
 * 返回 [startIdx, endIdx) 半开区间 —— [start, end) 之间的消息要压缩掉。
 */
function findCompressRange(
  messages: ChatMessage[],
  keepRecentTurns: number,
): { startIdx: number; endIdx: number; recent: ChatMessage[] } {
  const n = messages.length;
  if (n === 0) return { startIdx: 0, endIdx: 0, recent: [] };

  // 从尾部向前数 user/assistant 对。每对算 1 轮，tool 消息归到所属 assistant 那轮。

  // 找到要保留的最近消息的起始 idx
  let recentStart = n; // 默认 = 不保留任何东西
  let userAssistantPairs = 0;
  for (let i = n - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user') {
      userAssistantPairs++;
      if (userAssistantPairs >= keepRecentTurns) {
        recentStart = i;
        break;
      }
    }
  }
  if (userAssistantPairs < keepRecentTurns) {
    // 不够 N 轮 → 不压缩
    return { startIdx: n, endIdx: n, recent: [] };
  }

  // system 消息（如果存在）始终在最前保留
  let startIdx = 0;
  if (messages[0]?.role === 'system') {
    startIdx = 1;
  }

  // 压缩范围：[startIdx, recentStart)
  const recent = messages.slice(recentStart);
  return { startIdx, endIdx: recentStart, recent };
}

const SUMMARIZE_SYSTEM_PROMPT = `你是一个对话摘要助手。请把用户和助手的对话历史压缩成一段简洁的摘要（中文 / 英文随原文），保留：
1. 用户的关键需求、约束、意图
2. 已完成的工作（修改了哪些文件 / 命令 / 结果）
3. 重要的失败 / 错误与排除过程
4. 助手当前进展与下一步计划

格式：
- 直接写摘要正文，不要标题 / Markdown 列表
- 长度控制在 800 字以内
- 用第三人称叙述（"用户要求..."、"助手已完成..."）
- 不要编造对话里没有的信息`;

export async function compressIfNeeded(
  messages: ChatMessage[],
  client: SummarizableClient,
  config?: Partial<CompressionConfig>,
): Promise<CompressionResult> {
  const cfg: CompressionConfig = { ...DEFAULT_COMPRESSION, ...config };
  const tokensBefore = estimateTokens(messages);

  if (tokensBefore <= cfg.thresholdTokens) {
    return { messages, compressed: false, tokensBefore, tokensAfter: tokensBefore };
  }

  const { startIdx, endIdx, recent } = findCompressRange(messages, cfg.keepRecentTurns);
  if (endIdx <= startIdx) {
    // 全部都是要保留的（轮次不够），跳过
    return { messages, compressed: false, tokensBefore, tokensAfter: tokensBefore };
  }

  const toCompress = messages.slice(startIdx, endIdx);
  const compressedCount = toCompress.length;
  const transcript = messagesToTranscript(toCompress);

  let summary: string;
  try {
    summary = await client.summarize(
      [{ role: 'user', content: `请把以下对话历史压缩成摘要：\n\n${transcript}` }],
      SUMMARIZE_SYSTEM_PROMPT,
    );
    if (!summary) throw new Error('summarize 返回空字符串');
  } catch (err) {
    // 失败兜底：不压缩，避免破坏 agent 流程
    console.warn('[compress] summarize 失败，跳过本次压缩:', err instanceof Error ? err.message : err);
    return { messages, compressed: false, tokensBefore, tokensAfter: tokensBefore };
  }

  // 构造新 messages 数组
  const systemPrefix = messages[0]?.role === 'system' ? [messages[0]!] : [];
  const summaryMsg: ChatMessage = {
    role: 'system',
    content: `[conversation summary — ${compressedCount} messages compressed]\n${summary}`,
  };
  const newMessages: ChatMessage[] = [...systemPrefix, summaryMsg, ...recent];
  const tokensAfter = estimateTokens(newMessages);

  return {
    messages: newMessages,
    compressed: true,
    tokensBefore,
    tokensAfter,
    summary,
    compressedCount,
  };
}