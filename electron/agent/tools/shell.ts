import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RunCommandArgs, ToolResult, OpenAITool, ToolResultMeta } from '../../../shared/ipc';
import { isWithinDir, canonicalCwd, verifyExistingPath, verifyWritePath } from '../../fs/path-security';
import { checkUrlDestination } from '../../security/net-policy';

/**
 * 命令白名单（安全子集）。
 *
 * 结构性收敛：
 * - 移除解释器/运行时（node/python/sh/bash/zsh/ruby/perl/bun/deno/npx…）——
 *   一行命令即可执行任意代码，任何参数启发式都无法约束；
 * - 移除裸网络工具（curl/wget/nc/ncat/ssh/scp/rsync/ftp/telnet/sqlite3）——
 *   网络出口统一走受控的 web_fetch / 浏览器工具（含 SSRF 校验）；
 * - 仍移除破坏性命令（del, rmdir, move, ren, copy, attrib, rm, mv, cp）。
 *
 * 保留的开发工具（npm/git/cargo/go/make/…）另受子命令白名单约束（见 SUBCOMMAND_ALLOWLIST）。
 * 不包含 Windows cmd 内建命令（echo, dir, type, cd, md, rd）。
 */
const ALLOWED_COMMANDS_WIN = new Set([
  // 包管理 / 构建（子命令受限）
  'npm', 'pnpm', 'yarn',
  // 版本控制
  'git',
  // 只读文件操作
  'where', 'findstr',
  // 系统信息（只读）
  'whoami', 'systeminfo', 'tasklist', 'ver', 'hostname',
  // 开发 / 构建工具
  'pip', 'cargo', 'rustc', 'go', 'java', 'javac', 'gradle', 'mvn',
]);

const ALLOWED_COMMANDS_POSIX = new Set([
  'npm', 'pnpm', 'yarn',
  'git',
  // 只读文件操作
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'rg',
  'pwd', 'whoami', 'uname', 'which', 'true', 'false', 'test',
  // 开发 / 构建工具
  'pip', 'pip3', 'cargo', 'rustc', 'go', 'java', 'javac', 'gradle', 'mvn',
  // 文本处理（只读）
  'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'diff',
  // macOS / Linux 构建链
  'make', 'cmake', 'ninja', 'clang', 'clang++', 'cc', 'gcc', 'g++',
  // macOS 专属开发命令
  'swift', 'swiftc', 'swiftformat', 'swiftlint', 'xcrun', 'xcodebuild', 'brew',
  'plutil', 'mdls',
  // macOS 系统信息（只读）
  'sw_vers', 'sysctl', 'defaults', 'diskutil',
  // 只读系统信息（POSIX / macOS）
  'stat', 'du', 'df', 'file',
]);

/**
 * 子命令白名单（按 executable basename）。
 * 结构性约束：第一个参数必须是子命令（不允许任何前置旗标），
 * 唯一例外是“单独一个” safe no-op 旗标（版本/帮助查询）。
 * 未列出的 executable（ls/cat/grep/make/cmake 等）不要求子命令。
 */
const PACKAGE_MANAGER_SUBCOMMANDS = [
  'install', 'i', 'ci', 'run', 'test', 't', 'build', 'lint', 'typecheck', 'format', 'outdated', 'audit',
];

const SUBCOMMAND_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  git: new Set([
    'status', 'diff', 'log', 'show', 'branch', 'add', 'commit', 'checkout', 'switch',
    'restore', 'stash', 'pull', 'push', 'fetch', 'merge', 'rebase', 'cherry-pick',
    'tag', 'remote', 'rev-parse', 'ls-files', 'rev-list', 'describe', 'config',
    'blame', 'grep', 'clean', 'init', 'clone',
  ]),
  npm: new Set(PACKAGE_MANAGER_SUBCOMMANDS),
  pnpm: new Set(PACKAGE_MANAGER_SUBCOMMANDS),
  yarn: new Set(PACKAGE_MANAGER_SUBCOMMANDS),
  pip: new Set(['install', 'list', 'show', 'freeze']),
  pip3: new Set(['install', 'list', 'show', 'freeze']),
  cargo: new Set(['build', 'test', 'check', 'clippy', 'fmt', 'run', 'bench', 'doc']),
  go: new Set(['build', 'test', 'run', 'vet', 'fmt', 'mod', 'list', 'env']),
  xcodebuild: new Set(['build', 'test', 'clean', 'run', 'package', 'install', 'verify', 'check']),
  gradle: new Set(['build', 'test', 'clean', 'run', 'package', 'install', 'verify', 'check']),
  mvn: new Set(['build', 'test', 'clean', 'run', 'package', 'install', 'verify', 'check']),
  swift: new Set(['build', 'test', 'clean', 'run', 'package', 'install', 'verify', 'check']),
};

