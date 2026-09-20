import { describe, expect, it } from 'vitest';
import { matchesCommandAllowlist, normalizeScheduledPolicy, validateTaskPolicy } from './policy';

const VALID = {
  allowedTools: ['edit_file', 'run_command'] as const,
  fileScopes: ['src/**'],
  allowedCommands: ['npm test'],
};

describe('normalizeScheduledPolicy', () => {
  it('去重、去空白并丢弃未知工具', () => {
    expect(
      normalizeScheduledPolicy({
        allowedTools: ['edit_file', 'edit_file', 'unknown' as never],
        fileScopes: [' src/** ', ''],
        allowedCommands: [' npm test '],
      }),
    ).toEqual({ allowedTools: ['edit_file'], fileScopes: ['src/**'], allowedCommands: ['npm test'] });
  });

  it('空策略归一为 undefined', () => {
    expect(normalizeScheduledPolicy({ allowedTools: [], fileScopes: [], allowedCommands: [] })).toBeUndefined();
    expect(normalizeScheduledPolicy(undefined)).toBeUndefined();
  });
});

describe('validateTaskPolicy', () => {
  it('合法策略通过', () => {
    expect(validateTaskPolicy({ ...VALID, allowedTools: [...VALID.allowedTools] })).toBeNull();
  });

  it('选 write/edit 必须有可写范围', () => {
    expect(validateTaskPolicy({ allowedTools: ['write_file'], fileScopes: [], allowedCommands: [] })).toContain('可写范围');
  });

  it('选 run_command 必须有命令白名单', () => {
    expect(validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: [] })).toContain('命令白名单');
  });

  it('拒绝绝对路径或 ../ 逃逸的可写范围', () => {
    expect(validateTaskPolicy({ allowedTools: ['edit_file'], fileScopes: ['/etc'], allowedCommands: [] })).toContain('相对路径');
    expect(validateTaskPolicy({ allowedTools: ['edit_file'], fileScopes: ['../x'], allowedCommands: [] })).toContain('相对路径');
  });

  it('拒绝不合法的命令项', () => {
    expect(
      validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['bash -c x'] }),
    ).toContain('不合法');
  });

  it('空策略合法', () => {
    expect(validateTaskPolicy(undefined)).toBeNull();
    expect(validateTaskPolicy({ allowedTools: [], fileScopes: [], allowedCommands: [] })).toBeNull();
  });
});

describe('matchesCommandAllowlist', () => {
  const ALLOW = ['npm test', 'git status'];

  it('token 边界前缀命中', () => {
    expect(matchesCommandAllowlist('npm test', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('npm test -- --runInBand', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('git status --short', ALLOW)).toBe(true);
  });

  it('同前缀不同 token 不命中', () => {
    expect(matchesCommandAllowlist('npm testing', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('echo npm test', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('gits status', ALLOW)).toBe(false);
  });

  it('空白名单/空命令不命中', () => {
    expect(matchesCommandAllowlist('npm test', [])).toBe(false);
    expect(matchesCommandAllowlist('', ALLOW)).toBe(false);
  });
});
