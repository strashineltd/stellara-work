/**
 * 共享工具执行管道：调用工具 + 输出截断 + context 事件记账。
 *
 * 两条 agent loop（Responses / Anthropic）共用。事件提交顺序与 Responses
 * 历史实现逐条一致，保证事件回放兼容。
 */
import { invokeTool } from '../tools';
import { capToolOutput } from '../../context/compactor';
import type { ContextHub } from '../../context/context-hub';
import type { ToolArgs, ToolExecutionContext, ToolName, ToolResult } from '../../../shared/ipc';

export interface ExecuteToolCallInput {
  hub: ContextHub;
  cwd: string;
  name: string;
  args: Record<string, unknown>;
  /** 由 findPlanStepForTool 得到；仅用于完成态推进 */
  matchedPlanStepId?: string;
  context: ToolExecutionContext;
}

export interface ExecuteToolCallResult {
  /** 截断后的结果序列化：回传模型并作为 function_call_output 入库 */
  outputText: string;
  /** 完整结果：供 UI tool_result 事件使用 */
  raw: ToolResult;
}

export async function executeToolCall(input: ExecuteToolCallInput): Promise<ExecuteToolCallResult> {
  const { hub, cwd, name, args, matchedPlanStepId, context } = input;
  const planStepId = matchedPlanStepId ?? context.planStepId;
  const toolContext: ToolExecutionContext = { ...context, planStepId };

  await hub.commitEvent('tool_call_started', {
    id: context.toolCallId,
    name,
    args,
    planStepId: matchedPlanStepId,
  }, context.agentId);

  const result = await invokeTool(name as ToolName, args as ToolArgs, cwd, toolContext);
  const capped = capToolOutput(name, args, result);

  await hub.commitEvent('tool_call_completed', {
    id: context.toolCallId,
    result: result.output,
    affectedFiles: result.meta?.kind === 'edit' ? [result.meta.path] : [],
  }, context.agentId);

  if (result.meta?.kind === 'command') {
    await hub.commitEvent('command_completed', {
      command: result.meta.command,
      exitCode: result.meta.exitCode,
      stdout: result.meta.stdout,
      stderr: result.meta.stderr,
      planStepId,
    }, context.agentId);
    if (result.meta.exitCode === 0) {
      await hub.commitEvent('verification_completed', {
        kind: 'test',
        command: result.meta.command,
        relatedFiles: hub.getUnverifiedFiles(),
        planStepIds: planStepId ? [planStepId] : [],
        ok: true,
        summary: `验证命令通过：${result.meta.command}`,
      }, context.agentId);
    }
  }

  if (result.meta?.kind === 'edit') {
    await hub.commitEvent('file_modified', {
      filePath: result.meta.path,
      toolCallId: context.toolCallId,
      agentId: context.agentId,
      planStepId,
    }, context.agentId);
  }

  if (result.ok && matchedPlanStepId) {
    await hub.commitEvent('plan_step_changed', {
      stepId: matchedPlanStepId,
      status: 'completed',
    }, context.agentId);
  }

  return { outputText: JSON.stringify(capped), raw: result };
}