/** 通用 safe form：版本/帮助查询。仅当它是唯一参数时免子命令检查；不包含 -v（与 pip/cargo 的 -v 语义冲突）。 */
const SAFE_NOOP_FLAGS = new Set(['--version', '-V', '-h', '--help']);

/** git config 只读查询旗标（其余带赋值的写法一律拒绝） */
const GIT_CONFIG_READ_FLAGS = new Set(['-l', '--list']);

/** git config 显式写操作旗标（--get/--list/-l 之外的写路径全部拒绝） */
const GIT_CONFIG_WRITE_FLAGS = new Set([
  '--add', '--replace-all', '--unset', '--unset-all', '--rename-section', '--remove-section', '--edit', '-e',
]);

function allowedCommands(): Set<string> {
  return process.platform === 'win32' ? ALLOWED_COMMANDS_WIN : ALLOWED_COMMANDS_POSIX;
}

const COMPILER_PATH_FLAGS = new Set([
  '-o', '--output', '-I', '-L', '-include', '-isystem', '-imacros', '-idirafter', '-iquote',
]);

const PIP_PATH_FLAGS = new Set([
  '-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-t', '--target',
  '--log', '--cache-dir',
]);

/**
 * 带路径语义的 flag 定义。
 * key: 命令名（basename，小写）
 * value: 该命令取值代表路径的 flag 集合（值可能是 `@file` / `key=@file` 形式，见
 *        pathValueCandidates）。
 *
 * 未列出的 `-`/`--` 参数由 validatePathFlags 的 fail-closed 规则兜底：
 * 只要旗标自身携带 `/`、`\`、`..` 或绝对路径，就按超出工作目录拒绝。
 */
const PATH_FLAGS: Record<string, Set<string>> = {
  git: new Set(['-C', '--work-tree', '--git-dir', '--exec-path', '--output']),
  npm: new Set(['--prefix', '-C', '--userconfig', '--globalconfig', '--cache']),
  pnpm: new Set(['--prefix', '-C', '--dir', '--cwd', '--store-dir', '--state-dir', '--modules-dir', '--global-dir']),
  yarn: new Set(['--cwd', '--prefix', '--modules-folder', '--cache-folder', '--global-folder', '--use-yarnrc']),
  pip: PIP_PATH_FLAGS,
  pip3: PIP_PATH_FLAGS,
  make: new Set(['-C', '--directory', '-f', '--file', '--makefile', '-I', '--include-dir']),
  cmake: new Set(['-S', '-B', '-C', '--source', '--build', '--install']),
  ninja: new Set(['-C', '-f']),
  rustc: new Set(['-o', '--out-dir', '-L', '--extern']),
  cargo: new Set(['--manifest-path', '--target-dir']),
  go: new Set(['-C', '-modfile', '-o']),
  swift: new Set(['--package-path', '--scratch-path', '--cache-path', '--config-path', '--security-path']),
  swiftc: new Set(['-o', '-I', '-L', '-module-cache-path']),
  clang: COMPILER_PATH_FLAGS,
  'clang++': COMPILER_PATH_FLAGS,
  cc: COMPILER_PATH_FLAGS,
  gcc: COMPILER_PATH_FLAGS,
  'g++': COMPILER_PATH_FLAGS,
  xcodebuild: new Set([
    '-project', '-workspace', '-derivedDataPath', '-resultBundlePath', '-archivePath',
    '-exportPath', '-clonedSourcePackagesDirPath', '-xcconfig',
  ]),
  javac: new Set(['-d', '-cp', '-classpath', '-sourcepath', '--module-path', '--class-path', '-h']),
  java: new Set(['-cp', '-classpath', '--class-path', '--module-path', '-jar']),
  gradle: new Set(['-p', '--project-dir', '-g', '--gradle-user-home', '--project-cache-dir', '-I', '--init-script']),
  mvn: new Set(['-f', '--file', '-s', '--settings', '-gs', '--global-settings']),
  grep: new Set(['-f', '--file']),
  rg: new Set(['-f', '--file']),
  awk: new Set(['-f', '--file']),
  sed: new Set(['-f', '--file']),
  sort: new Set(['-o', '--output']),
  file: new Set(['-f', '--files-from']),
  find: new Set(['-fprint', '-fprint0', '-fprintf', '-fls']),
  plutil: new Set(['-o', '--output']),
  diff: new Set(['--from-file', '--to-file']),
};

