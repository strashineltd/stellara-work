import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateItemsTokens,
  estimateRequestTokens,
  charFallbackTokens,
} from './token-estimator';
import type { ResponseItem } from '../../shared/responses';

function userMessage(text: string): ResponseItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] };
}

describe('token-estimator', () => {
  it('空文本返回 0', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('中文估算显著高于字符数/4（修正现有低估）', () => {
    const text = '你好世界，这是一段用于测试的中文内容。'.repeat(10);
    expect(estimateTextTokens(text)).toBeGreaterThan(charFallbackTokens(text));
  });

  it('items 合计不小于逐条文本之和', () => {
    const items = [userMessage('hello'), userMessage('world')];
    expect(estimateItemsTokens(items)).toBeGreaterThanOrEqual(
      estimateTextTokens('hello') + estimateTextTokens('world'),
    );
  });

  it('estimateRequestTokens 覆盖 instructions 与 tools', () => {
    const base = estimateRequestTokens({ items: [] });
    const withAll = estimateRequestTokens({
      items: [userMessage('hello')],
      instructions: '你是助手',
      tools: [{ type: 'function', name: 'read_file', description: '读取文件', parameters: { type: 'object' } }],
    });
    expect(withAll).toBeGreaterThan(base + 5);
  });

  it('charFallbackTokens 向上取整', () => {
    expect(charFallbackTokens('abcde')).toBe(2);
    expect(charFallbackTokens('')).toBe(0);
  });

  it('P12：相同 instructions/tools 走缓存结果稳定', () => {
    const tools = [{ type: 'function', name: 'read_file', description: '读取文件', parameters: { type: 'object' } }];
    const instructions = '你是助手，保持简洁。';
    const a = estimateRequestTokens({ items: [], instructions, tools });
    const b = estimateRequestTokens({ items: [], instructions, tools });
    expect(a).toBe(b);
  });
});
