import { describe, expect, it } from 'vitest';
import { ContextHub } from '../../context/context-hub';
import { buildInstructions } from './instructions';

describe('buildInstructions', () => {
  it('拼装目标、约束、决策、计划与未验证文件段落', async () => {
    const hub = new ContextHub('instr-1', '/tmp', 100_000, 16_384, { persist: false });
    await hub.commitEvent('plan_created', {
      objective: '修复登录',
      constraints: ['不破坏现有测试'],
      steps: [
        { id: 's1', description: '改代码', status: 'completed', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
        { id: 's2', description: '跑测试', status: 'pending', relatedFiles: [], requiredVerification: [], evidenceIds: [] },
      ],
    });

    const text = buildInstructions('SYS', hub.getContext());

    expect(text).toContain('SYS');
    expect(text).toContain('## 当前目标\n修复登录');
    expect(text).toContain('## 约束\n- 不破坏现有测试');
    expect(text).toContain('## 已完成步骤\n- 改代码');
    expect(text).toContain('## 待完成步骤\n- [pending] 跑测试');
  });
});
