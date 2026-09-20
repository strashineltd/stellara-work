import { describe, expect, it } from 'vitest';
import { classifyVerificationCommand } from './verification-commands';

describe('classifyVerificationCommand', () => {
  const cases: Array<[string, 'test' | 'typecheck' | 'build' | null]> = [
    // test 家族
    ['npm test', 'test'],
    ['npm run test', 'test'],
    ['npm run test:unit', 'test'],
    ['pnpm test', 'test'],
    ['yarn test', 'test'],
    ['vitest run', 'test'],
    ['jest --ci', 'test'],
    ['pytest -q', 'test'],
    ['cargo test --features x', 'test'],
    ['go test ./...', 'test'],
    ['xcodebuild test -scheme App', 'test'],
    ['swift test', 'test'],
    ['mvn -q test', 'test'],
    // typecheck 家族
    ['tsc --noEmit', 'typecheck'],
    ['npm run typecheck', 'typecheck'],
    ['pnpm run lint', 'typecheck'],
    ['mypy src', 'typecheck'],
    ['pyright', 'typecheck'],
    ['cargo clippy', 'typecheck'],
    ['cargo check', 'typecheck'],
    ['go vet ./...', 'typecheck'],
    ['eslint .', 'typecheck'],
    ['ruff check', 'typecheck'],
    // build 家族
    ['npm run build', 'build'],
    ['cargo build', 'build'],
    ['go build ./...', 'build'],
    ['make', 'build'],
    ['cmake --build build', 'build'],
    ['gradle build', 'build'],
    ['mvn package', 'build'],
    ['xcodebuild build', 'build'],
    ['swift build', 'build'],
    // 非验证命令（不清理未验证文件）
    ['ls', null],
    ['true', null],
    ['git status', null],
    ['git commit -m "fix test"', null],
    ['echo test', null],
    ['cat package.json', null],
    ['npm install', null],
    ['npm run dev', null],
    ['npm run format', null],
    ['npm run lint:fix', null],
    ['cargo fmt', null],
    ['go mod tidy', null],
    // 执行模式加固：帮助/版本/清理/列举/配置不构成验证
    ['make --version', null],
    ['npm test --help', null],
    ['npm run build --if-present', null],
    ['tsc -v', null],
    ['cmake -E echo hello', null],
    ['cmake -S . -B build', null],
    ['make clean', null],
    ['swift package describe', null],
    ['mvn clean', null],
    ['gradle check', 'typecheck'],
    ['npm run "build"', 'build'],
    ['', null],
  ];

  it.each(cases)('%s → %s', (command, expected) => {
    expect(classifyVerificationCommand(command)).toBe(expected);
  });
});
