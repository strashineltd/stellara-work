import { describe, it, expect, afterEach, vi } from 'vitest';
import { dispatchSubagents, setSubagentRunner, getSubagentRunner } from './dispatch-subagents';
import type { SubagentRunner } from './dispatch-subagents';
import { invokeTool, allTools } from './index';
import type { DispatchSubagentsArgs } from '../../../shared/ipc';

const okRunner: SubagentRunner = {
  run: async (task: string) => ({ summary: `done: ${task}`, ok: true }),
};

afterEach(() => {
  setSubagentRunner(null);
});

describe('dispatchSubagents validation', () => {
  it('rejects empty subagents array', async () => {
    setSubagentRunner(okRunner);
    const result = await dispatchSubagents({ subagents: [] }, '/work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('1-20');
  });

  it('rejects more than 20 subagents', async () => {
    setSubagentRunner(okRunner);
    const defs = Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, task: `t${i}` }));
    const result = await dispatchSubagents({ subagents: defs }, '/work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('20');
  });

  it('rejects duplicate ids', async () => {
    setSubagentRunner(okRunner);
    const result = await dispatchSubagents(
      { subagents: [{ id: 'a', task: 't1' }, { id: 'a', task: 't2' }] },
      '/work',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('唯一');
  });

  it('rejects empty id', async () => {
    setSubagentRunner(okRunner);
    const result = await dispatchSubagents(
      { subagents: [{ id: '', task: 't1' }, { id: 'b', task: 't2' }] },
      '/work',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('id');
  });

  it('rejects empty task', async () => {
    setSubagentRunner(okRunner);
    const result = await dispatchSubagents(
      { subagents: [{ id: 'a', task: '  ' }] },
      '/work',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('task');
  });

  it('fails when no runner is injected', async () => {
    setSubagentRunner(null);
    const result = await dispatchSubagents({ subagents: [{ id: 'a', task: 't1' }] }, '/work');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('未设置');
  });
});

describe('dispatchSubagents parallel scheduling', () => {
  it('runs 11 subagents with peak concurrency 10 and completes all', async () => {
    const counters = { active: 0, peak: 0 };
    const setTotal = vi.fn();
    const run = vi.fn(async (task: string, _id: string) => {
      counters.active += 1;
      counters.peak = Math.max(counters.peak, counters.active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      counters.active -= 1;
      return { summary: `done: ${task}`, ok: true };
    });
    setSubagentRunner({ run, setTotal });

    const defs = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, task: `t${i}` }));
    const result = await dispatchSubagents({ subagents: defs }, '/work');

    expect(counters.peak).toBe(10);
    expect(counters.peak).toBeLessThanOrEqual(10);
    expect(run).toHaveBeenCalledTimes(11);
    expect(run.mock.calls.map(([, id]) => id)).toEqual(defs.map((d) => d.id));
    expect(setTotal).toHaveBeenCalledWith(11);
    expect(result.ok).toBe(true);
  });

  it('passes each def id as the second argument to run', async () => {
    const run = vi.fn(async (_task: string, _id: string) => ({ summary: 'r', ok: true }));
    setSubagentRunner({ run });

    const result = await dispatchSubagents(
      { subagents: [{ id: 'alpha', task: 'tA' }, { id: 'beta-x', task: 'tB' }] },
      '/work',
    );

    expect(run).toHaveBeenNthCalledWith(1, 'tA', 'alpha');
    expect(run).toHaveBeenNthCalledWith(2, 'tB', 'beta-x');
    expect(result.ok).toBe(true);
  });

  it('does not require setTotal (old runners stay compatible)', async () => {
    const run = vi.fn(async (_task: string, _id: string) => ({ summary: 'r', ok: true }));
    setSubagentRunner({ run });

    const result = await dispatchSubagents({ subagents: [{ id: 'a', task: 't1' }] }, '/work');

    expect(result.ok).toBe(true);
  });

  it('formats summary with header and per-subagent sections', async () => {
    const run = vi.fn(async (task: string) => ({ summary: `result(${task})`, ok: true }));
    setSubagentRunner({ run });

    const result = await dispatchSubagents(
      { subagents: [{ id: 'a', task: 'taskA' }, { id: 'b', task: 'taskB' }] },
      '/work',
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe(
      '已启动 2 个子代理（并行 ≤10）\n\n## #1 a\nresult(taskA)\n## #2 b\nresult(taskB)',
    );
  });

  it('marks result as failed and annotates failed subagents when any subagent fails', async () => {
    const run = vi.fn(async (task: string) =>
      task === 'bad' ? { summary: 'boom', ok: false } : { summary: `result(${task})`, ok: true },
    );
    setSubagentRunner({ run });

    const result = await dispatchSubagents(
      { subagents: [{ id: 'a', task: 'ok1' }, { id: 'b', task: 'bad' }] },
      '/work',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1 个子代理失败');
    expect(result.output).toContain('## #1 a\nresult(ok1)');
    expect(result.output).toContain('## #2 b（失败）\nboom');
  });

  it('treats a throwing runner as a failed subagent', async () => {
    const run = vi.fn(async () => {
      throw new Error('runner crash');
    });
    setSubagentRunner({ run });

    const result = await dispatchSubagents({ subagents: [{ id: 'a', task: 't1' }] }, '/work');

    expect(result.ok).toBe(false);
    expect(result.output).toContain('## #1 a（失败）\nrunner crash');
  });
});

describe('subagent runner singleton', () => {
  it('setSubagentRunner/getSubagentRunner round-trips', () => {
    const runner: SubagentRunner = { run: async () => ({ summary: 'x', ok: true }) };
    setSubagentRunner(runner);
    expect(getSubagentRunner()).toBe(runner);
  });
});

describe('dispatchSubagents registration', () => {
  it('registers dispatch_subagents in allTools', () => {
    expect(allTools.some((t) => t.function.name === 'dispatch_subagents')).toBe(true);
  });

  it('routes dispatch_subagents through invokeTool', async () => {
    const run = vi.fn(async (task: string, _id: string) => ({ summary: `s(${task})`, ok: true }));
    setSubagentRunner({ run });

    const args: DispatchSubagentsArgs = { subagents: [{ id: 'a', task: 'do it' }] };
    const result = await invokeTool('dispatch_subagents', args, '/some/cwd');

    expect(run).toHaveBeenCalledWith('do it', 'a');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('## #1 a\ns(do it)');
  });
});
