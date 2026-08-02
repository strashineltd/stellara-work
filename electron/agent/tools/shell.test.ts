import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCommand, runCommand } from './shell';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-shell-'));
});

afterEach(async () => {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows: 文件句柄可能未完全释放，忽略
  }
});

describe('parseCommand', () => {
  it('splits simple command', () => {
    const r = parseCommand('git status --short');
    expect('exe' in r).toBe(true);
    if ('exe' in r) {
      expect(r.exe).toBe('git');
      expect(r.args).toEqual(['status', '--short']);
    }
  });

  it('preserves quoted args with spaces', () => {
    const r = parseCommand('git commit -m "hello world"');
    expect('exe' in r).toBe(true);
    if ('exe' in r) {
      expect(r.exe).toBe('git');
      expect(r.args).toEqual(['commit', '-m', 'hello world']);
    }
  });

  it('rejects empty command', () => {
    const r = parseCommand('   ');
    expect('error' in r).toBe(true);
  });

  it('rejects multiline command', () => {
    const r = parseCommand('git status\nrm -rf /');
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('多行');
  });

  it('rejects shell metacharacters', () => {
    for (const bad of ['a | b', 'a > b', 'a < b', 'a ; b', 'a & b', '`a`', '$(a)']) {
      const r = parseCommand(bad);
      expect('error' in r).toBe(true);
    }
  });

  it('handles single quotes', () => {
    const r = parseCommand("echo 'hello world'");
    expect('exe' in r).toBe(true);
    if ('exe' in r) expect(r.args).toEqual(['hello world']);
  });

  it('rejects multiline with \\r\\n', () => {
    const r = parseCommand('git log\r\nrm -rf /');
    expect('error' in r).toBe(true);
  });
});

describe('runCommand', () => {
  it('runs node --version successfully', async () => {
    const result = await runCommand({ command: 'node --version' }, tmpDir);
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/v\d+/);
  });

  it('rejects command not in whitelist', async () => {
    const result = await runCommand({ command: 'curl http://example.com' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('白名单');
  });

  it('rejects destructive commands', async () => {
    for (const cmd of ['del file.txt', 'rmdir /s dir', 'move a b', 'ren a b']) {
      const result = await runCommand({ command: cmd }, tmpDir);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects shell special characters', async () => {
    const result = await runCommand({ command: 'node --version | findstr v' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('特殊字符');
  });

  it('rejects multiline commands', async () => {
    const result = await runCommand({ command: 'node --version\nrm -rf /' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('多行');
  });

  it('rejects absolute path exe', async () => {
    const result = await runCommand({ command: 'C:\\Windows\\System32\\cmd.exe /c dir' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('绝对路径');
  });

  it('rejects git -C pointing outside cwd', async () => {
    const outside = path.join(os.tmpdir(), 'outside-repo');
    const result = await runCommand({ command: `git -C "${outside}" status` }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('绝对路径');
  });

  it('rejects npm --prefix pointing outside cwd', async () => {
    const outside = path.join(os.tmpdir(), 'outside-pkg');
    const result = await runCommand({ command: `npm --prefix "${outside}" list` }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('绝对路径');
  });

  it('rejects node with absolute path file argument', async () => {
    const outside = path.join(os.tmpdir(), 'evil.js');
    const result = await runCommand({ command: `node "${outside}"` }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('绝对路径');
  });

  it('rejects python with .. path file argument', async () => {
    const result = await runCommand({ command: 'python ../../../etc/passwd' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超出');
  });

  it('runs safe in-cwd node script', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.js'), 'console.log("ok")');
    const result = await runCommand({ command: 'node test.js' }, tmpDir);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('ok');
  });

  it('timeout cleans up timer and does not leave dangling resolve', async () => {
    // 写一个长时间运行的脚本，避免 shell 特殊字符
    await fs.writeFile(path.join(tmpDir, 'sleep.js'), 'setTimeout(function(){}, 100000);');
    const result = await runCommand(
      { command: 'node sleep.js', timeoutMs: 200 },
      tmpDir,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Timeout');
    // 等待子进程完全释放文件句柄（Windows 上 kill 后需要一点时间）
    await new Promise((r) => setTimeout(r, 300));
  });

  it('includes meta on success', async () => {
    const result = await runCommand({ command: 'node --version' }, tmpDir);
    expect(result.ok).toBe(true);
    expect(result.meta).toBeDefined();
    if (result.meta?.kind === 'command') {
      expect(result.meta.exitCode).toBe(0);
      expect(result.meta.durationMs).toBeGreaterThan(0);
    }
  });

  it('rejects git with .. path flag value', async () => {
    const result = await runCommand({ command: 'git -C ../../.. status' }, tmpDir);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('超出');
  });
});
