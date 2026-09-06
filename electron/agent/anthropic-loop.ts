import log from 'electron-log/main';
import type {
  ChatMessage,
  ChatStreamEvent,
  ModelConfig,
  OpenAITool,
  SkillDef,
  ToolCall,
  ToolExecutionContext,
  ToolName,
} from '../../shared/ipc';
import type { AnthropicContent, AnthropicMessage, AnthropicTool } from '../llm/anthropic';
import { AnthropicClient } from '../llm/anthropic';
import { ContextHub, type PlanStep, type TaskContext } from '../context/context-hub';
import { allTools, invokeTool, planModeTools } from './tools';
import { getSystemPrompt, type AgentPlatformInfo } from './plan';
import { parsePlanFromContent } from './plan-parser';
import { mcpManager } from '../mcp/mcp-manager';

export interface AnthropicLoopOptions {
  model: ModelConfig;
  cwd: string;
  sessionId: string;
  contextHub: ContextHub;
  history?: ChatMessage[];
  planMode?: boolean;
  platform?: AgentPlatformInfo;
  skills?: SkillDef[];
  activeSkill?: SkillDef;
  extraTools?: OpenAITool[];
  /** plan 模式下额外注入的只读工具（如 planVisible 的 MCP 工具） */
  planExtraTools?: OpenAITool[];
  /** 会话所属项目 id（记忆注入时按项目检索项目记忆） */
  memoryProjectId?: string;
  signal?: AbortSignal;
  onApproval?: (toolCall: ToolCall) => Promise<boolean>;
  onPlanApproval?: (plan: { objective: string; constraints: string[]; steps: PlanStep[] }) => Promise<boolean>;
  rolePrompt?: string;
  agentId?: string;
  maxIterations?: number;
  maxToolCalls?: number;
  /** 子代理内部关闭再次分派，避免递归任务树。 */
  allowSubagents?: boolean;
  /** 测试与嵌入场景可注入客户端；桌面运行时始终使用模型配置创建。 */
  client?: Pick<AnthropicClient, 'create'>;
}

const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'run_command', 'web_fetch', 'dispatch_subagents', 'browser_act', 'browser_exec_js']);

