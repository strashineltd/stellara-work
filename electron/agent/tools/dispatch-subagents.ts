import type {
  DispatchSubagentsArgs,
  OpenAITool,
  SubagentDef,
  ToolExecutionContext,
  ToolResult,
} from '../../../shared/ipc';

export interface SubagentRunner {
  dispatch(subagents: SubagentDef[]): Promise<{
    results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>;
    conflicts: string[];
    totalUsage: { promptTokens: number; completionTokens: number };
  }>;
}

const runners = new Map<string, SubagentRunner>();
const MAX_SUBAGENTS = 10;

/** 注册会话级子代理执行器，避免多个主会话互相覆盖。 */
export function setSubagentRunner(sessionId: string, runner: SubagentRunner | null): void {
  if (runner) runners.set(sessionId, runner);
  else runners.delete(sessionId);
}

export function getSubagentRunner(sessionId: string): SubagentRunner | null {
  return runners.get(sessionId) ?? null;
}

export async function dispatchSubagents(
  args: DispatchSubagentsArgs,
  _cwd: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const defs = args?.subagents;
  if (!Array.isArray(defs) || defs.length < 1 || defs.length > MAX_SUBAGENTS) {
    return { ok: false, output: '', error: `subagents 必须是 1-${MAX_SUBAGENTS} 项的非空数组` };
  }
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    if (typeof def.id !== 'string' || def.id.trim() === '') {
      return { ok: false, output: '', error: `subagents[${i}].id 不能为空` };
    }
    if (typeof def.task !== 'string' || def.task.trim() === '') {
      return { ok: false, output: '', error: `subagents[${i}].task 不能为空` };
    }
    if (def.role === 'build' && (!def.fileScopes || def.fileScopes.length === 0)) {
      return { ok: false, output: '', error: `build 子代理 ${def.id} 必须声明 fileScopes` };
    }
  }
  if (new Set(defs.map((item) => item.id)).size !== defs.length) {
    return { ok: false, output: '', error: 'subagents 的 id 必须唯一' };
  }
  if (!context?.sessionId) {
    return { ok: false, output: '', error: '缺少会话上下文，无法安全分发子代理' };
  }

  const runner = getSubagentRunner(context.sessionId);
  if (!runner) {
    return { ok: false, output: '', error: `会话 ${context.sessionId} 的子代理执行器未设置` };
  }

  const batch = await runner.dispatch(defs);
  const lines = batch.results.map((result, index) => {
    const def = defs.find((item) => item.id === result.id)!;
    const state = result.ok ? '完成' : '失败';
    return `## #${index + 1} ${result.id} · ${def.role ?? 'research'} · ${state}\n${result.summary}`;
  });
  if (batch.conflicts.length > 0) {
    lines.push(`## 冲突\n${batch.conflicts.map((item) => `- ${item}`).join('\n')}`);
  }
  const failed = batch.results.filter((result) => !result.ok).length;
  const output = `子代理批次完成：${batch.results.length - failed}/${batch.results.length} 成功\n\n${lines.join('\n\n')}`;
  return failed > 0 || batch.conflicts.length > 0
    ? { ok: false, output, error: `${failed} 个子代理失败，${batch.conflicts.length} 个冲突` }
    : { ok: true, output };
}

export const dispatchSubagentsTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'dispatch_subagents',
      description: '把独立子任务分发给会话级子代理。research/verify 最多 4 个并行，build 串行执行并检查文件范围冲突。',
      parameters: {
        type: 'object',
        properties: {
          subagents: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_SUBAGENTS,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '批次内唯一标识' },
                task: { type: 'string', description: '具体、可独立验收的任务' },
                role: { type: 'string', enum: ['research', 'build', 'verify'] },
                modelId: { type: 'string', description: '可选模型 ID；缺省继承主模型' },
                readOnly: { type: 'boolean', description: 'research/verify 默认 true' },
                fileScopes: { type: 'array', items: { type: 'string' }, description: 'build 必填，可修改文件范围' },
                expectedOutput: { type: 'string', description: '期望的结构化交付结果' },
              },
              required: ['id', 'task', 'role'],
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