/**
 * 已知“取值不是文件路径”的旗标白名单（按命令）。
 * 这些旗标的取值常含 `/`、`..` 或 `@`（如 header/referer/glob/format），
 * 但语义上是字符串/正则/构建变量，不应按路径 fail-closed 拒绝。
 * attached: 允许 `--flag=value` / 短选项贴值 `-Xvalue` 形式。
 * 注意：与 PATH_FLAGS 冲突时以 PATH_FLAGS 为准（先匹配路径旗标）。
 */
interface NonPathFlagSpec {
  flag: string;
  attached?: boolean;
}

const NON_PATH_FLAGS: Record<string, NonPathFlagSpec[]> = {
  git: [
    { flag: '--grep', attached: true },
    { flag: '-S', attached: true },
    { flag: '--pretty', attached: true },
    { flag: '--format', attached: true },
  ],
  rg: [
    { flag: '--glob', attached: true },
    { flag: '--iglob', attached: true },
  ],
  grep: [
    { flag: '--exclude', attached: true },
    { flag: '--include', attached: true },
  ],
  cmake: [{ flag: '-D', attached: true }],
};

function matchesNonPathFlag(arg: string, specs: NonPathFlagSpec[] | undefined): boolean {
  if (!specs) return false;
  for (const spec of specs) {
    if (arg === spec.flag) return true;
    if (!spec.attached) continue;
    if (arg.startsWith(spec.flag + '=')) return true;
    if (!spec.flag.startsWith('--') && arg.startsWith(spec.flag) && arg.length > spec.flag.length) {
      return true;
    }
  }
  return false;
}

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
 * Windows 盘符相对路径（如 `C:foo`）：
 * 不是绝对路径，但在 Windows 上相对于该盘符的当前目录解析，必须一并拒绝。
 */
export function isDriveRelativePathArg(p: string): boolean {
  return /^[a-zA-Z]:(?![\\/])/.test(p);
}

/**
 * 校验路径值是否真正落在 root 工作目录内：
 * - 盘符相对路径拒绝
 * - 绝对路径拒绝
 * - 用 realpath 感知的 verifyWritePath 做包含判断（防 symlink/junction 与前缀同名绕过）
 * 返回 null 表示 OK，否则返回错误文案。
 */
async function validateContainedPath(
  value: string,
  baseDir: string,
  root: string,
  label: string,
): Promise<string | null> {
  if (isDriveRelativePathArg(value)) {
    return `${label} "${value}" 是 Windows 盘符相对路径，不允许。请使用工作目录内的相对路径。`;
  }
  if (isAbsolutePathArg(value)) {
    return `${label} "${value}" 是绝对路径，不允许。请使用相对路径。`;
  }
  const resolved = path.resolve(baseDir, value);
  const checked = await verifyWritePath(resolved, root);
  if (!checked.ok) {
    return `${label} "${value}" 超出工作目录。`;
  }
  return null;
}

/**
 * 提取 token 中 `@` 之后的候选路径（`@/abs`、`name@/abs`、`-d@/abs` 等）。
 * 编译器 response file 等以 @ 引入路径，需按路径语义复核。
 */
function atPathCandidates(token: string): string[] {
  const out: string[] = [];
  let idx = token.indexOf('@');
  while (idx !== -1 && idx < token.length - 1) {
    out.push(token.slice(idx + 1));
    idx = token.indexOf('@', idx + 1);
  }
  return out;
}

/**
 * 校验路径参数是否在工作目录内。
 * 拒绝盘符相对/绝对路径、`..` 越界、symlink 逃逸与原前缀同名的兄弟路径。
 * 返回 null 表示 OK，返回字符串表示错误。
 */