export async function* runAnthropicAgentLoop(
  userMessage: string,
  options: AnthropicLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const client = options.client ?? new AnthropicClient(options.model);
  let planMode = options.planMode ?? false;
  const executableTools = options.allowSubagents === false
    ? allTools.filter((tool) => tool.function.name !== 'dispatch_subagents')
    : allTools;
  let tools = (planMode
    ? [...planModeTools, ...(options.planExtraTools ?? [])]
    : [...executableTools, ...(options.extraTools ?? [])])
    .map(toAnthropicTool);
  const messages: AnthropicMessage[] = [];
  const history = options.history ?? [];

  if (options.contextHub.getResponseItems().length === 0) {
    for (const item of history) {
      if ((item.role === 'user' || item.role === 'assistant') && item.content) {
        messages.push({ role: item.role, content: item.content });
        options.contextHub.addResponseItem({
          type: 'message',
          role: item.role,
          content: [{ type: item.role === 'user' ? 'input_text' : 'output_text', text: item.content }],
          status: 'completed',
        });
      }
    }
  } else {
    for (const item of history) {
      if ((item.role === 'user' || item.role === 'assistant') && item.content) {
        messages.push({ role: item.role, content: item.content });
      }
    }
  }

  messages.push({ role: 'user', content: userMessage });
  await options.contextHub.commitEvent('user_message_added', { content: userMessage, attachments: [] }, options.agentId ?? 'main');

  let system = getSystemPrompt(
    planMode,
    options.platform ?? { platform: process.platform, arch: process.arch },
    options.skills,
    options.activeSkill,
  );
  if (options.rolePrompt) system += `\n\n${options.rolePrompt}`;

  // 注入相关记忆（个人 + 项目 + workspace + 高重要度偏好）
  try {
    const { retrieveMemoriesForInjection } = await import('../memory/memory-injector');
    const { memories, promptBlock } = await retrieveMemoriesForInjection(userMessage, {
      maxMemories: 10,
      projectId: options.memoryProjectId,
    });
    if (promptBlock) {
      system += `\n\n${promptBlock}`;
      yield {
        type: 'memory_context',
        memories: memories.map((m) => ({
          kind: m.kind,
          content: m.content,
          importance: m.importance,
          source: m.source,
        })),
      };
      for (const mem of memories) {
        await options.contextHub.commitEvent('memory_injected', {
          id: mem.id,
          scope: mem.scope,
          kind: mem.kind,
          content: mem.content,
          source: mem.source || 'session:current',
        }, options.agentId ?? 'main');
      }
    }
  } catch (err) {
    log.warn('记忆注入失败，继续执行:', err);
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCalls = 0;
  /** 连续输出截断次数（reasoning 吃满 max_tokens 时每轮都会截断） */
  let incompleteCount = 0;

  for (let iteration = 0; iteration < (options.maxIterations ?? 200); iteration++) {
    if (incompleteCount >= 3) {
      yield {
        type: 'error',
        error: '连续多次输出被截断（reasoning + 输出超出单次生成上限）。请在模型设置中调大 max_output_tokens，或降低 reasoning effort',
        errorMeta: { kind: 'invalid_request', hint: '连续多次输出被截断，请调大 max_output_tokens 或降低思考强度', retryable: false },
      };
      return;
    }
    if (options.signal?.aborted) {
      yield { type: 'error', error: '用户中断', errorMeta: { kind: 'user_aborted', hint: '请求已取消', retryable: false } };
      return;
    }
    if (options.contextHub.isHardLimited()) {
      yield { type: 'error', error: '上下文达到硬阈值', errorMeta: { kind: 'context_too_long', hint: '上下文达到硬阈值，请创建检查点后继续', retryable: false } };
      return;
    }

    const response = await client.create({
      model: options.model.model,
      max_tokens: options.model.maxOutputTokens ?? 16_384,
      system: buildInstructions(system, options.contextHub.getContext()),
      messages,
      tools,
      tool_choice: { type: 'auto' },
    }, options.signal);

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    yield {
      type: 'usage',
      usage: { promptTokens: response.usage.input_tokens, completionTokens: response.usage.output_tokens, estimated: false },
      totals: { promptTokens: totalInputTokens, completionTokens: totalOutputTokens },
    };

    // 输出截断：reasoning + 输出共用 max_tokens 预算，截断后提示并续接
    if (response.stop_reason === 'max_tokens') {
      incompleteCount += 1;
      yield { type: 'content', content: '\n\n[输出截断：已达单次输出上限，继续生成…]' };
    } else {
      incompleteCount = 0;
    }

    const assistantContent = response.content.length > 0 ? response.content : [{ type: 'text', text: '' } satisfies AnthropicContent];
    messages.push({ role: 'assistant', content: assistantContent });
    for (const block of assistantContent) {
      if (block.type === 'text' && block.text) {
        yield { type: 'content', content: block.text };
        options.contextHub.addResponseItem({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: block.text }],
          status: 'completed',
        });
      }
    }

    const uses = assistantContent.filter((block) => block.type === 'tool_use' && (block.id || block.tool_use_id) && block.name);
    if (uses.length === 0) {
      if (response.stop_reason === 'max_tokens') {
        // 输出被截断：续接（messages 已含部分文本，继续生成），不走任务完成分支
        continue;
      }
      if (planMode) {
        const planText = assistantContent.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
        const parsed = parsePlanFromContent(planText);
        if (!parsed) {
          yield { type: 'error', error: '计划模式未生成可执行的编号步骤', errorMeta: { kind: 'invalid_request', hint: '请让模型输出编号计划后重试', retryable: true } };
          return;
        }
        const structuredPlan = {
          objective: userMessage,
          constraints: [],
          steps: parsed.steps.map((step) => ({
            id: `plan-${options.contextHub.getRevision()}-${step.index}`,
            description: step.description,
            status: 'pending' as const,
            relatedFiles: [],
            requiredVerification: [],
            evidenceIds: [],
          })),
        };
        await options.contextHub.commitEvent('plan_created', structuredPlan, options.agentId ?? 'main');
        yield { type: 'plan', plan: structuredPlan.steps.map((step) => step.description) };
        if (!options.onPlanApproval || !(await options.onPlanApproval(structuredPlan))) {
          yield { type: 'done' };
          return;
        }
        planMode = false;
        system = getSystemPrompt(false, options.platform ?? { platform: process.platform, arch: process.arch }, options.skills, options.activeSkill);
        if (options.rolePrompt) system += `\n\n${options.rolePrompt}`;
        tools = [...executableTools, ...(options.extraTools ?? [])].map(toAnthropicTool);
        const approvalMessage = '计划已批准。现在严格按计划执行，完成修改与验证后调用 task_complete。';
        messages.push({ role: 'user', content: approvalMessage });
        await options.contextHub.commitEvent('user_message_added', { content: approvalMessage, attachments: [] }, options.agentId ?? 'main');
        continue;
      }
      yield { type: 'done' };
      return;
    }

    toolCalls += uses.length;
    if (toolCalls > (options.maxToolCalls ?? 50)) {
      yield { type: 'error', error: '工具调用次数超过限制', errorMeta: { kind: 'invalid_request', hint: '工具调用次数超过限制', retryable: false } };
      return;
    }

    const outputs: AnthropicContent[] = [];
    let taskCompleteAccepted = false;
    for (const use of uses) {
      const callId = (use.id ?? use.tool_use_id)!;
      const name = use.name!;
      const args = (use.input ?? {}) as Record<string, unknown>;
      const argsJson = JSON.stringify(args);
      const matchedPlanStep = findPlanStepForTool(options.contextHub.getContext(), name, args);
      if (matchedPlanStep?.status === 'pending') {
        await options.contextHub.commitEvent('plan_step_changed', {
          stepId: matchedPlanStep.id,
          status: 'in_progress',
        }, options.agentId ?? 'main');
      }
      options.contextHub.addResponseItem({ type: 'function_call', call_id: callId, name, arguments: argsJson, status: 'completed' });

      if (name === 'task_complete') {
        const gate = options.contextHub.canCompleteTask();
        if (!gate.ok) {
          const output = JSON.stringify({ ok: false, error: `任务无法完成：${gate.reasons.join('; ')}` });
          outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
          options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
          continue;
        }
      }

      // 内置危险工具或 MCP 审批策略要求时，等待用户批准（无 onApproval 时保持现有直通行为）
      const requiresApproval =
        DANGEROUS_TOOLS.has(name) || (name.startsWith('mcp__') && (await mcpManager.requiresApproval(name)));
      if (requiresApproval && options.onApproval) {
        const approved = await options.onApproval({ id: callId, type: 'function', function: { name, arguments: argsJson } });
        if (!approved) {
          const output = JSON.stringify({ ok: false, error: '用户拒绝了此操作' });
          outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
          options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
          continue;
        }
      }

      await options.contextHub.commitEvent('tool_call_started', {
        id: callId,
        name,
        args,
        planStepId: matchedPlanStep?.id,
      }, options.agentId ?? 'main');
      yield { type: 'tool_call', toolCall: { id: callId, type: 'function', function: { name, arguments: argsJson } } };

      try {
        const toolContext: ToolExecutionContext = {
          sessionId: options.sessionId,
          agentId: options.agentId ?? 'main',
          contextRevision: options.contextHub.getRevision(),
          workspaceRevision: options.contextHub.getWorkspaceRevision(),
          planStepId: matchedPlanStep?.id ?? options.contextHub.getContext().plan.steps.find((step) => step.status === 'in_progress')?.id,
          toolCallId: callId,
        };
        const result = await invokeTool(name as ToolName, args, options.cwd, toolContext);
        const output = JSON.stringify(result);
        outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
        options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
        await options.contextHub.commitEvent('tool_call_completed', {
          id: callId,
          result: result.output,
          affectedFiles: result.meta?.kind === 'edit' ? [result.meta.path] : [],
        }, options.agentId ?? 'main');
        if (result.meta?.kind === 'edit') {
          await options.contextHub.commitEvent('file_modified', {
            filePath: result.meta.path,
            toolCallId: callId,
            agentId: options.agentId ?? 'main',
            planStepId: toolContext.planStepId,
          }, options.agentId ?? 'main');
        }
        if (result.meta?.kind === 'command') {
          await options.contextHub.commitEvent('command_completed', {
            command: result.meta.command,
            exitCode: result.meta.exitCode,
            stdout: result.meta.stdout,
            stderr: result.meta.stderr,
            planStepId: toolContext.planStepId,
          }, options.agentId ?? 'main');
          if (result.meta.exitCode === 0) {
            await options.contextHub.commitEvent('verification_completed', {
              kind: 'test',
              command: result.meta.command,
              relatedFiles: options.contextHub.getUnverifiedFiles(),
              planStepIds: toolContext.planStepId ? [toolContext.planStepId] : [],
              ok: true,
              summary: `验证命令通过：${result.meta.command}`,
            }, options.agentId ?? 'main');
          }
        }
        if (result.ok && matchedPlanStep) {
          await options.contextHub.commitEvent('plan_step_changed', {
            stepId: matchedPlanStep.id,
            status: 'completed',
          }, options.agentId ?? 'main');
        }
        yield { type: 'tool_result', toolResult: { name, toolCallId: callId, result } };
        if (name === 'task_complete' && result.ok) taskCompleteAccepted = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const output = JSON.stringify({ ok: false, error: message });
        outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
        options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
        await options.contextHub.commitEvent('tool_call_completed', { id: callId, error: message }, options.agentId ?? 'main');
        yield { type: 'tool_result', toolResult: { name, toolCallId: callId, result: { ok: false, output: '', error: message } } };
      }
    }

    messages.push({ role: 'user', content: outputs });
    if (taskCompleteAccepted) {
      yield { type: 'task_complete' };
      yield { type: 'done' };
      return;
    }
  }

  yield { type: 'error', error: '超过最大迭代次数', errorMeta: { kind: 'invalid_request', hint: '超过最大迭代次数', retryable: false } };
}

