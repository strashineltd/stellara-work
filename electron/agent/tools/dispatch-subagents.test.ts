import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchSubagents, getSubagentRunner, setSubagentRunner } from './dispatch-subagents';
import type { SubagentRunner } from './dispatch-subagents';
import { allTools, invokeTool } from './index';
import type { DispatchSubagentsArgs, SubagentDef, ToolExecutionContext } from '../../../shared/ipc';

const sessionId = 'session-a';
const context: ToolExecutionContext = {
  sessionId,
  agentId: 'main',
  contextRevision: 1,
  workspaceRevision: 2,
  toolCallId: 'call-1',
};

function runnerFor(
  implementation: (defs: SubagentDef[]) => ReturnType<SubagentRunner['dispatch']> = async (defs) => ({
    results: defs.map((def) => ({ id: def.id, summary: `done: ${def.task}`, ok: true, elapsedMs: 1 })),
    conflicts: [],
    totalUsage: { promptTokens: 10, completionTokens: 5 },
  }),
): SubagentRunner {
  return { dispatch: vi.fn(implementation) };
}

afterEach(() => setSubagentRunner(sessionId, null));

describe('dispatchSubagents validation', () => {
  it('accepts only 1-10 definitions', async () => {
    expect((await dispatchSubagents({ subagents: [] }, '/work', context)).error).toContain('1-10');
    const defs = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, task: `t${i}`, role: 'research' as const }));
    expect((await dispatchSubagents({ subagents: defs }, '/work', context)).error).toContain('1-10');
  });

  it('rejects duplicate ids and incomplete definitions', async () => {
    expect((await dispatchSubagents({ subagents: [
      { id: 'a', task: 't1', role: 'research' },
      { id: 'a', task: 't2', role: 'verify' },
    ] }, '/work', context)).error).toContain('唯一');
    expect((await dispatchSubagents({ subagents: [{ id: '', task: 't1', role: 'research' }] }, '/work', context)).error).toContain('id');
    expect((await dispatchSubagents({ subagents: [{ id: 'a', task: ' ', role: 'research' }] }, '/work', context)).error).toContain('task');
  });

  it('requires file scopes for build agents', async () => {
    const result = await dispatchSubagents({ subagents: [{ id: 'build', task: 'edit', role: 'build' }] }, '/work', context);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('fileScopes');
  });

  it('requires a session context and a matching runner', async () => {
    expect((await dispatchSubagents({ subagents: [{ id: 'a', task: 't', role: 'research' }] }, '/work')).error).toContain('会话上下文');
    expect((await dispatchSubagents({ subagents: [{ id: 'a', task: 't', role: 'research' }] }, '/work', context)).error).toContain('未设置');
  });
});

describe('session-scoped dispatch', () => {
  it('passes definitions to the runner and formats role-aware results', async () => {
    const runner = runnerFor();
    setSubagentRunner(sessionId, runner);
    const defs: SubagentDef[] = [
      { id: 'research-1', task: 'inspect', role: 'research' },
      { id: 'verify-1', task: 'test', role: 'verify' },
    ];
    const result = await dispatchSubagents({ subagents: defs }, '/work', context);

    expect(runner.dispatch).toHaveBeenCalledWith(defs);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('2/2 成功');
    expect(result.output).toContain('research-1 · research · 完成');
  });

  it('reports failures and workspace conflicts', async () => {
    const runner = runnerFor(async () => ({
      results: [{ id: 'build-1', summary: 'failed', ok: false, elapsedMs: 2 }],
      conflicts: ['src/a.ts 与 src/a.ts 重叠'],
      totalUsage: { promptTokens: 1, completionTokens: 1 },
    }));
    setSubagentRunner(sessionId, runner);
    const result = await dispatchSubagents({ subagents: [{
      id: 'build-1', task: 'edit', role: 'build', fileScopes: ['src/a.ts'],
    }] }, '/work', context);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1 个子代理失败');
    expect(result.output).toContain('## 冲突');
  });

  it('keeps runners isolated by session', () => {
    const runner = runnerFor();
    setSubagentRunner(sessionId, runner);
    expect(getSubagentRunner(sessionId)).toBe(runner);
    expect(getSubagentRunner('session-b')).toBeNull();
  });
});

describe('tool registration', () => {
  it('routes dispatch_subagents through invokeTool with execution context', async () => {
    expect(allTools.some((tool) => tool.function.name === 'dispatch_subagents')).toBe(true);
    const runner = runnerFor();
    setSubagentRunner(sessionId, runner);
    const args: DispatchSubagentsArgs = { subagents: [{ id: 'a', task: 'do it', role: 'research' }] };
    const result = await invokeTool('dispatch_subagents', args, '/some/cwd', context);
    expect(result.ok).toBe(true);
    expect(runner.dispatch).toHaveBeenCalledOnce();
  });
});
