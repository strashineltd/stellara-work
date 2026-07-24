import { describe, it, expect } from 'vitest';
import { buildChatCompletionsUrl, buildModelsUrl } from './endpoint';

describe('buildChatCompletionsUrl', () => {
  it('handles GLM 智谱 base_url with /v4 prefix', () => {
    expect(buildChatCompletionsUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('strips trailing slash on GLM base_url', () => {
    expect(buildChatCompletionsUrl('https://open.bigmodel.cn/api/paas/v4/')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('appends /v1 for DeepSeek-style base_url', () => {
    expect(buildChatCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
  });

  it('appends /v1 for Kimi-style base_url', () => {
    expect(buildChatCompletionsUrl('https://api.moonshot.cn')).toBe(
      'https://api.moonshot.cn/v1/chat/completions',
    );
  });

  it('does not double-append /v1 for MiniMax-style base_url', () => {
    expect(buildChatCompletionsUrl('https://api.minimaxi.com/v1')).toBe(
      'https://api.minimaxi.com/v1/chat/completions',
    );
  });

  it('does not double-append /v1 for OpenAI-style base_url', () => {
    expect(buildChatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('handles custom base_url without /v1', () => {
    expect(buildChatCompletionsUrl('https://my-proxy.example.com')).toBe(
      'https://my-proxy.example.com/v1/chat/completions',
    );
  });

  it('throws on empty base_url', () => {
    expect(() => buildChatCompletionsUrl('')).toThrow('base_url 不能为空');
  });
});

describe('buildModelsUrl', () => {
  it('handles GLM /paas/ prefix', () => {
    expect(buildModelsUrl('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/models',
    );
  });

  it('appends /v1 for DeepSeek-style', () => {
    expect(buildModelsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/models',
    );
  });
});
