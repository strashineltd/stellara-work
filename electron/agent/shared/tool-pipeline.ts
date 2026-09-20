/**
 * 共享工具执行管道：调用工具 + 输出截断 + context 事件记账。
 *
 * 两条 agent loop（Responses / Anthropic）共用。事件提交顺序与 Responses
 * 历史实现逐条一致，保证事件回放兼容。
 */
import { invokeTool } from '../tools';
import { capToolOutput } from '../../context/compactor';
import { classifyVerificationCommand, type CommandVerificationKind } from './verification-commands';
import type { ContextHub } from '../../context/context-hub';
import type { ToolArgs, ToolExecutionContext, ToolName, ToolResult } from '../../../shared/ipc';

const VERIFICATION_KIND_LABELS: Record<CommandVerificationKind, string> = {
  test: '测试',
  typecheck: '类型检查',
  build: '构建',
};

/** capToolOutput 把超限输出替换为带 truncation 字段的 stub */
function isTruncationStub(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'truncation' in (value as Record<string, unknown>);
}

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

  // 读后复核通道：仅"完整读取且模型真实看到内容"才计入（部分读取 / 截断 stub 不算）
  const coveredRead =
    name === 'read_file' &&
    result.ok &&
    args.offset === undefined &&
    args.limit === undefined &&
    !isTruncationStub(capped);
  if (coveredRead && typeof args.path === 'string') {
    await hub.commitEvent('file_read', { filePath: args.path }, context.agentId);
  }

  if (result.meta?.kind === 'command') {
    await hub.commitEvent('command_completed', {
      command: result.meta.command,
      exitCode: result.meta.exitCode,
      stdout: result.meta.stdout,
      stderr: result.meta.stderr,
      planStepId,
    }, context.agentId);
    // 只有 test/typecheck/build 家族的命令成功才构成"文件验证"，其余命令不清理未验证标记
    const verificationKind =
      result.meta.exitCode === 0 ? classifyVerificationCommand(result.meta.command) : null;
    if (verificationKind) {
      await hub.commitEvent('verification_completed', {
        kind: verificationKind,
        command: result.meta.command,
        relatedFiles: hub.getUnverifiedFiles(),
        planStepIds: planStepId ? [planStepId] : [],
        ok: true,
        summary: `${VERIFICATION_KIND_LABELS[verificationKind]}通过：${result.meta.command}`,
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
