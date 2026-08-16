# Contributing · 贡献指南

Thanks for your interest in Stellara Work! This document covers how to set up the project, run tests, and submit changes.

欢迎为 Stellara Work 贡献代码。以下是环境搭建、测试与提交流程说明。

## Development Setup · 环境搭建

### Prerequisites

- Node.js 20+
- Windows: Python 3.x + Visual Studio Build Tools (Desktop development with C++) — only needed for the first `npm install` of the native `better-sqlite3` module
- macOS / Linux: no extra tooling needed (`better-sqlite3` ships prebuilt binaries)

### Install & run

```bash
npm install
npm run dev
```

`npm run dev` starts Vite (renderer, HMR) and Electron (main process) together. On first launch, the onboarding flow asks for your model provider and API key.

## Project layout · 目录结构

| Path | Purpose |
|---|---|
| `electron/` | Electron main process: agent loop, tools, LLM client, storage, config |
| `src/` | React renderer: UI components, styles, hooks |
| `shared/` | IPC contract shared by both processes |
| `scripts/` | Build / verification scripts |
| `assets/` | Icons, packaging resources |

## Testing · 测试

```bash
npm test            # full test suite (vitest)
npm run typecheck   # type check main + renderer
npm run verify:w1   # W1 acceptance script (backend agent loop, no Electron)
```

We use **vitest** with jsdom for renderer tests. Every pull request should:

1. Pass `npm run typecheck`
2. Pass `npm test`
3. Cover new behavior with tests (look at `*.test.ts(x)` files next to the code)

## Committing · 提交

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): description
fix(scope): description
docs(scope): description
test(scope): description
```

## Pull Requests · 提交流程

1. Fork the repo and create a branch (`git checkout -b feat/your-feature`)
2. Make your changes with tests
3. Run `npm run typecheck && npm test` and make sure everything is green
4. Open a PR against `main` with a clear description of what and why

## Coding conventions · 代码规范

- TypeScript throughout (both processes), strict mode
- No `any` unless absolutely necessary
- IPC surface lives in `shared/ipc.ts` — keep the contract typed and minimal
- Design tokens in `src/styles/` — don't hardcode colors in components
- UI text: prefer Chinese first with English nearby for bilingual UI

## Security · 安全

This is a security-sensitive project (agent executes shell commands). When touching the agent loop, tools, or IPC:

- Never expose key material to the renderer
- Keep the approval gate for file writes and shell commands
- Sanitize and validate all user-supplied paths and commands
