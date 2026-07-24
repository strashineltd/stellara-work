import { execa, ExecaError } from 'execa';
import type { RunCommandArgs, ToolResult, OpenAITool } from '../../../shared/ipc';

/**
 * shell 命令白名单（基础安全检查）
 * 危险命令（rm -rf /、format、shutdown 等）会被拦截
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*f[a-z]*\s+)?\/\s*$/i, // rm -rf /
  /\bformat\s+[a-z]:/i, // format c:
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdel\s+\/[sq]\s+[a-z]:\\/i, // del /s q c:\
];

export async function runCommand(args: RunCommandArgs, cwd: string): Promise<ToolResult> {
  // 1. 危险命令检查
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(args.command)) {
      return {
        ok: false,
        output: '',
        error: `命令被安全策略拦截：包含危险操作（${pattern.source}）`,
      };
    }
  }

  // 2. PowerShell on Windows（v0.9 Windows 专属）
  const isWindows = process.platform === 'win32';
  try {
    const result = await execa(args.command, {
      shell: isWindows ? 'powershell.exe' : true,
      cwd,
      timeout: args.timeoutMs ?? 30000,
      reject: false,
      all: true, // 合并 stdout + stderr
    });

    if (result.failed) {
      return {
        ok: false,
        output: result.all ?? '',
        error: `Exit code ${result.exitCode}: ${(result as ExecaError).shortMessage ?? ''}`,
      };
    }
    return {
      ok: true,
      output: (result.all ?? '').slice(0, 50000), // 限制输出大小
    };
  } catch (err) {
    return { ok: false, output: '', error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const shellTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '执行一个 shell 命令（Windows 上是 PowerShell）。返回 stdout + stderr 合并的输出。默认超时 30 秒。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          timeoutMs: { type: 'number', description: '超时毫秒数（默认 30000）' },
        },
        required: ['command'],
      },
    },
  },
];
