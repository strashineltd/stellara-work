import type { OpenAITool, ToolResult } from '../../../shared/ipc';
import type { DispatchSubagentsArgs } from '../../../shared/ipc';

export interface SubagentRunner {
  run(task: string): Promise<{ summary: string; ok: boolean }>;
}

let runner: SubagentRunner | null = null;

export function setSubagentRunner(r: SubagentRunner | null): void {
  runner = r;
}

export function getSubagentRunner(): SubagentRunner | null {
  return runner;
}

const MAX_PARALLEL = 10;
const MAX_SUBAGENTS = 20;

export async function dispatchSubagents(
  args: DispatchSubagentsArgs,
  _cwd: string,
): Promise<ToolResult> {
  const defs = args?.subagents;
  if (!Array.isArray(defs) || defs.length < 1 || defs.length > MAX_SUBAGENTS) {
    return { ok: false, output: '', error: `subagents 必须是 1-${MAX_SUBAGENTS} 项的非空数组` };
  }
  for (let i = 0; i < defs.length; i++) {
    if (typeof defs[i].id !== 'string' || defs[i].id.trim() === '') {
      return { ok: false, output: '', error: `subagents[${i}].id 不能为空` };
    }
    if (typeof defs[i].task !== 'string' || defs[i].task.trim() === '') {
      return { ok: false, output: '', error: `subagents[${i}].task 不能为空` };
    }
  }
  if (new Set(defs.map((s) => s.id)).size !== defs.length) {
    return { ok: false, output: '', error: 'subagents 的 id 必须唯一' };
  }
  if (!runner) {
    return { ok: false, output: '', error: '子代理执行器未设置（setSubagentRunner）' };
  }

  const subagentRunner = runner;
  const total = defs.length;
  const results: Array<{ summary: string; ok: boolean }> = new Array(total);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      try {
        results[index] = await subagentRunner.run(defs[index].task);
      } catch (err) {
        results[index] = {
          summary: err instanceof Error ? err.message : String(err),
          ok: false,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(total, MAX_PARALLEL) }, worker));

  const failed = results.filter((r) => !r.ok).length;
  const lines = defs.map((def, i) => {
    const r = results[i];
    const head = r.ok ? `## #${i + 1} ${def.id}` : `## #${i + 1} ${def.id}（失败）`;
    return `${head}\n${r.summary}`;
  });
  const output = `已启动 ${total} 个子代理（并行 ≤${MAX_PARALLEL}）\n\n${lines.join('\n')}`;

  if (failed > 0) {
    return { ok: false, output, error: `${failed} 个子代理失败` };
  }
  return { ok: true, output };
}

export const dispatchSubagentsTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'dispatch_subagents',
      description:
        '把大任务拆分成多个独立子任务，并行分发给子代理执行（最多 10 个并行，超出排队）。每个子代理共享工作目录、独立上下文，完成后返回各子代理的汇总报告。',
      parameters: {
        type: 'object',
        properties: {
          subagents: {
            type: 'array',
            description: '子代理任务列表（1-20 项），每项包含唯一 id 与任务描述',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '子代理唯一标识（如 refactor-fs、write-tests）' },
                task: { type: 'string', description: '该子代理要独立完成的具体任务' },
              },
              required: ['id', 'task'],
              additionalProperties: false,
            },
          },
        },
        required: ['subagents'],
        additionalProperties: false,
      },
    },
  },
];
