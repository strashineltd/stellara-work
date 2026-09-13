import { describe, expect, it } from 'vitest';
import { buildSubagentApprovalId } from './approval-ids';

describe('buildSubagentApprovalId', () => {
  it('格式为 sub-{defId}-{ts}-{rand6}，可被渲染层解析出带连字符的 def id', () => {
    const id = buildSubagentApprovalId('refactor-fs');
    expect(id).toMatch(/^sub-refactor-fs-\d+-[a-z0-9]{6}$/);
  });

  it('随机后缀始终为 6 位', () => {
    for (let i = 0; i < 50; i++) {
      const id = buildSubagentApprovalId('build-1');
      expect(id.split('-').at(-1)).toHaveLength(6);
    }
  });
});
