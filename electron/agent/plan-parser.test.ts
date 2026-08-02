import { describe, it, expect } from 'vitest';
import { parsePlanFromContent, detectReadyToExecute, formatPlanProgress, tryMatchToolToPlanStep, type Plan } from './plan-parser';

describe('parsePlanFromContent', () => {
  it('extracts numbered steps (1. / 2. format)', () => {
    const plan = parsePlanFromContent('1. Read package.json\n2. Write new file\n3. Run tests');
    expect(plan).not.toBeNull();
    expect(plan!.steps).toHaveLength(3);
    expect(plan!.steps[0]!.description).toBe('Read package.json');
    expect(plan!.steps[2]!.description).toBe('Run tests');
  });

  it('extracts steps with closing paren (1) format)', () => {
    const plan = parsePlanFromContent('1) Do X\n2) Do Y');
    expect(plan!.steps).toHaveLength(2);
  });

  it('extracts "Step N:" format', () => {
    const plan = parsePlanFromContent('Step 1: Install dependencies\nStep 2: Build project');
    expect(plan!.steps).toHaveLength(2);
  });

  it('returns null for content without steps', () => {
    expect(parsePlanFromContent('This is just a paragraph.')).toBeNull();
    expect(parsePlanFromContent('')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parsePlanFromContent('')).toBeNull();
  });

  it('handles mixed content (steps + non-step lines)', () => {
    const plan = parsePlanFromContent('Here is my plan:\n\n1. First step\n\nSome extra text\n\n2. Second step');
    expect(plan!.steps).toHaveLength(2);
  });
});

describe('detectReadyToExecute', () => {
  it('detects uppercase', () => {
    expect(detectReadyToExecute('READY TO EXECUTE')).toBe(true);
  });

  it('detects case-insensitive', () => {
    expect(detectReadyToExecute('ready to execute')).toBe(true);
    expect(detectReadyToExecute('Ready to Execute')).toBe(true);
  });

  it('detects with surrounding text', () => {
    expect(detectReadyToExecute('Plan complete. READY TO EXECUTE now.')).toBe(true);
  });

  it('returns false when absent', () => {
    expect(detectReadyToExecute('Almost ready')).toBe(false);
  });
});

describe('formatPlanProgress', () => {
  const plan: Plan = {
    steps: [
      { index: 1, description: 'Read files', status: 'completed' },
      { index: 2, description: 'Write code', status: 'pending' },
      { index: 3, description: 'Run tests', status: 'pending' },
    ],
    rawPlan: '',
    readyToExecute: true,
  };

  it('includes step status with icons', () => {
    const text = formatPlanProgress(plan);
    expect(text).toContain('✓ Step 1');
    expect(text).toContain('○ Step 2');
    expect(text).toContain('○ Step 3');
  });

  it('shows next pending step', () => {
    const text = formatPlanProgress(plan);
    expect(text).toContain('Write code');
  });

  it('renders in_progress icon', () => {
    const planWithProgress: Plan = {
      steps: [
        { index: 1, description: 'Read files', status: 'completed' },
        { index: 2, description: 'Write code', status: 'in_progress' },
        { index: 3, description: 'Run tests', status: 'pending' },
      ],
      rawPlan: '',
      readyToExecute: true,
    };
    const text = formatPlanProgress(planWithProgress);
    expect(text).toContain('✓ Step 1');
    expect(text).toContain('🔄 Step 2');
    expect(text).toContain('○ Step 3');
  });
});

describe('tryMatchToolToPlanStep', () => {
  const plan: Plan = {
    steps: [
      { index: 1, description: '读取 package.json 了解项目结构', status: 'pending' },
      { index: 2, description: '创建 src/utils.ts 文件', status: 'pending' },
      { index: 3, description: '运行测试验证', status: 'pending' },
    ],
    rawPlan: '',
    readyToExecute: true,
  };

  it('matches by file path', () => {
    const result = tryMatchToolToPlanStep(plan, 'read_file', { path: 'package.json' });
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1);
  });

  it('matches by command keyword', () => {
    const result = tryMatchToolToPlanStep(plan, 'run_command', { command: 'npm test' });
    expect(result).not.toBeNull();
    expect(result!.index).toBe(3);
  });

  it('matches write_file by keyword in description', () => {
    const result = tryMatchToolToPlanStep(plan, 'write_file', { path: 'src/utils.ts', content: 'x' });
    expect(result).not.toBeNull();
    expect(result!.index).toBe(2);
  });

  it('does not return already-completed steps', () => {
    const planDone: Plan = {
      steps: [
        { index: 1, description: '读取文件', status: 'completed' },
        { index: 2, description: '写代码', status: 'pending' },
      ],
      rawPlan: '',
      readyToExecute: true,
    };
    const result = tryMatchToolToPlanStep(planDone, 'read_file', { path: 'x' });
    // 应该跳过已完成的步骤 1，匹配到步骤 2 的关键词（无），回退也不应返回步骤1
    expect(result?.index).not.toBe(1);
  });

  it('falls back to first pending step only for write tools', () => {
    // 用一个完全不匹配的 plan 来测试回退
    const genericPlan: Plan = {
      steps: [
        { index: 1, description: 'Do thing A', status: 'pending' },
        { index: 2, description: 'Do thing B', status: 'pending' },
      ],
      rawPlan: '',
      readyToExecute: true,
    };
    const result = tryMatchToolToPlanStep(genericPlan, 'write_file', { path: 'x.txt', content: 'x' });
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1); // first pending
  });

  it('returns null for unmatched read-only tools', () => {
    const result = tryMatchToolToPlanStep(plan, 'search_content', { pattern: 'foo', query: 'bar' });
    expect(result).toBeNull();
  });
});
