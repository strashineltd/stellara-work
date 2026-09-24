/**
 * Token 预算估算。
 * P12：tiktoken WASM 惰性加载；instructions/tools 文本按内容缓存，
 * 避免每轮工具循环重复 encode 同一 system prompt / schema。
 */
import type { ResponseItem } from '../../shared/responses';

let encoder: import('tiktoken').Tiktoken | null | undefined;

function getEncoder(): import('tiktoken').Tiktoken | null {
  if (encoder !== undefined) return encoder;
  try {
    // 惰性 require：模块加载时不拉 WASM
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encoding_for_model } = require('tiktoken') as typeof import('tiktoken');
    encoder = encoding_for_model('gpt-4');
  } catch (err) {
    console.warn('[token-estimator] tiktoken 加载失败，回退字符估算:', err);
    encoder = null;
  }
  return encoder;
}

export function charFallbackTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const enc = getEncoder();
  if (!enc) return charFallbackTokens(text);
  try {
    return enc.encode(text).length;
  } catch {
    return charFallbackTokens(text);
  }
}

// 每条 item 的 token 成本缓存：items 入库后不再改写，缓存安全且避免重复 tiktoken 编码
const itemTokensCache = new WeakMap<object, number>();

/** 稳定文本（instructions / tools JSON）的 token 缓存 */
const textTokensCache = new Map<string, number>();

function estimateCachedText(text: string): number {
  let n = textTokensCache.get(text);
  if (n === undefined) {
    n = estimateTextTokens(text);
    if (textTokensCache.size > 64) textTokensCache.clear();
    textTokensCache.set(text, n);
  }
  return n;
}

export function estimateItemsTokens(items: ResponseItem[]): number {
  let total = 0;
  for (const item of items) {
    let cost = itemTokensCache.get(item);
    if (cost === undefined) {
      cost = estimateTextTokens(JSON.stringify(item)) + 4;
      itemTokensCache.set(item, cost);
    }
    total += cost;
  }
  return total;
}

export function estimateRequestTokens(input: {
  items: ResponseItem[];
  instructions?: string;
  tools?: unknown[];
}): number {
  let total = estimateItemsTokens(input.items) + 2;
  if (input.instructions) total += estimateCachedText(input.instructions) + 4;
  if (input.tools && input.tools.length > 0) total += estimateCachedText(JSON.stringify(input.tools)) + 4;
  return total;
}

/** 测试 hook：重置编码器与文本缓存 */
export function _resetEncoderForTest(): void {
  encoder = undefined;
  textTokensCache.clear();
}
