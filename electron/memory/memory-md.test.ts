import { describe, it, expect } from 'vitest';
import { memoryToMarkdown, memoriesToExport, exportFileName, exportAllFileName } from './memory-md';
import type { Memory } from '../../shared/ipc';

const base: Memory = {
  id: 'm1', scope: 'project', scopeId: 'p1', kind: 'codebase',
  content: 'Agent 工具白名单：npm/node/git。禁止 sh/bash。',
  source: 'session:abc', importance: 0.8, confidence: 0.9,
  accessCount: 3, tags: ['Agent', '安全'],
  createdAt: 1785974400000, updatedAt: 1785996000000,
};

describe('memoryToMarkdown', () => {
  it('emits frontmatter with all fields', () => {
    const md = memoryToMarkdown(base);
    expect(md).toContain('---\n');
    expect(md).toContain('kind: codebase');
    expect(md).toContain('scope: project');
    expect(md).toContain('scopeId: p1');
    expect(md).toContain('tags: [Agent, 安全]');
    expect(md).toContain('source: session:abc');
    expect(md).toContain('importance: 0.8');
    expect(md).toContain('confidence: 0.9');
    expect(md).toContain('accessCount: 3');
    expect(md).toContain('created: 2026-08-06T');
    expect(md).toContain('updated: 2026-08-06T');
    expect(md).toContain('\n\nAgent 工具白名单');
  });

  it('omits scopeId for personal memories', () => {
    const md = memoryToMarkdown({ ...base, scope: 'personal', scopeId: undefined });
    expect(md).not.toContain('scopeId');
  });

  it('omits tags line when no tags', () => {
    const md = memoryToMarkdown({ ...base, tags: undefined });
    expect(md).not.toContain('tags:');
  });
});

describe('memoriesToExport', () => {
  it('groups pinned (importance>=0.8) first, then by kind', () => {
    const m1 = { ...base, id: 'a', kind: 'fact', importance: 0.5, content: '低重要事实' };
    const m2 = { ...base, id: 'b', kind: 'fact', importance: 0.9, content: '重要事实' };
    const m3 = { ...base, id: 'c', kind: 'preference', importance: 0.6, content: '偏好' };
    const doc = memoriesToExport([m1, m2, m3]);
    expect(doc).toContain('# Stellara Work 记忆导出');
    expect(doc.indexOf('## 重要记忆')).toBeLessThan(doc.indexOf('## 事实'));
    expect(doc.indexOf('## 事实')).toBeLessThan(doc.indexOf('## 偏好'));
    expect(doc).toContain('重要事实');
    expect(doc).toContain('低重要事实');
    expect(doc).toContain('偏好');
  });
});

describe('file names', () => {
  it('sanitizes illegal filename chars', () => {
    const name = exportFileName({ ...base, content: '路径 a/b:c*d? "x" 测试' });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toMatch(/\.md$/);
  });
  it('formats all-export filename', () => {
    expect(exportAllFileName(new Date('2026-08-07T00:00:00Z'))).toBe('Stellara-Memories-20260807.md');
  });
});
