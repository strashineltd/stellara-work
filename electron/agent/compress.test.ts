import { describe, it, expect } from 'vitest';
import { estimateTokens, compressIfNeeded, DEFAULT_COMPRESSION, type SummarizableClient } from './compress';
import type { ChatMessage } from '../../shared/ipc';

/**
 * 假 LLM 客户端：直接返回固定摘要，不真发请求
 */
class FakeClient implements SummarizableClient {
  public summarizeCalls = 0;
  public shouldFail = false;
  constructor(private fixedSummary = '这是假摘要') {}

  async summarize(): Promise<string> {
    this.summarizeCalls++;
    if (this.shouldFail) throw new Error('fake LLM 失败');
    return this.fixedSummary;
  }
}

describe('estimateTokens', () => {
  it('空 messages 返回 0 + 对话起始 token', () => {
    expect(estimateTokens([])).toBeGreaterThanOrEqual(2);
    expect(estimateTokens([])).toBeLessThan(10);
  });

  it('单条短 message', () => {
    const n = estimateTokens([{ role: 'user', content: 'hi' }]);
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThan(20);
  });

  it('长内容返回合理 token 数', () => {
    const long = 'a'.repeat(400);
    const n = estimateTokens([{ role: 'user', content: long }]);
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(200);
  });

  it('中英文都返回 > 0', () => {
    const cn = estimateTokens([{ role: 'user', content: '你好世界这是一个测试中文内容' }]);
    const en = estimateTokens([{ role: 'user', content: 'hello world this is a test' }]);
    expect(cn).toBeGreaterThan(0);
    expect(en).toBeGreaterThan(0);
  });
});

describe('compressIfNeeded', () => {
  function buildMessages(n: number, content = 'x'): ChatMessage[] {
    const msgs: ChatMessage[] = [{ role: 'system', content: '你是助手' }];
    for (let i = 0; i < n; i++) {
      msgs.push({ role: 'user', content: `${content}-${i}` });
      msgs.push({ role: 'assistant', content: `${content}-reply-${i}` });
    }
    return msgs;
  }

  it('tokens 未超阈值 → 不压缩，返回原 messages', async () => {
    const msgs = buildMessages(5);
    const fake = new FakeClient();
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 100000,
      keepRecentTurns: 12,
    });
    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(fake.summarizeCalls).toBe(0);
  });

  it('tokens 超阈值 + 轮次足够 → 触发压缩', async () => {
    const msgs = buildMessages(30, 'a'.repeat(20));
    const fake = new FakeClient('总结：用户问了 30 轮对话');
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 200,
      keepRecentTurns: 5,
    });
    expect(result.compressed).toBe(true);
    expect(fake.summarizeCalls).toBe(1);
    expect(result.summary).toContain('30 轮');
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.messages.length).toBeLessThan(msgs.length);
  });

  it('保留最近 N 轮：最早消息消失，最新消息保留', async () => {
    const msgs = buildMessages(20);
    const fake = new FakeClient();
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 50,
      keepRecentTurns: 3,
    });
    expect(result.compressed).toBe(true);
    const lastMsg = result.messages[result.messages.length - 1]!;
    expect(lastMsg.content).toContain('reply-19');
  });

  it('summarize 失败 → 返回原 messages，compressed=false', async () => {
    const msgs = buildMessages(30);
    const fake = new FakeClient();
    fake.shouldFail = true;
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 50,
      keepRecentTurns: 5,
    });
    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(fake.summarizeCalls).toBe(1);
  });

  it('轮次不够（< keepRecentTurns）→ 不压缩', async () => {
    const msgs = buildMessages(2);
    const fake = new FakeClient();
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 10,
      keepRecentTurns: 5,
    });
    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(msgs);
    expect(fake.summarizeCalls).toBe(0);
  });

  it('默认配置：阈值 24000 token、保留 12 轮', () => {
    expect(DEFAULT_COMPRESSION.thresholdTokens).toBe(24000);
    expect(DEFAULT_COMPRESSION.keepRecentTurns).toBe(12);
  });

  it('defaultThresholdTokens：contextWindow × 90%', async () => {
    const { defaultThresholdTokens } = await import('../../shared/context-window');
    expect(defaultThresholdTokens(256_000)).toBe(Math.floor(256_000 * 0.9));
    expect(defaultThresholdTokens(512_000)).toBe(Math.floor(512_000 * 0.9));
    expect(defaultThresholdTokens(1_000_000)).toBe(Math.floor(1_000_000 * 0.9));
  });

  it('默认 contextWindow 256K 下，构造 ~230K token 触发压缩', async () => {
    // 构造足够多的消息使 token 数 > 230K
    const huge = 'x'.repeat(2000);
    const msgs: ChatMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 500; i++) {
      msgs.push({ role: 'user', content: `${huge}-user-${i}` });
      msgs.push({ role: 'assistant', content: `${huge}-reply-${i}` });
    }
    const tokensBefore = estimateTokens(msgs);
    expect(tokensBefore).toBeGreaterThan(50_000); // 至少 50K（sanity）
    const fake = new FakeClient();
    // 把阈值设到比 tokensBefore 低一些，确保触发
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: Math.floor(tokensBefore * 0.9),
      keepRecentTurns: 12,
    });
    expect(result.compressed).toBe(true);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  }, 30_000); // 1000 条大消息的 tiktoken 编码较重，给足超时

  it('256K × 90% = 230_400 阈值', async () => {
    const { defaultThresholdTokens } = await import('../../shared/context-window');
    expect(defaultThresholdTokens(256_000)).toBe(230_400);
  });

  it('tool 消息绑定到所属 assistant 那轮一起保留', async () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u0' },
      { role: 'assistant', content: 'a0', tool_calls: [{ id: 't0', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't0', name: 'x', content: 'out0' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1', tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', name: 'x', content: 'out1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2', tool_calls: [{ id: 't2', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't2', name: 'x', content: 'out2' },
    ];
    const fake = new FakeClient();
    const result = await compressIfNeeded(msgs, fake, {
      thresholdTokens: 10,
      keepRecentTurns: 2,
    });
    expect(result.compressed).toBe(true);
    // system + summary + 末 2 轮 (u1+a1+t1, u2+a2+t2) = 8 条
    expect(result.messages.length).toBe(8);
    expect(result.messages[result.messages.length - 1]!.role).toBe('tool');
    // 倒数第二条是 a2
    expect(result.messages[result.messages.length - 2]!.content).toBe('a2');
  });
});