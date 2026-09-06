/**
 * Memory OS — 记忆提取器测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock memory-store 模块
vi.mock('./memory-store', () => ({
  saveMemory: vi.fn((opts) => ({
    id: `mem-${Date.now()}`,
    scope: opts.scope,
    scopeId: opts.scopeId,
    kind: opts.kind,
    content: opts.content,
    source: opts.source,
    importance: opts.importance ?? 0.5,
    confidence: opts.confidence ?? 0.8,
    accessCount: 0,
    tags: opts.tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  findDuplicateMemory: vi.fn(() => null),
}));

import { buildBrowserMaterial, extractMemories, saveManualMemory } from './memory-extractor';
import { saveMemory, findDuplicateMemory } from './memory-store';
import type { ChatMessage, MessageRow } from '../../shared/ipc';

const mockSaveMemory = vi.mocked(saveMemory);
const mockFindDuplicate = vi.mocked(findDuplicateMemory);

function makeMessages(pairs: Array<[string, string]>): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const [role, content] of pairs) {
    msgs.push({ role: role as ChatMessage['role'], content });
  }
  return msgs;
}

describe('extractMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindDuplicate.mockReturnValue(null);
  });

  it('LLM 返回有效 JSON 数组 → 调用 saveMemory', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { kind: 'preference', content: '用户偏好极简 UI', importance: 0.9, tags: ['ui'] },
      { kind: 'decision', content: '使用 SQLite 而不是 PostgreSQL', importance: 0.8, tags: ['db'] },
    ]));

    const messages = makeMessages([
      ['user', '我觉得界面应该更简洁一些，不要太多装饰'],
      ['assistant', '好的，我会简化界面设计'],
      ['user', '数据库方面我们用 SQLite 就够了'],
      ['assistant', 'SQLite 确实适合这种本地应用'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(llmCall).toHaveBeenCalledOnce();
    expect(mockSaveMemory).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe('preference');
    expect(result[1]!.kind).toBe('decision');
  });

  it('LLM 返回空数组 → 不保存', async () => {
    const llmCall = vi.fn().mockResolvedValue('[]');
    const messages = makeMessages([
      ['user', '帮我看看这个文件的内容，我需要详细分析一下代码结构'],
      ['assistant', '好的，我来仔细看看这个文件并分析其代码结构'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(llmCall).toHaveBeenCalledOnce();
    expect(mockSaveMemory).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('LLM 返回非法 JSON → 静默跳过', async () => {
    const llmCall = vi.fn().mockResolvedValue('这不是JSON');
    const messages = makeMessages([
      ['user', '帮我看看这个文件的内容，需要分析一下代码结构'],
      ['assistant', '好的，我来看看这个文件'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(result).toHaveLength(0);
    expect(mockSaveMemory).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 静默失败，返回空数组', async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error('LLM 超时'));
    const messages = makeMessages([
      ['user', '帮我看看这个文件的内容，需要分析一下代码结构'],
      ['assistant', '好的，我来看看这个文件'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(result).toHaveLength(0);
  });

  it('消息历史 < 50 字符 → 跳过提取', async () => {
    const llmCall = vi.fn();
    const messages = makeMessages([
      ['user', '你好'],
      ['assistant', '你好'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(llmCall).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('LLM 返回的 kind 不在白名单 → 跳过该项', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { kind: 'invalid_kind', content: '这是一条无效类型的记忆', importance: 0.5, tags: [] },
      { kind: 'fact', content: '这是一个有效的事实', importance: 0.7, tags: [] },
    ]));

    const messages = makeMessages([
      ['user', '这个项目使用 Electron 和 React 技术栈'],
      ['assistant', '是的，这是一个现代化的技术栈'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(mockSaveMemory).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('fact');
  });

  it('findDuplicateMemory 返回已有记忆 → 跳过该项', async () => {
    mockFindDuplicate.mockReturnValue({
      id: 'existing',
      scope: 'personal',
      kind: 'fact',
      content: '重复的记忆',
      importance: 0.5,
      confidence: 0.8,
      accessCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { kind: 'fact', content: '重复的记忆', importance: 0.5, tags: [] },
    ]));

    const messages = makeMessages([
      ['user', '这个项目使用 Electron 和 React 技术栈'],
      ['assistant', '是的，这是一个现代化的技术栈'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(mockFindDuplicate).toHaveBeenCalledOnce();
    expect(mockSaveMemory).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('LLM 返回带 markdown 包裹的 JSON → 正确解析', async () => {
    const llmCall = vi.fn().mockResolvedValue('```json\n[{"kind":"fact","content":"这是一个事实","importance":0.7,"tags":[]}]\n```');

    const messages = makeMessages([
      ['user', '这个项目使用 Electron 和 React 技术栈'],
      ['assistant', '是的，这是一个现代化的技术栈'],
    ]);

    const result = await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(mockSaveMemory).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
  });

  it('scope 和 scopeId 正确传递', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { kind: 'fact', content: '项目知识', importance: 0.5, tags: [] },
    ]));

    const messages = makeMessages([
      ['user', '这个项目使用 Electron 和 React 技术栈'],
      ['assistant', '是的，这是一个现代化的技术栈'],
    ]);

    await extractMemories(messages, 'project', 'proj-123', 'session:abc', llmCall);

    expect(mockSaveMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        scopeId: 'proj-123',
        source: 'session:abc',
      }),
    );
  });

  it('importance 值被限制在 0-1 范围', async () => {
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify([
      { kind: 'fact', content: '重要事实', importance: 1.5, tags: [] },
      { kind: 'fact', content: '不重要事实', importance: -0.5, tags: [] },
    ]));

    const messages = makeMessages([
      ['user', '这个项目使用 Electron 和 React 技术栈'],
      ['assistant', '是的，这是一个现代化的技术栈'],
    ]);

    await extractMemories(messages, 'personal', undefined, 'test', llmCall);

    expect(mockSaveMemory).toHaveBeenNthCalledWith(1, expect.objectContaining({ importance: 1 }));
    expect(mockSaveMemory).toHaveBeenNthCalledWith(2, expect.objectContaining({ importance: 0 }));
  });
});

describe('saveManualMemory', () => {
  it('调用 saveMemory 并设置正确的默认值', () => {
    saveManualMemory({ content: '手动保存的记忆', kind: 'fact' });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'personal',
        source: 'manual',
        importance: 0.8,
        confidence: 1.0,
        content: '手动保存的记忆',
        kind: 'fact',
      }),
    );
  });

  it('支持自定义 scope 和 scopeId', () => {
    saveManualMemory({
      content: '项目决策',
      kind: 'decision',
      scope: 'project',
      scopeId: 'proj-123',
      tags: ['important'],
    });

    expect(mockSaveMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        scopeId: 'proj-123',
        tags: ['important'],
      }),
    );
  });
});

function toolRow(partial: Partial<MessageRow>): MessageRow {
  return {
    sessionId: 's', position: 0, role: 'tool', content: '', createdAt: 0,
    ...partial,
  } as MessageRow;
}

describe('buildBrowserMaterial', () => {
  it('keeps web_search and browser_* rows with [工具名] prefix; skips other tools and failed results', () => {
    const rows: MessageRow[] = [
      toolRow({ toolName: 'web_search', content: '搜到 A', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_navigate', content: '已导航', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_snapshot', content: '页面正文', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'read_file', content: '不该出现', meta: JSON.stringify({ ok: true }) }),
      toolRow({ toolName: 'browser_navigate', content: '失败', meta: JSON.stringify({ ok: false }) }),
    ];
    const out = buildBrowserMaterial(rows);
    expect(out).toContain('[web_search] 搜到 A');
    expect(out).toContain('[browser_navigate] 已导航');
    expect(out).toContain('[browser_snapshot] 页面正文');
    expect(out).not.toContain('不该出现');
    expect(out).not.toContain('失败');
  });

  it('keeps tool rows without meta', () => {
    const out = buildBrowserMaterial([toolRow({ toolName: 'browser_act', content: '已点击' })]);
    expect(out).toContain('[browser_act] 已点击');
  });

  it('truncates at 30000 chars with a marker', () => {
    const big = 'x'.repeat(40000);
    const out = buildBrowserMaterial([toolRow({ toolName: 'web_search', content: big })]);
    expect(out.length).toBeLessThanOrEqual(30000 + 6);
    expect(out).toContain('…[已截断]');
  });

  it('returns empty string for no browser rows', () => {
    expect(buildBrowserMaterial([])).toBe('');
    expect(buildBrowserMaterial([toolRow({ toolName: 'read_file', content: 'x' })])).toBe('');
  });
});

describe('extractMemories with browserMaterial', () => {
  it('appends the material block to the transcript and accepts kind web', async () => {
    let transcriptSent = '';
    const llmCall = vi.fn().mockImplementation(async (_sys: string, user: string) => {
      transcriptSent = user;
      return JSON.stringify([{ kind: 'web', content: '调研结论', importance: 0.6, tags: ['web'] }]);
    });
    const saved = await extractMemories(
      [{ role: 'user', content: '帮我调研 Electron' }],
      'personal', undefined, 'session:s1',
      llmCall,
      'material-line-1',
    );
    expect(transcriptSent).toContain('--- 本次会话的网页浏览材料（仅供提炼事实，非用户发言）---');
    expect(transcriptSent).toContain('material-line-1');
    expect(saved.length).toBe(1);
    expect(saved[0]!.kind).toBe('web');
  });

  it('does not append the block when browserMaterial is empty', async () => {
    let transcriptSent = '';
    const llmCall = vi.fn().mockImplementation(async (_sys: string, user: string) => {
      transcriptSent = user;
      return '[]';
    });
    await extractMemories(
      [{ role: 'user', content: '这个项目使用 Electron 和 React 技术栈，我对它的架构和性能优化方案很感兴趣，请帮我详细分析一下' }],
      'personal', undefined, 'session:s1', llmCall,
    );
    expect(llmCall).toHaveBeenCalled();
    expect(transcriptSent).not.toContain('网页浏览材料');
  });
});
