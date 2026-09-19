/**
 * ResponseItem[] → Anthropic messages 投影。
 *
 * 用途：Anthropic loop 在跨轮开跑与压缩后从 Context Hub 重建消息窗口，
 * 让被压缩丢弃的前缀真正离开请求体。
 * - function_call → assistant 的 tool_use 块（与相邻 assistant 消息合并）
 * - function_call_output → user 的 tool_result 块（连续的合并进同一条 user 消息）
 * - reasoning 跳过（Anthropic 未持久化 thinking；请求未启用 extended thinking）
 */
import type { ResponseItem } from '../../../shared/responses';
import type { AnthropicContent, AnthropicMessage } from '../../llm/anthropic';

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

export function projectAnthropicMessages(items: ResponseItem[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  const pushBlock = (role: 'user' | 'assistant', block: AnthropicContent): void => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      const content = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text' as const, text: last.content }];
      content.push(block);
      last.content = content;
      return;
    }
    messages.push({ role, content: [block] });
  };

  for (const item of items) {
    if (item.type === 'message') {
      if (item.role !== 'user' && item.role !== 'assistant') continue;
      const text = item.content.map((part) => part.text).join('');
      if (!text) continue;
      pushBlock(item.role, { type: 'text', text });
      continue;
    }
    if (item.type === 'function_call') {
      pushBlock('assistant', {
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: parseToolInput(item.arguments),
      });
      continue;
    }
    if (item.type === 'function_call_output') {
      pushBlock('user', {
        type: 'tool_result',
        tool_use_id: item.call_id,
        content: item.output,
      });
      continue;
    }
    // reasoning 及其它：跳过
  }

  return messages;
}
