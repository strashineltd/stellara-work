import { execFile } from 'node:child_process';
import type { OpenAITool, ToolResult } from '../../../shared/ipc';

function runGit(args: string[], cwd: string, timeoutMs = 15000): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, output: stdout || '', error: stderr || err.message });
      } else {
        resolve({ ok: true, output: stdout || '(无输出)' });
      }
    });
  });
}

export async function gitStatus(_args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  return runGit(['status', '--porcelain', '-b'], cwd);
}

export async function gitDiff(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--staged');
  if (args.file && typeof args.file === 'string') gitArgs.push('--', args.file);
  return runGit(gitArgs, cwd, 30000);
}

export async function gitLog(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
  const n = typeof args.count === 'number' ? args.count : 10;
  return runGit(['log', '--oneline', `-n${n}`], cwd);
}

export const gitTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 git 工作区状态（当前分支 + 变更文件列表）。等同于 `git status --porcelain -b`。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 git diff。默认显示未暂存的变更；设 staged=true 查看已暂存的变更；可指定 file 只看某个文件。',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: '是否查看已暂存的变更（默认 false）' },
          file: { type: 'string', description: '只查看指定文件的 diff' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看最近的 git 提交记录（oneline 格式）。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '显示的提交数量（默认 10）' },
        },
        additionalProperties: false,
      },
    },
  },
];
