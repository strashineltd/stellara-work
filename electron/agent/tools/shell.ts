import { spawn } from 'node:child_process';
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

/**
 * 用 Node.js 内置 child_process.spawn 跑 shell 命令
 * （不依赖 execa —— execa 8.x/9.x 是 ESM-only，主进程 CJS 编译跑不过）
 */
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

  // 2. Windows 用 PowerShell，其他平台用默认 shell
  const isWindows = process.platform === 'win32';
  const timeoutMs = args.timeoutMs ?? 30000;

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    let child;
    try {
      child = spawn(args.command, {
        cwd,
        shell: isWindows ? 'powershell.exe' : true,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, output: '', error: errorMessage(err) });
      return;
    }

    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      try {
        if (!child.killed) child.kill();
      } catch {
        // ignore
      }
      resolve(result);
    };

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      finish({ ok: false, output: stdout + stderr, error: errorMessage(err) });
    });

    child.on('close', (code) => {
      const output = (stdout + stderr).slice(0, 50000);
      if (code === 0) {
        finish({ ok: true, output });
      } else {
        finish({ ok: false, output, error: `Exit code ${code ?? 'null'}` });
      }
    });

    // 超时
    setTimeout(() => {
      finish({ ok: false, output: stdout + stderr, error: `Timeout after ${timeoutMs}ms` });
    }, timeoutMs);
  });
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
