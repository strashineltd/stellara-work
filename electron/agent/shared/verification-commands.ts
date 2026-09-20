/**
 * 命令验证分级：判断一条命令是否构成"文件验证"及其类别。
 *
 * 只有 test / typecheck / build 家族的命令在成功后才清除未验证文件标记；
 * 其余命令（ls、git status、任意其它命令）不清理。匹配保持保守：
 * - 基于首个 token（可执行名）+ 子命令；`git commit -m "fix test"` 不会误判
 * - 帮助/版本/清理/列举/配置等不执行验证的调用一律不算（如 make --version、npm test --help）
 */
export type CommandVerificationKind = 'test' | 'typecheck' | 'build';

const TEST_TOOLS = new Set(['vitest', 'jest', 'pytest']);
const TYPECHECK_TOOLS = new Set(['tsc', 'mypy', 'pyright', 'eslint', 'ruff']);
const BUILD_TOOLS = new Set(['ninja', 'msbuild']);

const SCRIPT_KINDS: Array<{ re: RegExp; kind: CommandVerificationKind }> = [
  { re: /(^|:)test($|:)/, kind: 'test' },
  { re: /(^|:)(typecheck|type-check|lint|check)($|:)/, kind: 'typecheck' },
  { re: /(^|:)build($|:)/, kind: 'build' },
];

/** 帮助/版本旗标：出现即没有执行任何验证 */
const NON_VERIFICATION_FLAGS = new Set(['--help', '-h', '--version', '-V']);

function normalizeToken(token: string): string {
  return token.replace(/^["']|["']$/g, '');
}

function hasNonVerificationFlag(args: string[], extra: readonly string[] = []): boolean {
  for (const arg of args) {
    if (NON_VERIFICATION_FLAGS.has(arg) || extra.includes(arg)) return true;
  }
  return false;
}

function baseName(token: string): string {
  return token.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/, '');
}

/** 取首个非旗标 token 作为子命令查表；不是已知子命令则放弃（避免误判） */
function subcommandKind(
  args: string[],
  map: Record<string, CommandVerificationKind>,
): CommandVerificationKind | null {
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    return map[arg] ?? null;
  }
  return null;
}

function scriptKind(script: string): CommandVerificationKind | null {
  // 会改文件的脚本（lint:fix 等）不构成验证
  if (script.includes('fix')) return null;
  for (const { re, kind } of SCRIPT_KINDS) {
    if (re.test(script)) return kind;
  }
  return null;
}

export function classifyVerificationCommand(command: string): CommandVerificationKind | null {
  const tokens = command
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeToken);
  if (tokens.length === 0) return null;
  const exe = baseName(tokens[0]!);
  const args = tokens.slice(1);

  if (exe === 'npm' || exe === 'pnpm' || exe === 'yarn') {
    if (hasNonVerificationFlag(args, ['--if-present'])) return null;
    const script = args[0] === 'run' ? args[1] : args[0];
    if (!script || script.startsWith('-')) return null;
    return scriptKind(script);
  }
  if (TEST_TOOLS.has(exe)) {
    return hasNonVerificationFlag(args) ? null : 'test';
  }
  if (TYPECHECK_TOOLS.has(exe)) {
    // tsc -v 是版本查询，不是类型检查
    return hasNonVerificationFlag(args, exe === 'tsc' ? ['-v'] : []) ? null : 'typecheck';
  }
  if (BUILD_TOOLS.has(exe)) {
    return hasNonVerificationFlag(args) ? null : 'build';
  }
  if (exe === 'cmake') {
    if (hasNonVerificationFlag(args) || args.includes('-e')) return null;
    return args.includes('--build') ? 'build' : null;
  }
  if (exe === 'make') {
    if (hasNonVerificationFlag(args)) return null;
    const target = args.find((arg) => !arg.startsWith('-'));
    if (target === undefined) return 'build';
    if (target === 'test') return 'test';
    if (target === 'build') return 'build';
    return null;
  }
  if (exe === 'cargo') {
    return hasNonVerificationFlag(args)
      ? null
      : subcommandKind(args, { test: 'test', build: 'build', check: 'typecheck', clippy: 'typecheck' });
  }
  if (exe === 'go') {
    return hasNonVerificationFlag(args)
      ? null
      : subcommandKind(args, { test: 'test', build: 'build', vet: 'typecheck' });
  }
  if (exe === 'gradle') {
    return hasNonVerificationFlag(args)
      ? null
      : subcommandKind(args, { test: 'test', build: 'build', check: 'typecheck' });
  }
  if (exe === 'mvn') {
    return hasNonVerificationFlag(args)
      ? null
      : subcommandKind(args, {
          test: 'test',
          build: 'build',
          package: 'build',
          install: 'build',
          verify: 'build',
          compile: 'build',
        });
  }
  if (exe === 'swift' || exe === 'dotnet') {
    return hasNonVerificationFlag(args) ? null : subcommandKind(args, { test: 'test', build: 'build' });
  }
  if (exe === 'xcodebuild') {
    if (hasNonVerificationFlag(args)) return null;
    if (args.includes('test')) return 'test';
    if (args.includes('build')) return 'build';
    return null;
  }

  return null;
}
