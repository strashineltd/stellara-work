import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RunCommandArgs, ToolResult, OpenAITool, ToolResultMeta } from '../../../shared/ipc';

/**
 * 命令白名单（安全子集）。
 *
 * 移除了破坏性命令（del, rmdir, move, ren, copy, attrib, rm, mv, cp）。
 * 只保留只读/安全的开发命令。
 * 不包含 Windows cmd 内建命令（echo, dir, type, cd, md, rd）。
 */
const ALLOWED_COMMANDS_WIN = new Set([
  // 包管理 / 运行时
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'corepack',
  // 版本控制
  'git',
  // 只读文件操作
  'where', 'findstr',
  // 系统信息（只读）
  'whoami', 'systeminfo', 'tasklist', 'ver', 'hostname',
  // 开发工具
  'python', 'pip', 'cargo', 'rustc', 'rustup', 'go', 'java', 'javac', 'gradle', 'mvn',
]);

const ALLOWED_COMMANDS_POSIX = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'corepack',
  'git',
  // 只读文件操作
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'rg',
  'pwd', 'whoami', 'uname', 'which', 'env', 'true', 'false', 'test',
  // 开发工具
  'python', 'python3', 'pip3', 'cargo', 'rustc', 'rustup', 'go', 'java', 'javac', 'gradle', 'mvn',
  // 文本处理（只读）
  'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'diff',
  // macOS / Linux 构建链
  'make', 'cmake', 'ninja', 'clang', 'clang++', 'cc', 'gcc', 'g++',
  // macOS 专属开发命令
  'swift', 'swiftc', 'swiftformat', 'swiftlint', 'xcrun', 'xcodebuild', 'brew',
  'plutil', 'open', 'sqlite3', 'mdls',
  // macOS 系统信息（只读）
  'sw_vers', 'sysctl', 'defaults', 'diskutil',
  // 只读系统信息（POSIX / macOS）
  'stat', 'du', 'df', 'file',
  // 网络（只读语义：请求资源；下载写文件仍走 run_command 审批）
  'curl',
]);

function allowedCommands(): Set<string> {
  return process.platform === 'win32' ? ALLOWED_COMMANDS_WIN : ALLOWED_COMMANDS_POSIX;
}

/**
 * 带路径语义的 flag 定义。
 * key: 命令名
 * value: flag → 如果后面跟值，该值是否代表路径
 */
const PATH_FLAGS: Record<string, Set<string>> = {
  git: new Set(['-C', '--work-tree', '--git-dir']),
  npm: new Set(['--prefix']),
  swift: new Set(['--package-path']),
  cargo: new Set(['--manifest-path', '--target-dir']),
  xcodebuild: new Set(['-project', '-workspace']),
  go: new Set(['-C', '-modfile']),
  node: new Set(), // node 的文件参数由 validateFileArgs 处理
  python: new Set(),
  python3: new Set(),
};

/**
 * 单条命令解析：
 * - 仅取首行（拒绝多行 pipeline）
 * - 第一个 token 为 exe
 * - 剩余按 shell-style 分词
 */
export interface ParsedCommand {
  exe: string;
  args: string[];
  raw: string;
}