async function validatePathArg(arg: string, baseDir: string, root: string): Promise<string | null> {
  // 跳过 flag（--xxx, -x）—— 除非它是带路径语义的 flag，由 validatePathFlags 处理；
  // flag 中内嵌的 `@`/路径由 flagTokenLooksLikePath 兜底。
  if (arg.startsWith('-')) return null;

  // @ 之后的候选（@/etc、name@/etc）一律按路径复核，防止 response file / 数据文件读取。
  for (const candidate of atPathCandidates(arg)) {
    const err = await validateContainedPath(candidate, baseDir, root, '路径参数');
    if (err) return err;
  }

  // 跳过不含路径分隔符且不含 .. 的纯文本参数（如 commit message）
  if (
    !arg.includes('/') &&
    !arg.includes('\\') &&
    !arg.includes('..') &&
    !isDriveRelativePathArg(arg)
  ) {
    // 单 token：既可能是纯文本参数（如 commit message），也可能是文件/链接名。
    // 若它实际存在于 cwd 内，按真实路径复核，防止 `evil -> /etc/passwd` 之类的链接逃逸；
    // 不存在则保持放行（build/test 之类的非文件词）。
    const resolved = path.resolve(baseDir, arg);
    try {
      await fs.lstat(resolved);
    } catch {
      return null;
    }
    const checked = await verifyExistingPath(resolved, baseDir);
    if (!checked.ok) {
      return `路径参数 "${arg}" 超出工作目录。`;
    }
    return null;
  }
  return validateContainedPath(arg, baseDir, root, '路径参数');
}

/**
 * 已知路径旗标的值可能是直接路径，也可能带 `@`（`-f @file`）或 `key=value`
 * （-F name=@file / --extern name=path）。逐个候选校验，任一候选越界即拒绝，
 * 避免剥离前缀后漏掉绝对路径（如 `-o /tmp/x=y`）。
 */
function pathValueCandidates(value: string): string[] {
  const candidates = [value];
  candidates.push(...atPathCandidates(value));
  const eqIndex = value.indexOf('=');
  if (eqIndex !== -1) candidates.push(value.slice(eqIndex + 1));
  return candidates;
}

/** 未知旗标自身携带路径的判定（fail-closed）：含分隔符 / 上级引用 / 绝对路径 / @ 路径。 */
function flagTokenLooksLikePath(token: string): boolean {
  if (
    token.includes('/') ||
    token.includes('\\') ||
    token.includes('..') ||
    isAbsolutePathArg(token)
  ) {
    return true;
  }
  return atPathCandidates(token).some(
    (candidate) =>
      isAbsolutePathArg(candidate) ||
      isDriveRelativePathArg(candidate) ||
      candidate.includes('..'),
  );
}

/**
 * 校验所有 `-`/`--` 参数：
 * - 已知路径旗标（PATH_FLAGS）的取值按路径校验，覆盖 `--flag value`、
 *   `--flag=value`、短选项贴值（`-Cvalue`）与 `@`/`key=value` 形式；
 * - 未知旗标若自身携带路径，则无法确认其指向工作目录内，按超出工作目录拒绝；
 * - 纯布尔旗标（`-l`、`--verbose`）保持放行。
 */
async function validatePathFlags(
  exe: string,
  args: string[],
  baseDir: string,
  root: string,
): Promise<string | null> {
  const exeBase = path.basename(exe).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  const pathFlags = PATH_FLAGS[exeBase];
  const nonPathFlags = NON_PATH_FLAGS[exeBase];

  const check = async (flag: string, value: string): Promise<string | null> =>
    validateContainedPath(value, baseDir, root, `命令 ${exeBase} 的 ${flag} 参数`);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('-')) continue;

    let matchedFlag: string | null = null;
    let matchedValue: string | undefined;
    if (pathFlags) {
      for (const flag of pathFlags) {
        if (arg === flag) {
          matchedFlag = flag;
          matchedValue = args[i + 1];
          break;
        }
        if (arg.startsWith(flag + '=')) {
          matchedFlag = flag;
          matchedValue = arg.slice(flag.length + 1);
          break;
        }
        if (!flag.startsWith('--') && arg.startsWith(flag) && arg.length > flag.length) {
          // 短选项贴值：git -C../dir
          matchedFlag = flag;
          matchedValue = arg.slice(flag.length);
          break;
        }
      }
    }

    if (matchedFlag !== null) {
      if (matchedValue !== undefined && matchedValue !== '') {
        for (const candidate of pathValueCandidates(matchedValue)) {
          const err = await check(matchedFlag, candidate);
          if (err) return err;
        }
      }
      continue;
    }

    if (matchesNonPathFlag(arg, nonPathFlags)) continue;

    if (flagTokenLooksLikePath(arg)) {
      return `命令 ${exeBase} 的参数 "${arg}" 含路径，已按超出工作目录拒绝。`;
    }
  }
  return null;
}

const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/+/i;
const ALLOWED_URL_SCHEMES_RE = /^https?$/i;

