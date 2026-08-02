import { describe, it, expect } from 'vitest';
import { BUILD_MODE_SYSTEM_PROMPT } from './plan';

describe('BUILD_MODE_SYSTEM_PROMPT', () => {
  it('contains core rules', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('先读后改');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('先搜后读');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('改完必验');
  });

  it('contains verification guidance', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('read_file');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('确认修改正确');
  });

  it('lists all tool names', () => {
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('edit_file');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('search_content');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('git_status');
    expect(BUILD_MODE_SYSTEM_PROMPT).toContain('task_complete');
  });
});
