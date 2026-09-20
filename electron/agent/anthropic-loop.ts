import log from 'electron-log/main';
import type {
  ChatMessage,
  ChatStreamEvent,
  ModelConfig,
  OpenAITool,
  SkillDef,
  ToolCall,
  ToolExecutionContext,
} from '../../shared/ipc';
import type { AnthropicContent, AnthropicMessage, AnthropicTool } from '../llm/anthropic';
import { AnthropicClient } from '../llm/anthropic';
import { ContextHub, type PlanStep } from '../context/context-hub';
import { allTools, planModeTools } from './tools';
import { getSystemPrompt, type AgentPlatformInfo } from './plan';
import { parsePlanFromContent } from './plan-parser';
import { mcpManager } from '../mcp/mcp-manager';
import { needsApproval, filterToolsByPolicy } from './shared/tool-policy';
import { findPlanStepForTool } from './shared/plan-steps';
import { executeToolCall } from './shared/tool-pipeline';
import { runBudgetCheck } from './shared/context-budget';
import { evaluateToolCallLimit, MAX_TOOL_CALLS_DEFAULT } from './shared/loop-limits';
import { migrateHistoryToHub } from './shared/history-migration';
import { buildInstructions } from './shared/instructions';
import { projectAnthropicMessages } from './shared/anthropic-projection';
import { AnthropicStreamAssembler } from './anthropic-stream-assembler';
import { estimateRequestTokens } from '../context/token-estimator';
import { summarizeWithModel } from '../llm/client-factory';
import { COMPACTION_SUMMARY_PROMPT } from '../context/compactor';

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
  /** 工具子集过滤（策略）：未提供时不过滤 */
  allowedToolNames?: ReadonlySet<string>;
  /** 工具拒绝谓词（调度策略）：命中的工具始终不注入 */
  isToolDenied?: (name: string) => boolean;
  /** 会话所属项目 id（记忆注入时按项目检索项目记忆） */
  memoryProjectId?: string;
  /** 会话归属身份（记忆注入时按身份检索，缺省 default） */
  memoryUserId?: string;
  signal?: AbortSignal;
  onApproval?: (toolCall: ToolCall) => Promise<boolean>;
  /**
   * 子代理执行护栏：返回非空字符串时拒绝执行该工具调用并回传错误。
   * 可为异步（调度策略的文件范围校验需要 realpath）。
   */
  toolGuard?: (name: string, args: Record<string, unknown>) => string | null | Promise<string | null>;
  onPlanApproval?: (plan: { objective: string; constraints: string[]; steps: PlanStep[] }) => Promise<boolean>;
  rolePrompt?: string;
  agentId?: string;
  maxIterations?: number;
  maxToolCalls?: number;
  /** 达到 maxToolCalls 上限后转为强制审批模式（默认 true） */
  requireApprovalAfterLimit?: boolean;
  /** 压缩时是否调用 LLM 生成对话摘要（默认 false） */
  compactionSummaryEnabled?: boolean;
  /** 子代理内部关闭再次分派，避免递归任务树。 */
  allowSubagents?: boolean;
  /** 测试与嵌入场景可注入流式客户端；桌面运行时始终使用模型配置创建。 */
  client?: Pick<AnthropicClient, 'createStream'>;
}

// 工具策略与限额常量已移至 ./shared（tool-policy、loop-limits）