function findDisallowedUrlScheme(args: string[]): string | null {
  for (const arg of args) {
    const scheme = URL_SCHEME_RE.exec(arg)?.[1];
    if (scheme && !ALLOWED_URL_SCHEMES_RE.test(scheme)) return arg;
  }
  return null;
}

/**
 * 工具级显式拒绝（fail-closed）：无法安全解析其内容、且会读取任意文件或注入可执行配置的旗标。
 * - git -c/--config/--config-env：注入 core.fsmonitor / credential.helper / diff.external 等可执行配置
 * - git --upload-pack/-u/--receive-pack：指定远端执行的程序（等价任意命令执行）
 * - find -exec/-execdir/-ok/-okdir：find 自行 execvp，绕过 executable 白名单
 * - cmake -D：取值可能指向工具链/预加载脚本（绝对路径或 .. 一律拒绝）
 * 返回错误文案，null 表示通过。
 */
function findForbiddenToolArg(exeBase: string, args: string[]): string | null {
  if (exeBase === 'git') {
    // clone/fetch/pull 的短选项 -u 是 --upload-pack（可贴值 -u/bin/sh）；其余子命令的 -u 无此语义
    const sub = args[0];
    const shortUploadPack = sub === 'clone' || sub === 'fetch' || sub === 'pull';
    for (const arg of args) {
      if (arg === '-c' || (arg.startsWith('-c') && !arg.startsWith('--'))) {
        return '不允许：git -c 可注入可执行配置（请使用专用 git 工具）。';
      }
      if (arg === '--config' || arg.startsWith('--config=')) {
        return '不允许：git --config 可注入可执行配置（请使用专用 git 工具）。';
      }
      if (arg === '--config-env' || arg.startsWith('--config-env=')) {
        return '不允许：git --config-env 可注入可执行配置（请使用专用 git 工具）。';
      }
      if (
        arg === '--upload-pack' ||
        arg.startsWith('--upload-pack=') ||
        arg === '-u' ||
        (shortUploadPack && arg.startsWith('-u') && !arg.startsWith('--'))
      ) {
        return '不允许：git -u/--upload-pack 可指定远端执行的程序。';
      }
      if (arg === '--receive-pack' || arg.startsWith('--receive-pack=')) {
        return '不允许：git --receive-pack 可指定远端执行的程序。';
      }
    }
  }
  if (exeBase === 'find') {
    for (const arg of args) {
      if (arg === '-exec' || arg === '-execdir' || arg === '-ok' || arg === '-okdir') {
        return '不允许：find -exec/-execdir/-ok/-okdir 会执行外部命令。';
      }
    }
  }
  if (exeBase === 'cmake') {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      let value: string | undefined;
      if (arg === '-D') {
        value = args[i + 1];
      } else if (arg.startsWith('-D') && !arg.startsWith('--')) {
        value = arg.slice(2);
      }
      if (value === undefined || value === '') continue;
      const eq = value.indexOf('=');
      const target = eq === -1 ? value : value.slice(eq + 1);
      if (
        isAbsolutePathArg(target) ||
        isDriveRelativePathArg(target) ||
        target.includes('..') ||
        target.includes('\\')
      ) {
        return `不允许：cmake -D 取值包含工作目录外的路径（${value}）。`;
      }
    }
  }
  return null;
}

/**
 * git config 只读约束：仅允许查询（显式 --get/--list/-l，或无赋值的单 key 读取），
 * 带值赋值与已知写旗标（--add/--unset/--edit…）一律拒绝。
 */
function gitConfigWriteError(args: string[]): string | null {
  const configIndex = args.indexOf('config');
  const rest = configIndex === -1 ? args : args.slice(configIndex + 1);
  if (rest.some((a) => GIT_CONFIG_READ_FLAGS.has(a) || a.startsWith('--get'))) return null;
  if (rest.some((a) => GIT_CONFIG_WRITE_FLAGS.has(a))) {
    return '不允许：git config 仅允许只读查询（--get/--list/-l）。';
  }
  const nonFlags = rest.filter((a) => !a.startsWith('-'));
  if (nonFlags.length >= 2) {
    return '不允许：git config 仅允许只读查询（--get/--list/-l）。';
  }
  return null;
}

/**
 * 子命令白名单（严格位置）：
 * - 第一个参数必须是子命令，不允许任何前置旗标（`+toolchain` 之类前缀同样拒绝）；
 * - 唯一例外：参数恰好一个且为 safe no-op 旗标（--version/-V/-h/--help）；
 * - 未列出的子命令拒绝。
 * 子命令定位不做任何“跳过旗标取值”的猜测，避免 `npm --tag install exec x` 之类的走私。
 */