function toAnthropicTool(tool: OpenAITool): AnthropicTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}

function findPlanStepForTool(
  context: Readonly<TaskContext>,
  toolName: string,
  args: Record<string, unknown>,
): PlanStep | undefined {
  if (toolName === 'task_complete' || toolName === 'dispatch_subagents') return undefined;
  const active = context.plan.steps.find((step) => step.status === 'in_progress');
  if (active) return active;
  const pathValue = typeof args.path === 'string' ? args.path.toLowerCase() : '';
  const commandValue = typeof args.command === 'string' ? args.command.toLowerCase() : '';
  return context.plan.steps.find((step) => {
    if (step.status !== 'pending') return false;
    const text = step.description.toLowerCase();
    if (pathValue && text.includes(pathValue)) return true;
    if (commandValue && text.includes(commandValue)) return true;
    if (toolName === 'run_command') return /测试|验证|构建|运行|test|build|verify/.test(text);
    if (toolName === 'write_file' || toolName === 'edit_file') return /实现|修改|编辑|创建|写入|add|edit|implement/.test(text);
    return false;
  }) ?? context.plan.steps.find((step) => step.status === 'pending');
}

function buildInstructions(system: string, context: Readonly<TaskContext>): string {
  const sections = [system];
  if (context.objective) sections.push(`## 当前目标\n${context.objective}`);
  if (context.constraints.length > 0) sections.push(`## 约束\n${context.constraints.map((item) => `- ${item}`).join('\n')}`);
  if (context.decisions.length > 0) sections.push(`## 已确认决策\n${context.decisions.map((item) => `- ${item.description}: ${item.reason}`).join('\n')}`);
  if (context.plan.steps.length > 0) sections.push(`## 计划状态\n${context.plan.steps.map((item) => `- [${item.status}] ${item.description}`).join('\n')}`);
  if (context.workspace.unverifiedFiles.size > 0) sections.push(`## 未验证文件\n${Array.from(context.workspace.unverifiedFiles).map((item) => `- ${item}`).join('\n')}`);
  return sections.join('\n\n');
}