export async function* runAnthropicAgentLoop(
  userMessage: string,
  options: AnthropicLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const client = options.client ?? new AnthropicClient(options.model);
  let planMode = options.planMode ?? false;
  const executableTools = filterToolsByPolicy(
    options.allowSubagents === false
      ? allTools.filter((tool) => tool.function.name !== 'dispatch_subagents')
      : allTools,
    options.allowedToolNames,
    options.isToolDenied,
  );
  const allowedExtraTools = (options.extraTools ?? []).filter((tool) => !options.isToolDenied?.(tool.function.name));
  let tools = (planMode
    ? [...filterToolsByPolicy(planModeTools, options.allowedToolNames, options.isToolDenied), ...(options.planExtraTools ?? [])]
    : [...executableTools, ...allowedExtraTools])
    .map(toAnthropicTool);
  migrateHistoryToHub(options.contextHub, options.history);
  let messages: AnthropicMessage[] = projectAnthropicMessages(options.contextHub.getResponseItems());

  // 若重建窗口以 user 结尾（如中断恢复的中断结果），把新消息并入该条，保持角色交替
  const seedLast = messages[messages.length - 1];
  if (seedLast && seedLast.role === 'user') {
    const content = Array.isArray(seedLast.content)
      ? seedLast.content
      : [{ type: 'text' as const, text: seedLast.content }];
    content.push({ type: 'text', text: userMessage });
    seedLast.content = content;
  } else {
    messages.push({ role: 'user', content: userMessage });
  }
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
      userId: options.memoryUserId,
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
  let forceApprovalMode = false;
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
    const budget = await runBudgetCheck({
      hub: options.contextHub,
      requestTokens: estimateRequestTokens({
        items: [],
        instructions: buildInstructions(system, options.contextHub.getContext()),
        tools,
      }),
      signal: options.signal,
      summarize:
        options.compactionSummaryEnabled === true
          ? (transcript) => summarizeWithModel(options.model, COMPACTION_SUMMARY_PROMPT, transcript, options.signal)
          : undefined,
    });
    for (const budgetEvent of budget.events) yield budgetEvent;
    if (budget.compacted) {
      // 压缩后从 hub 重建消息窗口：被丢弃前缀必须离开请求体
      messages = projectAnthropicMessages(options.contextHub.getResponseItems());
    }
    if (budget.hardLimited) {
      return;
    }

    // 流式消费：文本/思考增量实时透传，装配后供下游使用（工具调用、截断、记账）
    const assembler = new AnthropicStreamAssembler();
    for await (const event of client.createStream({
      model: options.model.model,
      max_tokens: options.model.maxOutputTokens ?? 16_384,
      system: buildInstructions(system, options.contextHub.getContext()),
      messages,
      tools,
      tool_choice: { type: 'auto' },
    }, options.signal)) {
      const delta = assembler.handle(event);
      if (delta?.text) yield { type: 'content', content: delta.text };
      if (delta?.reasoning) yield { type: 'reasoning', content: delta.reasoning };
    }
    const response = assembler.finish();

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
        // 文本已在流式消费时透传，这里只落 ContextHub，避免重复输出
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
    const limit = evaluateToolCallLimit(toolCalls, options.maxToolCalls ?? MAX_TOOL_CALLS_DEFAULT, {
      requireApprovalAfterLimit: options.requireApprovalAfterLimit,
    });
    if (limit.kind === 'force_approval') {
      forceApprovalMode = true;
      yield { type: 'content', content: limit.message };
    } else if (limit.kind === 'error') {
      yield { type: 'error', error: limit.message, errorMeta: { kind: 'invalid_request', hint: limit.hint, retryable: false } };
      return;
    }

    const outputs: AnthropicContent[] = [];
    let taskCompleteAccepted = false;
    // 先按响应顺序登记本轮全部 function_call：保持同轮调用相邻，跨轮重建才能合并回一条 assistant 消息
    for (const use of uses) {
      const callId = (use.id ?? use.tool_use_id)!;
      const args = (use.input ?? {}) as Record<string, unknown>;
      options.contextHub.addResponseItem({ type: 'function_call', call_id: callId, name: use.name!, arguments: JSON.stringify(args), status: 'completed' });
    }
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

      if (name === 'task_complete') {
        const gate = options.contextHub.canCompleteTask();
        if (!gate.ok) {
          const output = JSON.stringify({ ok: false, error: `任务无法完成：${gate.reasons.join('; ')}` });
          outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
          options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
          continue;
        }
      }

      const guardError = await options.toolGuard?.(name, args);
      if (guardError) {
        const output = JSON.stringify({ ok: false, error: guardError });
        outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
        options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
        continue;
      }

      // 内置危险工具 / plan 模式敏感工具 / MCP 审批策略 / 强制审批模式要求时等待用户批准；缺少 onApproval 时 fail-closed 拒绝
      const requiresApproval = await needsApproval({
        toolName: name,
        planMode,
        forceApproval: forceApprovalMode,
        mcpRequiresApproval: (toolName) => mcpManager.requiresApproval(toolName),
      });
      if (requiresApproval) {
        if (!options.onApproval) {
          const output = JSON.stringify({ ok: false, error: '此操作需要用户批准，但当前上下文不支持审批（已拒绝）' });
          outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
          options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
          continue;
        }
        const approved = await options.onApproval({ id: callId, type: 'function', function: { name, arguments: argsJson } });
        if (!approved) {
          const output = JSON.stringify({ ok: false, error: '用户拒绝了此操作' });
          outputs.push({ type: 'tool_result', tool_use_id: callId, content: output });
          options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output });
          continue;
        }
      }

      // 工具调用事件由共享管道统一提交（started → completed → …）
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

        const { outputText, raw } = await executeToolCall({
          hub: options.contextHub,
          cwd: options.cwd,
          name,
          args,
          matchedPlanStepId: matchedPlanStep?.id,
          context: toolContext,
        });

        outputs.push({ type: 'tool_result', tool_use_id: callId, content: outputText });
        options.contextHub.addResponseItem({ type: 'function_call_output', call_id: callId, output: outputText });
        yield { type: 'tool_result', toolResult: { name, toolCallId: callId, result: raw } };

        if (name === 'task_complete' && raw.ok) taskCompleteAccepted = true;
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

// findPlanStepForTool 与 buildInstructions 已移至 ./shared（plan-steps、instructions）