function subcommandError(exeBase: string, args: string[]): string | null {
  const allowed = SUBCOMMAND_ALLOWLIST[exeBase];
  if (!allowed) return null;
  if (args.length === 0) return null;
  const first = args[0]!;
  if (args.length === 1 && SAFE_NOOP_FLAGS.has(first)) return null;
  if (first.startsWith('-') || first.startsWith('+')) return '子命令必须是第一个参数';
  if (!allowed.has(first)) return `未允许的子命令：${exeBase} ${first}`;
  if (exeBase === 'git' && first === 'config') return gitConfigWriteError(args);
  return null;
}

const HTTP_URL_RE = /^https?:\/\//i;

/** 从参数中提取 http(s) URL（本身是 URL，或 `--flag=http://...` 形式的取值）。 */
function httpUrlCandidate(arg: string): string | null {
  if (HTTP_URL_RE.test(arg)) return arg;
  if (arg.startsWith('-')) {
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      const value = arg.slice(eq + 1);
      if (HTTP_URL_RE.test(value)) return value;
    }
  }
  return null;
}

/** 允许显式远端地址的 git 子命令 */
const GIT_REMOTE_SUBCOMMANDS = new Set(['clone', 'fetch', 'pull', 'push']);

/**
 * git 远端地址策略：clone/fetch/pull/push 的非旗标参数不允许 scp-like
 * （git@host:path、host:path）与 http(s) 之外的 scheme（file://、ssh://、git://…），
 * 仅 http(s) URL（随后做 SSRF 校验）与工作目录内路径/远端名可通过。
 * 对含 `:` 的 refspec（如 HEAD:main）一并拒绝（fail-closed）。
 */
function gitRemoteAddressError(exeBase: string, args: string[]): string | null {
  if (exeBase !== 'git') return null;
  const sub = args[0];
  if (sub === undefined || !GIT_REMOTE_SUBCOMMANDS.has(sub)) return null;
  for (const arg of args.slice(1)) {
    if (arg.startsWith('-')) continue;
    if (HTTP_URL_RE.test(arg)) continue;
    if (arg.includes(':')) return `不允许的远端地址：${arg}`;
  }
  return null;
}

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * git 子进程会按其取值执行外部程序的变量（精确名）：
 * SSH/askpass/proxy/diff/editor 均可指向任意程序，等价于任意命令执行。
 */
const GIT_EXEC_ENV_KEYS = new Set([
  'GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PROXY_COMMAND',
  'GIT_EXTERNAL_DIFF', 'GIT_SEQUENCE_EDITOR', 'GIT_EDITOR', 'GIT_MERGE_AUTOEDIT', 'GIT_PAGER',
]);

/**
 * 不允许被模型覆盖的关键环境变量：
 * 这些变量影响命令查找、语言环境、身份等，覆盖可能导致越权或提权。
 * GIT_EXEC_ENV_KEYS 指定的变量会让 git 执行任意程序。
 */
const FORBIDDEN_ENV_KEYS = new Set([
  'PATH', 'HOME', 'HOST', 'OSTYPE', 'TERM', 'SHELL', 'USER', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PWD', 'LOGNAME',
  ...GIT_EXEC_ENV_KEYS,
]);

/**
 * 禁止下传/覆盖的环境变量：
 * - FORBIDDEN_ENV_KEYS 固定名单；
 * - 所有 `GIT_CONFIG*`（COUNT/KEY_0/VALUE_0/PARAMETERS/GLOBAL/SYSTEM…）——
 *   均可注入 core.fsmonitor / credential.helper 等可执行配置，等价于 git -c；
 * - 所有 `GIT_SSH*`（COMMAND/VARIANT…）。
 */
export function isForbiddenEnvKey(key: string): boolean {
  if (key.startsWith('GIT_CONFIG') || key.startsWith('GIT_SSH')) return true;
  return FORBIDDEN_ENV_KEYS.has(key);
}

/**
 * buildChildEnv 从宿主环境（base）额外屏蔽的 git 注入键：
 * PATH/HOME 等只是“禁止模型覆盖”，仍需从宿主环境下传；而 GIT_CONFIG* /
 * GIT_SSH* / GIT_EXTERNAL_DIFF / GIT_PAGER 等是注入可执行配置的通道，宿主环境也不下传。
 * 注意：仅用于 base（宿主）循环；受信任的内部调用方可通过 extra 显式设置
 * `GIT_PAGER=cat` 等加固值（git 工具），模型侧 extra 已被 sanitizeEnv 拒绝。
 */
