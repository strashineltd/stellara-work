import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

import { gitStatus, gitDiff, gitLog } from './git';

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

function mockResult(err: Error | null, stdout = '', stderr = '') {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
    cb(err, stdout, stderr);
  });
}

function lastArgs(): string[] {
  return execFileMock.mock.calls.at(-1)![1] as string[];
}

function lastEnv(): NodeJS.ProcessEnv {
  return (execFileMock.mock.calls.at(-1)![2] as { env: NodeJS.ProcessEnv }).env;
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('gitDiff (H7)', () => {
  it('passes --no-textconv and --no-ext-diff to git diff', async () => {
    mockResult(null, 'diff --git a/x b/x\n');
    const r = await gitDiff({}, '/tmp/repo');
    const args = lastArgs();
    const diffIdx = args.indexOf('diff');
    expect(diffIdx).toBeGreaterThan(-1);
    expect(args.indexOf('--no-textconv')).toBeGreaterThan(diffIdx);
    expect(args.indexOf('--no-ext-diff')).toBeGreaterThan(diffIdx);
    expect(r).toEqual({ ok: true, output: 'diff --git a/x b/x\n' });
  });

  it('keeps --no-textconv/--no-ext-diff before the pathspec separator when file is given', async () => {
    mockResult(null, 'out');
    await gitDiff({ staged: true, file: 'src/a.ts' }, '/tmp/repo');
    const args = lastArgs();
    expect(args).toContain('--staged');
    expect(args).toContain('--no-textconv');
    expect(args).toContain('--no-ext-diff');
    const sep = args.indexOf('--');
    expect(sep).toBeGreaterThan(-1);
    expect(args.indexOf('--no-textconv')).toBeLessThan(sep);
    expect(args.indexOf('--no-ext-diff')).toBeLessThan(sep);
    expect(args.slice(sep + 1)).toEqual(['src/a.ts']);
  });

  it('parses stdout/stderr exactly as before', async () => {
    mockResult(null, 'stdout content');
    const ok = await gitDiff({}, '/tmp/repo');
    expect(ok).toEqual({ ok: true, output: 'stdout content' });

    mockResult(new Error('boom'), 'partial', 'fatal: bad revision');
    const fail = await gitDiff({}, '/tmp/repo');
    expect(fail).toEqual({ ok: false, output: 'partial', error: 'fatal: bad revision' });
  });
});

describe('git hardening (H7)', () => {
  it('neutralizes pager/fsmonitor and drops GIT_EXTERNAL_DIFF for all git commands', async () => {
    mockResult(null, 'ok');
    process.env.GIT_EXTERNAL_DIFF = '/tmp/evil';
    try {
      await gitStatus({}, '/tmp/repo');
      let args = lastArgs();
      expect(args).toContain('core.pager=cat');
      expect(args).toContain('core.fsmonitor=false');
      let env = lastEnv();
      expect(env.GIT_PAGER).toBe('cat');
      expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();

      await gitLog({ count: 3 }, '/tmp/repo');
      args = lastArgs();
      expect(args).toContain('core.pager=cat');
      expect(args).toContain('core.fsmonitor=false');
      env = lastEnv();
      expect(env.GIT_PAGER).toBe('cat');
      expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
    } finally {
      delete process.env.GIT_EXTERNAL_DIFF;
    }
  });

  it('scrubs STELLARA_* and secret-like vars from the git child env (P1 review)', async () => {
    mockResult(null, 'ok');
    process.env.STELLARA_TEST_LEAK = 'top-secret';
    process.env.GITHUB_TOKEN = 'ghp_x';
    process.env.SOME_PASSWORD = 'pw';
    process.env.MY_RANDOM_VAR = 'visible';
    try {
      await gitStatus({}, '/tmp/repo');
      const env = lastEnv();
      expect(env.STELLARA_TEST_LEAK).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.SOME_PASSWORD).toBeUndefined();
      expect(env.MY_RANDOM_VAR).toBeUndefined();
      expect(env.GIT_PAGER).toBe('cat');
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.GIT_EXTERNAL_DIFF).toBeUndefined();
      for (const key of Object.keys(env)) {
        expect(key.startsWith('STELLARA_'), key).toBe(false);
        expect(/_TOKEN$|_SECRET$|_PASSWORD$|_API_KEY$/.test(key), key).toBe(false);
      }
    } finally {
      delete process.env.STELLARA_TEST_LEAK;
      delete process.env.GITHUB_TOKEN;
      delete process.env.SOME_PASSWORD;
      delete process.env.MY_RANDOM_VAR;
    }
  });

  it('keeps git_status and git_log output shape unchanged', async () => {
    mockResult(null, '## main\n M a.ts\n');
    const status = await gitStatus({}, '/tmp/repo');
    expect(status).toEqual({ ok: true, output: '## main\n M a.ts\n' });
    expect(lastArgs()).toEqual(
      expect.arrayContaining(['status', '--porcelain', '-b']),
    );

    mockResult(null, 'abc123 init\n');
    const log = await gitLog({ count: 7 }, '/tmp/repo');
    expect(log).toEqual({ ok: true, output: 'abc123 init\n' });
    expect(lastArgs()).toEqual(expect.arrayContaining(['log', '--oneline', '-n7']));
  });
});
