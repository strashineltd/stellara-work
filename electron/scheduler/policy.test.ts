import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScheduledPolicyRuntime, matchesCommandAllowlist, normalizeScheduledPolicy, validateTaskPolicy } from './policy';

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

  it('S5：拒绝过宽的 npm run / 裸 install 白名单项', () => {
    expect(
      validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['npm run'] }),
    ).toContain('过宽');
    expect(
      validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['npm install'] }),
    ).toContain('过宽');
    expect(
      validateTaskPolicy({ allowedTools: ['run_command'], fileScopes: [], allowedCommands: ['npm run build'] }),
    ).toBeNull();
  });

  it('空策略合法', () => {
    expect(validateTaskPolicy(undefined)).toBeNull();
    expect(validateTaskPolicy({ allowedTools: [], fileScopes: [], allowedCommands: [] })).toBeNull();
  });
});

describe('matchesCommandAllowlist', () => {
  const ALLOW = ['npm test', 'git status'];

  it('前缀 + 仅旗标/`--` 后参数命中', () => {
    expect(matchesCommandAllowlist('npm test', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('npm test -- --runInBand', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('git status --short', ALLOW)).toBe(true);
    expect(matchesCommandAllowlist('npm test --silent', ALLOW)).toBe(true);
  });

  it('同前缀不同 token 不命中', () => {
    expect(matchesCommandAllowlist('npm testing', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('echo npm test', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('gits status', ALLOW)).toBe(false);
  });

  it('S5：前缀后出现位置参数不命中（防 npm run 前缀放行任意脚本）', () => {
    expect(matchesCommandAllowlist('npm test extra-positional', ALLOW)).toBe(false);
    expect(matchesCommandAllowlist('npm run evil', ['npm run'])).toBe(false);
    expect(matchesCommandAllowlist('npm run build --watch', ['npm run build'])).toBe(true);
  });

  it('空白名单/空命令不命中', () => {
    expect(matchesCommandAllowlist('npm test', [])).toBe(false);
    expect(matchesCommandAllowlist('', ALLOW)).toBe(false);
  });
});

describe('buildScheduledPolicyRuntime', () => {
  let ws: string;

  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), 's5-policy-'));
    await fs.mkdir(path.join(ws, 'src'), { recursive: true });
    await fs.mkdir(path.join(ws, 'docs'), { recursive: true });
    await fs.writeFile(path.join(ws, 'src', 'a.ts'), 'a');
    await fs.writeFile(path.join(ws, 'src', 'secrets.json'), '{}');
    await fs.writeFile(path.join(ws, 'package.json'), '{}');
    await fs.writeFile(path.join(ws, 'docs', 'readme.md'), 'md');
    await fs.writeFile(path.join(ws, 'outside.txt'), 'out');
    await fs.symlink(path.join(ws, 'outside.txt'), path.join(ws, 'src', 'link.txt'));
  });

  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });

  const POLICY = {
    allowedTools: ['edit_file', 'run_command'] as const,
    fileScopes: ['src/**'],
    allowedCommands: ['npm test'],
  };

  function runtimeFor(overrides: Partial<typeof POLICY> & { fileScopes?: string[]; allowedCommands?: string[]; allowedTools?: Array<'write_file' | 'edit_file' | 'run_command'> } = {}) {
    return buildScheduledPolicyRuntime(
      { ...POLICY, allowedTools: [...POLICY.allowedTools], ...overrides },
      ws,
    );
  }

  it('无策略：空工具集、审批恒 false', () => {
    const runtime = buildScheduledPolicyRuntime(undefined, ws);
    expect([...runtime.allowedToolNames]).toEqual([]);
    expect(runtime.shouldApprove('edit_file')).toBe(false);
    expect(runtime.shouldApprove('read_file')).toBe(false);
  });

  it('有策略：只批准白名单工具', () => {
    const runtime = runtimeFor();
    expect(runtime.shouldApprove('edit_file')).toBe(true);
    expect(runtime.shouldApprove('run_command')).toBe(true);
    expect(runtime.shouldApprove('write_file')).toBe(false);
  });

  it('guard：范围内写入放行', async () => {
    expect(await runtimeFor().toolGuard('edit_file', { path: 'src/a.ts' })).toBeNull();
    expect(await runtimeFor().toolGuard('write_file', { path: 'src/new.ts' })).toBeNull();
  });

  it('guard：目录前缀外的路径拒绝', async () => {
    expect(await runtimeFor().toolGuard('edit_file', { path: '../outside.txt' })).toContain('超出');
    expect(await runtimeFor().toolGuard('edit_file', { path: 'package.json' })).toContain('可写范围');
  });

  it('guard：前导空格不会绕过范围（与文件工具解析一致）', async () => {
    expect(await runtimeFor().toolGuard('edit_file', { path: ' src/a.ts' })).toContain('可写范围');
  });

  it('guard：指向范围外的符号链接被拒绝', async () => {
    expect(await runtimeFor().toolGuard('edit_file', { path: 'src/link.txt' })).toContain('可写范围');
  });

  it('guard：glob 语义不被放大为目录权限', async () => {
    const tsOnly = runtimeFor({ fileScopes: ['src/*.ts'] });
    expect(await tsOnly.toolGuard('edit_file', { path: 'src/a.ts' })).toBeNull();
    expect(await tsOnly.toolGuard('edit_file', { path: 'src/secrets.json' })).toContain('可写范围');

    const mdOnly = runtimeFor({ fileScopes: ['**/*.md'] });
    expect(await mdOnly.toolGuard('edit_file', { path: 'docs/readme.md' })).toBeNull();
    expect(await mdOnly.toolGuard('edit_file', { path: 'package.json' })).toContain('可写范围');
  });

  it('guard：白名单外命令拒绝、白名单内放行', async () => {
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test -- --runInBand', cwd: 'src' })).toBeNull();
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm install', cwd: 'src' })).toContain('命令不在任务白名单内');
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test extra-positional', cwd: 'src' })).toContain('命令不在任务白名单内');
  });

  it('guard：显式 cwd 必须落于声明范围；S6 省略 cwd 不得跳过 fileScopes', async () => {
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test', cwd: 'src' })).toBeNull();
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test', cwd: '.' })).toContain('cwd');
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test', cwd: '../' })).toContain('cwd');
    // 省略 cwd = 工作目录根，不在 src/** 内 → 必须拒绝
    expect(await runtimeFor().toolGuard('run_command', { command: 'npm test' })).toContain('可写范围');
  });

  it('guard：无 fileScopes 时省略 cwd 可放行', async () => {
    const runtime = runtimeFor({ fileScopes: [], allowedTools: ['run_command'] });
    expect(await runtime.toolGuard('run_command', { command: 'npm test' })).toBeNull();
  });

  it('guard：MCP / 浏览器 / 子代理工具在调度中显式拒绝', async () => {
    expect(await runtimeFor().toolGuard('mcp__s1__read', {})).toContain('调度');
    expect(await runtimeFor().toolGuard('browser_navigate', { url: 'https://example.com' })).toContain('调度');
    expect(await runtimeFor().toolGuard('dispatch_subagents', {})).toContain('调度');
  });
});