function isChildEnvDeniedKey(key: string): boolean {
  return key.startsWith('GIT_CONFIG') || key.startsWith('GIT_SSH') || GIT_EXEC_ENV_KEYS.has(key);
}

/** 环境变量键名：仅允许 C 风格标识符（不能以数字开头） */
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MAX_ENV_VARS = 10;

/**
 * 解析并校验 cwd 参数：
 * - undefined/空 → 工作目录根
 * - 绝对路径 → 拒绝（返回 null）
 * - 解析后越出工作目录（.. 越界） → 拒绝（返回 null）
 * - realpath 后越出工作目录（symlink 逃逸） → 拒绝（返回 null）
 * 成功返回规范化后的绝对路径。
 */
async function validateCwdArg(cwd: string | undefined, root: string): Promise<string | null> {
  if (cwd === undefined || cwd === '') return path.normalize(root);
  if (isAbsolutePathArg(cwd)) return null;
  const resolved = path.resolve(root, cwd);
  if (!isWithinDir(resolved, root)) return null;
  const realResolved = await canonicalCwd(resolved);
  const realRoot = await canonicalCwd(root);
  if (!isWithinDir(realResolved, realRoot)) return null;
  return resolved;
}

/**
 * 校验并过滤额外环境变量：
 * - 键名必须匹配 ^[A-Za-z_][A-Za-z0-9_]*$（最多 10 个）
 * - 禁止覆盖 FORBIDDEN_ENV_KEYS
 */
function sanitizeEnv(
  env: Record<string, string> | undefined,
): { ok: true; env: Record<string, string> } | { ok: false; error: string } {
  if (env === undefined) return { ok: true, env: {} };
  const keys = Object.keys(env);
  if (keys.length > MAX_ENV_VARS) {
    return { ok: false, error: `env 变量数量超过限制（最多 ${MAX_ENV_VARS} 个）。` };
  }
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_REGEX.test(k)) {
      return { ok: false, error: `env 键名 "${k}" 不合法（仅允许 A-Za-z0-9_，且不能以数字开头）。` };
    }
    if (isForbiddenEnvKey(k)) {
      return { ok: false, error: `不允许覆盖关键环境变量：${k}。` };
    }
    safe[k] = v;
  }
  return { ok: true, env: safe };
}

/**
 * 子进程环境变量最小白名单（H5）：
 * 只保留命令运行所需的操作性变量。process.env 里的 STELLARA_*（模型密钥 /
 * 服务器密码 / 云 token）与 * _TOKEN/_SECRET/_PASSWORD/_API_KEY 一律不下传，
 * 避免 npm 生命周期脚本等子进程转储实时密钥。
 */
const CHILD_ENV_ALLOWLIST: ReadonlySet<string> = (() => {
  const keys = ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'TERM', 'TZ'];
  if (process.platform === 'win32') {
    keys.push(
      'Path', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'COMSPEC', 'ComSpec',
      'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
      'TEMP', 'TMP',
    );
  }
  return new Set(keys);
})();

/** 明显的密钥型键名模式 */
const SECRET_ENV_PATTERNS = [/_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i, /_API_KEY$/i];

/** 判定一个环境变量键是否携带密钥/凭据（不下传给子进程） */
export function isSecretEnvKey(key: string): boolean {
  if (key.startsWith('STELLARA_')) return true;
  return SECRET_ENV_PATTERNS.some((re) => re.test(key));
}

/**
 * 构造子进程环境：
 * - 从 base（默认 process.env）中只取操作性变量（见 CHILD_ENV_ALLOWLIST 与 LC_*）
 * - 剔除所有 STELLARA_* 与密钥型键名
 * - 叠加调用方显式要求的额外变量（同样过密钥过滤）
 */
export function buildChildEnv(
  extra: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (isSecretEnvKey(key) || isChildEnvDeniedKey(key)) continue;
    if (CHILD_ENV_ALLOWLIST.has(key) || key.startsWith('LC_')) out[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (isSecretEnvKey(key) || key.startsWith('GIT_CONFIG')) continue;
    out[key] = value;
  }
  return out;
}

/**
 * 跑 shell 命令（白名单 + no-shell + 路径约束）
 */
