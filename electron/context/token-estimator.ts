import { encoding_for_model, type Tiktoken } from 'tiktoken';
import type { ResponseItem } from '../../shared/responses';

let encoder: Tiktoken | null | undefined;

function getEncoder(): Tiktoken | null {
  if (encoder !== undefined) return encoder;
  try {
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

export function estimateItemsTokens(items: ResponseItem[]): number {
  let total = 0;
  for (const item of items) {
    total += estimateTextTokens(JSON.stringify(item)) + 4;
  }
  return total;
}

export function estimateRequestTokens(input: {
  items: ResponseItem[];
  instructions?: string;
  tools?: unknown[];
}): number {
  let total = estimateItemsTokens(input.items) + 2;
  if (input.instructions) total += estimateTextTokens(input.instructions) + 4;
  if (input.tools && input.tools.length > 0) total += estimateTextTokens(JSON.stringify(input.tools)) + 4;
  return total;
}

/** 测试 hook：重置编码器缓存 */
export function _resetEncoderForTest(): void {
  encoder = undefined;
}
