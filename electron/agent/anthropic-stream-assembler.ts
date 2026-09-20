/**
 * Anthropic Messages SSE 事件 → 完整响应 + 实时增量 的装配器。
 *
 * - text 增量实时产出（供 loop 逐字 yield content）
 * - tool_use 的 input_json_delta 分片累计，content_block_stop 时解析（失败兜底 {}）
 * - message_start / message_delta 汇集 usage 与 stop_reason
 * - thinking 增量作为 reasoning 输出；thinking 块不进入最终 content
 *   （避免把无签名的 thinking 块回传到下一次请求；当前未启用 extended thinking）
 */
import type { AnthropicContent, AnthropicResponse, AnthropicStreamEvent } from '../llm/anthropic';

export interface AssembledAnthropicResponse {
  content: AnthropicContent[];
  stop_reason: AnthropicResponse['stop_reason'];
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicStreamDelta {
  text?: string;
  reasoning?: string;
}

const PERSISTED_BLOCK_TYPES = new Set(['text', 'tool_use']);

export class AnthropicStreamAssembler {
  private readonly blocks = new Map<number, AnthropicContent>();
  private readonly order: number[] = [];
  private readonly inputJson = new Map<number, string>();
  /** 已 start 未 stop 的块（提前中断检测） */
  private readonly openBlocks = new Set<number>();
  private messageStopped = false;
  private stopReasonSeen = false;
  private stopReason: AnthropicResponse['stop_reason'] = 'end_turn';
  private readonly usage = { input_tokens: 0, output_tokens: 0 };

  /** 处理一个事件；返回需要立即透传的增量（如有） */
  handle(event: AnthropicStreamEvent): AnthropicStreamDelta | null {
    switch (event.type) {
      case 'message_start': {
        const usage = event.message?.usage;
        if (usage) {
          if (typeof usage.input_tokens === 'number') this.usage.input_tokens = usage.input_tokens;
          if (typeof usage.output_tokens === 'number') this.usage.output_tokens = usage.output_tokens;
        }
        return null;
      }
      case 'content_block_start': {
        const block = event.content_block;
        if (block && typeof event.index === 'number') {
          // 重复 index 视为协议异常：忽略第二个 start，保证实时输出与最终历史一致
          if (this.blocks.has(event.index)) return null;
          this.order.push(event.index);
          this.blocks.set(event.index, { ...block });
          this.openBlocks.add(event.index);
          if (block.type === 'tool_use') this.inputJson.set(event.index, '');
        }
        return null;
      }
      case 'content_block_delta': {
        const { index, delta } = event;
        if (typeof index !== 'number' || !delta) return null;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          const block = this.blocks.get(index);
          if (block && block.type === 'text') block.text = (block.text ?? '') + delta.text;
          return { text: delta.text };
        }
        if (delta.type === 'thinking_delta') {
          // 官方字段为 thinking；text 兜底兼容非标准网关
          const thinking = typeof delta.thinking === 'string' ? delta.thinking : delta.text;
          if (typeof thinking === 'string' && thinking) return { reasoning: thinking };
          return null;
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          this.inputJson.set(index, (this.inputJson.get(index) ?? '') + delta.partial_json);
          return null;
        }
        return null;
      }
      case 'content_block_stop': {
        const index = event.index;
        if (typeof index === 'number') {
          this.openBlocks.delete(index);
          const block = this.blocks.get(index);
          if (block && block.type === 'tool_use' && this.inputJson.has(index)) {
            const partial = this.inputJson.get(index) ?? '';
            // 未收到任何分片时保留 start 块自带的 input（部分兼容网关如此）
            if (partial) {
              try {
                block.input = JSON.parse(partial);
              } catch {
                block.input = {};
              }
            }
          }
        }
        return null;
      }
      case 'message_delta': {
        const stop = event.delta?.stop_reason;
        if (typeof stop === 'string') {
          this.stopReason = stop as AnthropicResponse['stop_reason'];
          this.stopReasonSeen = true;
        }
        if (event.usage) {
          if (typeof event.usage.input_tokens === 'number') this.usage.input_tokens = event.usage.input_tokens;
          if (typeof event.usage.output_tokens === 'number') this.usage.output_tokens = event.usage.output_tokens;
        }
        return null;
      }
      case 'message_stop': {
        this.messageStopped = true;
        return null;
      }
      case 'error': {
        throw new Error(event.error?.message || 'Anthropic 流返回错误');
      }
      default:
        return null;
    }
  }

  /**
   * 装配完成后的完整响应（仅保留 text/tool_use 块，按 index 排序）。
   * 流被提前截断时抛错，避免把不完整响应当作成功（尤其禁止执行半截工具参数）。
   */
  finish(): AssembledAnthropicResponse {
    // 未收尾的 tool_use 块：分片完整则补收尾，不完整则视为中断
    for (const index of this.openBlocks) {
      const block = this.blocks.get(index);
      if (block?.type === 'tool_use') {
        const partial = this.inputJson.get(index) ?? '';
        if (partial) {
          try {
            block.input = JSON.parse(partial);
          } catch {
            throw new Error('Anthropic 流提前结束：工具调用参数不完整');
          }
        }
      }
    }

    if (!this.messageStopped && !this.stopReasonSeen) {
      throw new Error('Anthropic 流提前结束（未收到 message_stop），已丢弃不完整响应');
    }

    const content = this.order
      .slice()
      .sort((left, right) => left - right)
      .map((index) => this.blocks.get(index))
      .filter((block): block is AnthropicContent => Boolean(block) && PERSISTED_BLOCK_TYPES.has(block!.type));
    return { content, stop_reason: this.stopReason, usage: { ...this.usage } };
  }
}
