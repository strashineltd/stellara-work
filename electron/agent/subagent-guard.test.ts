import { describe, expect, it } from 'vitest';
import { createSubagentToolGuard, normalizeFileScopes } from './subagent-guard';

const CWD = '/repo';

describe('normalizeFileScopes', () => {
  it('把相对文件路径解析为绝对路径', () => {
    expect(normalizeFileScopes(CWD, ['src/a.ts'])).toEqual(['/repo/src/a.ts']);
  });

  it('把 glob 收敛到其所在目录', () => {
    expect(normalizeFileScopes(CWD, ['src/**'])).toEqual(['/repo/src']);
    expect(normalizeFileScopes(CWD, ['src/*.ts'])).toEqual(['/repo/src']);
  });

  it('保留 .. 的解析结果并去除尾部分隔符', () => {
    expect(normalizeFileScopes(CWD, ['../outside'])).toEqual(['/outside']);
    expect(normalizeFileScopes(CWD, ['./src/'])).toEqual(['/repo/src']);
  });

  it('根级通配符回退到 cwd', () => {
    expect(normalizeFileScopes(CWD, ['*.md'])).toEqual(['/repo']);
  });
});

describe('createSubagentToolGuard', () => {
  it('只读子代理拒绝 write_file / edit_file / run_command', () => {
    const guard = createSubagentToolGuard({ readOnly: true, cwd: CWD });
    expect(guard('write_file', { path: 'a.ts', content: 'x' })).toContain('只读子代理');
    expect(guard('edit_file', { path: 'a.ts', oldText: 'a', newText: 'b' })).toContain('只读子代理');
    expect(guard('run_command', { command: 'rm -rf .' })).toContain('只读子代理');
    expect(guard('read_file', { path: 'a.ts' })).toBeNull();
  });

  it('scope 内写文件放行，scope 外拒绝', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD, fileScopes: ['src/a.ts'] });
    expect(guard('write_file', { path: 'src/a.ts', content: 'x' })).toBeNull();
    expect(guard('write_file', { path: 'src/other.ts', content: 'x' })).toContain('fileScopes');
    expect(guard('edit_file', { path: 'src/other.ts', oldText: 'a', newText: 'b' })).toContain('fileScopes');
  });

  it('通过 .. 越界的写入被拒绝', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD, fileScopes: ['src/a.ts'] });
    expect(guard('write_file', { path: 'src/../secret.ts', content: 'x' })).toContain('fileScopes');
    expect(guard('write_file', { path: '/etc/passwd', content: 'x' })).toContain('fileScopes');
  });

  it('glob scope 允许其目录内文件', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD, fileScopes: ['src/**'] });
    expect(guard('write_file', { path: 'src/a/b.ts', content: 'x' })).toBeNull();
    expect(guard('write_file', { path: 'docs/a.md', content: 'x' })).toContain('fileScopes');
  });

  it('run_command 的 cwd 必须落在 fileScopes 内（含省略 cwd，S6）', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD, fileScopes: ['src/**'] });
    // 省略 cwd = 工作目录根，不在 src/** 内 → 必须拒绝
    expect(guard('run_command', { command: 'npm test' })).toContain('fileScopes');
    expect(guard('run_command', { command: 'npm test', cwd: 'src' })).toBeNull();
    expect(guard('run_command', { command: 'npm test', cwd: '../outside' })).toContain('fileScopes');
    expect(guard('run_command', { command: 'npm test', cwd: '/etc' })).toContain('fileScopes');
  });

  it('无 fileScopes 时写工具不做范围限制', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD });
    expect(guard('write_file', { path: 'anywhere/x.ts', content: 'x' })).toBeNull();
  });

  it('非写工具不受 fileScopes 限制', () => {
    const guard = createSubagentToolGuard({ readOnly: false, cwd: CWD, fileScopes: ['src/a.ts'] });
    expect(guard('read_file', { path: 'docs/readme.md' })).toBeNull();
    expect(guard('search_content', { pattern: 'x', query: 'y' })).toBeNull();
  });
});