export function parseCommand(command: string): ParsedCommand | { error: string } {
  const trimmed = command.trim();
  if (!trimmed) return { error: '命令为空' };
  if (/[\r\n]/.test(trimmed)) return { error: '不支持多行命令 / pipeline。请拆成多次 run_command 调用。' };
  if (/[|&;<>`$()]/.test(trimmed)) {
    return { error: '命令包含 shell 特殊字符（| & ; < > ` $ ( )）。请拆成多次 run_command 调用，且不要用 shell 特性。' };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { error: '命令解析失败' };
  const exe = tokens[0]!;
  const args = tokens.slice(1);
  return { exe, args, raw: trimmed };
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur !== '') {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/**
 * 跨平台绝对路径检测：
 * - POSIX 绝对路径（/xxx）
 * - Windows 盘符路径（C:\xxx / C:/xxx）与 UNC 路径（\\server\share）
 * 无论宿主平台，模型生成的 Windows 风格路径都要被拒绝。
 */
export function isAbsolutePathArg(p: string): boolean {
  if (path.isAbsolute(p)) return true;
  return /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

/**
 * 校验路径参数是否在工作目录内。
 * 拒绝绝对路径和 .. 越界。
 * 返回 null 表示 OK，返回字符串表示错误。
 */
function validatePathArg(arg: string, cwd: string): string | null {
  // 跳过 flag（--xxx, -x）—— 除非它是带路径语义的 flag，由 validatePathFlags 处理
  if (arg.startsWith('-')) return null;
  // 跳过不含路径分隔符且不含 .. 的纯文本参数（如 commit message）
  if (!arg.includes('/') && !arg.includes('\\') && !arg.includes('..')) return null;
  // 拒绝绝对路径
  if (isAbsolutePathArg(arg)) {
    return `路径参数 "${arg}" 是绝对路径，不允许。请使用相对路径。`;
  }
  // 拒绝 .. 越界
  if (arg.includes('..')) {
    const resolved = path.resolve(cwd, arg);
    if (!resolved.startsWith(path.normalize(cwd))) {
      return `路径参数 "${arg}" 超出工作目录。`;
    }
  }
  return null;
}

/**
 * 校验带路径语义的 flag（如 git -C /path, npm --prefix /path）。
 */
function validatePathFlags(exe: string, args: string[], cwd: string): string | null {
  const exeBase = path.basename(exe).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  const pathFlags = PATH_FLAGS[exeBase];
  if (!pathFlags || pathFlags.size === 0) return null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (pathFlags.has(arg)) {
      // 下一个 token 是路径值
      const value = args[i + 1];
      if (value) {
        if (isAbsolutePathArg(value)) {
          return `命令 ${exeBase} 的 ${arg} 参数 "${value}" 是绝对路径，不允许。请使用相对路径。`;
        }
        if (value.includes('..')) {
          const resolved = path.resolve(cwd, value);
          if (!resolved.startsWith(path.normalize(cwd))) {
            return `命令 ${exeBase} 的 ${arg} 参数 "${value}" 超出工作目录。`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * 校验 node/python 的文件参数（非 flag 的第一个参数）。
 * - node script.js → script.js 是文件路径
 * - node -e "code" → 不是文件路径（跳过）
 * - python script.py → script.py 是文件路径
 */
function validateFileArgs(exe: string, args: string[], cwd: string): string | null {
  const exeBase = path.basename(exe).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (!['node', 'python', 'python3'].includes(exeBase)) return null;

  // 找到第一个非 flag 参数
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // 跳过 flag
    if (arg.startsWith('-')) continue;
    // 这是文件参数
    if (isAbsolutePathArg(arg)) {
      return `${exeBase} 的文件参数 "${arg}" 是绝对路径，不允许。请使用相对路径。`;
    }
    if (arg.includes('..')) {
      const resolved = path.resolve(cwd, arg);
      if (!resolved.startsWith(path.normalize(cwd))) {
        return `${exeBase} 的文件参数 "${arg}" 超出工作目录。`;
      }
    }
    break; // 只检查第一个非 flag 参数
  }
  return null;
}

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * 跑 shell 命令（白名单 + no-shell + 路径约束）
 */
export async function runCommand(args: RunCommandArgs, cwd: string): Promise<ToolResult> {
  const parsed = parseCommand(args.command);
  if ('error' in parsed) {
    return { ok: false, output: '', error: parsed.error };
  }

  // 白名单校验：只用 basename，拒绝绝对路径 exe
  if (isAbsolutePathArg(parsed.exe)) {
    return { ok: false, output: '', error: `不允许使用绝对路径执行命令：${parsed.exe}` };
  }
  const exeBase = path.basename(parsed.exe).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (!allowedCommands().has(exeBase)) {
    return {
      ok: false,
      output: '',
      error: `命令未在白名单：${parsed.exe}。当前仅允许只读/安全的开发命令。`,
    };
  }

  // 路径参数校验（通用：检测含路径分隔符的参数）
  for (const arg of parsed.args) {
    const err = validatePathArg(arg, cwd);
    if (err) return { ok: false, output: '', error: err };
  }

  // 带路径语义的 flag 校验（git -C, npm --prefix 等）
  const flagErr = validatePathFlags(parsed.exe, parsed.args, cwd);
  if (flagErr) return { ok: false, output: '', error: flagErr };

  // node/python 文件参数校验
  const fileErr = validateFileArgs(parsed.exe, parsed.args, cwd);
  if (fileErr) return { ok: false, output: '', error: fileErr };

  const timeoutMs = args.timeoutMs ?? 30000;

  return new Promise<ToolResult>((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    let child;
    try {
      child = spawn(exeBase, parsed.args, {
        cwd,
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, output: '', error: errorMessage(err) });
      return;
    }

    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      // 清理 timer
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      try {
        if (!child.killed) child.kill();
      } catch { /* ignore */ }
      const durationMs = Date.now() - startedAt;
      const exitCode = child.exitCode ?? -1;
      const meta: ToolResultMeta & { outputTruncated?: boolean } = {
        kind: 'command',
        command: args.command,
        stdout,
        stderr,
        exitCode,
        durationMs,
      };
      if (stdoutTruncated || stderrTruncated) {
        meta.outputTruncated = true;
      }
      resolve({ ...result, meta });
    };

    child.stdout?.on('data', (data: Buffer) => {
      const s = data.toString();
      if (!stdoutTruncated) {
        stdout += s;
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... 输出超过 5MB 已截断 ...]';
          stdoutTruncated = true;
          try { if (!child.killed) child.kill(); } catch { /* ignore */ }
        }
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      const s = data.toString();
      if (!stderrTruncated) {
        stderr += s;
        if (stderr.length > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... 错误输出超过 5MB 已截断 ...]';
          stderrTruncated = true;
        }
      }
    });

    child.on('error', (err) => {
      finish({ ok: false, output: stdout + stderr, error: errorMessage(err) });
    });

    child.on('close', (code) => {
      const output = (stdout + stderr).slice(0, MAX_OUTPUT_BYTES);
      if (code === 0) {
        finish({ ok: true, output });
      } else {
        finish({ ok: false, output, error: `Exit code ${code ?? 'null'}` });
      }
    });

    // 超时（会由 finish 清理）
    timeoutTimer = setTimeout(() => {
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
        '执行一个命令（无 shell）。仅允许白名单命令：npm/npx/node/git/ls/cat/grep/find/rg/python/cargo/go/make/clang 等只读和开发工具（macOS 还支持 swift/xcrun/xcodebuild/brew/plutil/open/sqlite3）。已移除破坏性命令（del/rm/mv/cp/rmdir/move）。不支持管道/重定向/变量展开/脚本解释器（sh/bash/osascript）。路径参数必须在工作目录内。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令，单行，格式 "exe arg1 arg2 ..."' },
          timeoutMs: { type: 'number', description: '超时毫秒数（默认 30000）', minimum: 100, maximum: 300000 },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
];