export async function runCommand(args: RunCommandArgs, cwd: string): Promise<ToolResult> {
  const parsed = parseCommand(args.command);
  if ('error' in parsed) {
    return { ok: false, output: '', error: parsed.error };
  }

  // cwd 校验：必须是工作目录内的相对子目录（含 symlink realpath 检查）
  const resolvedCwd = await validateCwdArg(args.cwd, cwd);
  if (resolvedCwd === null) {
    const reason =
      args.cwd !== undefined && isAbsolutePathArg(args.cwd)
        ? `cwd "${args.cwd}" 是绝对路径，不允许。请使用工作目录内的相对子目录。`
        : `cwd "${args.cwd}" 超出工作目录。`;
    return { ok: false, output: '', error: reason };
  }

  // env 校验：键名合法、数量 ≤ 10、禁止覆盖关键环境变量
  const safeEnv = sanitizeEnv(args.env);
  if (!safeEnv.ok) {
    return { ok: false, output: '', error: safeEnv.error };
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
      error: `命令不在白名单内：${parsed.exe}`,
    };
  }

  const forbiddenArg = findForbiddenToolArg(exeBase, parsed.args);
  if (forbiddenArg !== null) {
    return { ok: false, output: '', error: forbiddenArg };
  }

  // 子命令白名单：包管理/构建/版本控制命令只允许显式列出的子命令
  const subErr = subcommandError(exeBase, parsed.args);
  if (subErr !== null) {
    return { ok: false, output: '', error: subErr };
  }

  // git 远端地址策略：clone/fetch/pull/push 仅允许 http(s) URL 或工作目录内路径
  const remoteErr = gitRemoteAddressError(exeBase, parsed.args);
  if (remoteErr !== null) {
    return { ok: false, output: '', error: remoteErr };
  }

  const badSchemeArg = findDisallowedUrlScheme(parsed.args);
  if (badSchemeArg !== null) {
    return { ok: false, output: '', error: `不允许的 URL 协议：${badSchemeArg}。仅允许 http/https。` };
  }

  // URL 目标 SSRF 校验：http(s) URL 参数（含 --url= 形式）统一走共享私网/保留地址判定
  for (const arg of parsed.args) {
    const url = httpUrlCandidate(arg);
    if (url === null) continue;
    const destination = await checkUrlDestination(url);
    if (!destination.ok) {
      return { ok: false, output: '', error: `不允许访问私网/保留地址：${url}` };
    }
  }

  // 路径参数校验（通用：检测含路径分隔符的参数）
  for (const arg of parsed.args) {
    const err = await validatePathArg(arg, resolvedCwd, cwd);
    if (err) return { ok: false, output: '', error: err };
  }

  // 带路径语义的 flag 校验（git -C, npm --prefix 等）
  const flagErr = await validatePathFlags(parsed.exe, parsed.args, resolvedCwd, cwd);
  if (flagErr) return { ok: false, output: '', error: flagErr };

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
        cwd: resolvedCwd,
        env: buildChildEnv(safeEnv.env),
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
        '执行一条白名单命令（无 shell），用于包管理/构建/测试/版本控制：npm/pnpm/yarn（install/run/test/build 等子命令）、git（status/diff/log/commit/add 等子命令）、cargo/go/make/cmake/gradle/mvn/swift/clang 等构建工具，以及 ls/cat/grep/find/file 等只读文件命令。有子命令白名单的命令（npm/git/cargo/go/pip/swift/xcodebuild 等），第一个参数必须是子命令（仅可单独使用 --version/-V/-h/--help 查询版本/帮助）。解释器（node/python/sh/bash 等）与网络工具（curl/wget/ssh/scp 等）已整体移除：联网获取资源请用 web_fetch 或浏览器工具。npm install/npm run/cargo build 等会执行项目内代码（安装脚本、构建脚本、Makefile 等），属于需用户审批的敏感操作。不支持管道/重定向/变量展开；路径参数必须在工作目录内。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令，单行，格式 "exe arg1 arg2 ..."' },
          cwd: { type: 'string', description: '相对当前工作目录的子目录，命令在其中执行（绝对路径或 .. 越界将被拒绝）' },
          env: { type: 'object', description: '额外环境变量（键名仅允许 A-Za-z0-9_，最多 10 个，禁止覆盖 PATH/HOME 等关键变量）', additionalProperties: { type: 'string' } },
          timeoutMs: { type: 'number', description: '超时毫秒数（默认 30000）', minimum: 100, maximum: 300000 },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
];
