/**
 * Responses API Agent Loop
 *
 * 基于 Responses API 的主 Agent 循环。
 * 核心变化（按计划 Section 7）：
 * 1. 使用 ResponseItem[] 替代 ChatMessage[]
 * 2. 接入 Context Hub（单一事实源）
 * 3. 工具输出改为 function_call_output
 * 4. 支持单轮多个 Function Call
 * 5. instructions 每轮从 Context Selector 重新生成
 * 6. 实现 task_complete 门禁
 */

import log from 'electron-log/main';
import type { ModelConfig, ChatStreamEvent, ToolCall, ToolName, ToolExecutionContext, SkillDef, ErrorKind } from '../../shared/ipc';
import type {
  CreateResponseRequest,
  ResponseItem,
  ResponseFunctionTool,
  ResponseStreamEvent,
  ResponseFunctionCallItem,
  ResponseFunctionCallOutputItem,
} from '../../shared/responses';
import { ResponsesClient } from '../llm/responses';
import { allTools, planModeTools, invokeTool } from './tools';
import { mcpManager } from '../mcp/mcp-manager';
import { getSystemPrompt, type AgentPlatformInfo } from './plan';
import { ContextHub, type TaskContext, type PlanStep } from '../context/context-hub';
import { parsePlanFromContent } from './plan-parser';

// ============================================
// 接口定义
// ============================================

export interface ResponsesLoopOptions {
  model: ModelConfig;
  cwd: string;
  sessionId: string;
  /** 运行平台信息 */
  platform?: AgentPlatformInfo;
  /** Context Hub 实例 */
  contextHub: ContextHub;
  /** Plan 模式：agent 只能调只读工具 */
  planMode?: boolean;
  /** 从 plan mode 传入的结构化计划 */
  plan?: { objective: string; constraints: string[]; steps: PlanStep[] } | null;
  maxIterations?: number;
  /** 单次 run 的最大工具调用次数；默认 50 */
  maxToolCalls?: number;
  /** skills/ 目录下加载的技能定义 */
  skills?: SkillDef[];
  /** /skill-name 精确调用的单个 skill */
  activeSkill?: SkillDef;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 额外注入的工具（如 MCP 工具） */
  extraTools?: ResponseFunctionTool[];
  /** plan 模式下额外注入的只读工具（如 planVisible 的 MCP 工具） */
  planExtraTools?: ResponseFunctionTool[];
  /** 会话所属项目 id（记忆注入时按项目检索项目记忆） */
  memoryProjectId?: string;
  /**
   * 危险工具被调用前的批准回调。
   * 返回 true 放行；false 拒绝。
   */
  onApproval?: (toolCall: ToolCall) => Promise<boolean>;
  /**
   * Plan 批准回调：plan 模式产出计划后暂停，等待用户批准。
   */
  onPlanApproval?: (plan: { objective: string; constraints: string[]; steps: PlanStep[] }) => Promise<boolean>;
  /** 子代理角色提示 */
  rolePrompt?: string;
  /** 首次迁移旧会话时使用的领域消息历史；不会直接作为供应商请求体。 */
  history?: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>;
  /** 当前 Agent 标识。 */
  agentId?: string;
  /** 达到 maxToolCalls 上限后转为强制审批模式 */
  requireApprovalAfterLimit?: boolean;
  /** 子代理内部关闭再次分派，避免递归任务树。 */
  allowSubagents?: boolean;
}

// ============================================
// 常量
// ============================================

const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'run_command', 'web_fetch', 'dispatch_subagents']);
const MAX_TOOL_CALLS_DEFAULT = 50;
const MAX_ITERATIONS_DEFAULT = 200;

// ============================================
// Responses Agent Loop
// ============================================

/**
 * Responses API Agent Loop
 *
 * 流式 yield ChatStreamEvent 给调用方。
 * 使用 Context Hub 管理状态，每次请求重新生成 instructions。
 */
export async function* runResponsesLoop(
  userMessage: string,
  options: ResponsesLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const {
    model,
    cwd,
    sessionId,
    contextHub,
    planMode: initialPlanMode = false,
    maxIterations = MAX_ITERATIONS_DEFAULT,
    maxToolCalls = MAX_TOOL_CALLS_DEFAULT,
    onApproval,
    signal,
  } = options;

  let planMode = initialPlanMode;
  let iteration = 0;
  let toolCallCount = 0;
  let forceApprovalMode = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  /** 连续输出截断次数（reasoning 吃满 max_output_tokens 时每轮都会截断） */
  let incompleteCount = 0;
  /** 本轮输出被截断（截断后需续接，不走"任务完成"分支） */
  let truncated = false;

  // 初始化 ResponsesClient
  const client = new ResponsesClient({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
  });

  // 平台信息
  const platformInfo = options.platform ?? { platform: process.platform, arch: process.arch };

  // 获取系统提示词
  let systemPrompt = getSystemPrompt(planMode, platformInfo, options.skills, options.activeSkill);
  if (options.rolePrompt) {
    systemPrompt += `\n\n${options.rolePrompt}`;
  }

  // v0.9.1 会话尚未持久化完整 Responses Items 时，用领域历史做一次迁移。
  if (contextHub.getResponseItems().length === 0 && options.history?.length) {
    for (const message of options.history) {
      if ((message.role === 'user' || message.role === 'assistant') && message.content) {
        contextHub.addResponseItem({
          type: 'message',
          role: message.role,
          content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
          status: 'completed',
        });
      }
      if (message.role === 'assistant') {
        for (const call of message.tool_calls ?? []) {
          contextHub.addResponseItem({
            type: 'function_call',
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
            status: 'completed',
          });
        }
      }
      if (message.role === 'tool' && message.tool_call_id) {
        contextHub.addResponseItem({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: message.content,
        });
      }
    }
  }

  // 注入记忆
  try {
    const { retrieveMemoriesForInjection } = await import('../memory/memory-injector');
    const { memories, promptBlock } = await retrieveMemoriesForInjection(userMessage, {
      maxMemories: 10,
      projectId: options.memoryProjectId,
    });
    if (promptBlock) {
      systemPrompt += `\n\n${promptBlock}`;
      yield {
        type: 'memory_context',
        memories: memories.map(m => ({
          kind: m.kind,
          content: m.content,
          importance: m.importance,
          source: m.source,
        })),
      };
      // 记录到 Context Hub
      for (const mem of memories) {
        await contextHub.commitEvent('memory_injected', {
          id: mem.id,
          scope: mem.scope,
          kind: mem.kind,
          content: mem.content,
          source: mem.source || 'session:current',
        });
      }
    }
  } catch (err) {
    log.warn('记忆注入失败，继续执行:', err);
  }

  // 添加用户消息到 Context Hub
  await contextHub.commitEvent('user_message_added', {
    content: userMessage,
    attachments: [],
  });

  // 获取工具定义
  const executableTools = options.allowSubagents === false
    ? allTools.filter((tool) => tool.function.name !== 'dispatch_subagents')
    : allTools;
  let tools = planMode
    ? [...planModeTools.map(t => convertToResponseTool(t)), ...(options.planExtraTools ?? [])]
    : [...executableTools.map(t => convertToResponseTool(t)), ...(options.extraTools ?? [])];

  // 主循环
  while (iteration < maxIterations) {
    iteration++;

    // 检查中断信号
    if (signal?.aborted) {
      yield { type: 'error', error: '用户中断', errorMeta: { kind: 'user_aborted', hint: '请求已取消', retryable: false } };
      return;
    }

    // 连续截断保护：reasoning 吃满输出预算时每轮都会截断，避免无限循环
    if (incompleteCount >= 3) {
      yield {
        type: 'error',
        error: '连续多次输出被截断（reasoning + 输出超出单次生成上限）。请在模型设置中调大 max_output_tokens，或降低 reasoning effort',
        errorMeta: { kind: 'invalid_request', hint: '连续多次输出被截断，请调大 max_output_tokens 或降低思考强度', retryable: false },
      };
      return;
    }

    // 检查硬阈值
    if (contextHub.isHardLimited()) {
      yield {
        type: 'error',
        error: '上下文达到硬阈值，请压缩后再继续',
        errorMeta: { kind: 'context_too_long', hint: '上下文达到硬阈值，请压缩后再继续', retryable: false },
      };
      return;
    }

    // 构建请求
    const context = contextHub.getContext();
    const instructions = buildInstructions(systemPrompt, context);
    const inputItems = contextHub.getResponseItems();

    const request: CreateResponseRequest = {
      model: model.model,
      instructions,
      input: inputItems,
      tools,
      stream: true,
      store: false,
      max_output_tokens: model.maxOutputTokens ?? 16384,
      parallel_tool_calls: true,
    };
    if (model.reasoningEffort) {
      request.reasoning = {
        effort: model.reasoningEffort === 'max' ? 'high' : model.reasoningEffort,
      };
    }

    // 调用模型
    let responseItems: ResponseItem[] = [];
    const functionCalls = new Map<string, ResponseFunctionCallItem>();
    let assistantText = '';
    let failed = false;
    let errorMessage = '';

    try {
      for await (const event of client.createStream(request, signal)) {
        // 处理流式事件
        const result = handleStreamEvent(event);

        if (result.type === 'content') {
          assistantText += result.content ?? '';
          yield { type: 'content', content: result.content };
        } else if (result.type === 'reasoning') {
          // 思考过程透传给 UI（折叠展示）
          if (result.content) yield { type: 'reasoning', content: result.content };
        } else if (result.type === 'function_call' && result.functionCall) {
          functionCalls.set(result.functionCall.call_id, result.functionCall);
        } else if (result.type === 'completed') {
          responseItems = result.items || [];
          for (const item of responseItems) {
            if (item.type === 'function_call') functionCalls.set(item.call_id, item);
          }
          if (result.usage) {
            totalInputTokens += result.usage.input_tokens;
            totalOutputTokens += result.usage.output_tokens;
            yield {
              type: 'usage',
              usage: {
                promptTokens: result.usage.input_tokens,
                completionTokens: result.usage.output_tokens,
                estimated: false,
              },
              totals: { promptTokens: totalInputTokens, completionTokens: totalOutputTokens },
            };
          }
        } else if (result.type === 'failed') {
          failed = true;
          errorMessage = result.error || '未知错误';
        } else if (result.type === 'incomplete') {
          // 输出截断：透传原因并计数（reasoning/输出共用 max_output_tokens 预算）
          responseItems = result.items || [];
          incompleteCount += 1;
          truncated = true;
          const reason = result.reason === 'max_output_tokens' ? '已达单次输出上限' : '输出被中断';
          yield { type: 'content', content: `\n\n[输出截断：${reason}，继续生成…]` };
        }
      }
    } catch (err) {
      failed = true;
      errorMessage = (err as Error).message;
    }

    // 处理失败
    if (failed) {
      yield {
        type: 'error',
        error: errorMessage,
        errorMeta: classifyError(errorMessage),
      };
      return;
    }

    // 添加响应 items 到 Context Hub
    for (const item of responseItems) {
      contextHub.addResponseItem(item);
    }

    // 如果没有 Function Call，任务完成
    if (functionCalls.size === 0) {
      if (truncated) {
        // 输出被截断：续接（把已有 items 继续发给模型），不走任务完成分支
        truncated = false;
        continue;
      }
      if (planMode) {
        const parsed = parsePlanFromContent(assistantText);
        if (!parsed) {
          yield {
            type: 'error',
            error: '计划模式未生成可执行的编号步骤',
            errorMeta: { kind: 'invalid_request', hint: '请让模型输出编号计划后重试', retryable: true },
          };
          return;
        }
        const structuredPlan = {
          objective: userMessage,
          constraints: [],
          steps: parsed.steps.map((step) => ({
            id: `plan-${contextHub.getRevision()}-${step.index}`,
            description: step.description,
            status: 'pending' as const,
            relatedFiles: [],
            requiredVerification: [],
            evidenceIds: [],
          })),
        };
        await contextHub.commitEvent('plan_created', structuredPlan, options.agentId ?? 'main');
        yield { type: 'plan', plan: structuredPlan.steps.map((step) => step.description) };
        if (!options.onPlanApproval) {
          yield { type: 'done' };
          return;
        }
        if (!(await options.onPlanApproval(structuredPlan))) {
          yield { type: 'content', content: '\n\n[计划未批准]' };
          yield { type: 'done' };
          return;
        }
        planMode = false;
        systemPrompt = getSystemPrompt(false, platformInfo, options.skills, options.activeSkill);
        if (options.rolePrompt) systemPrompt += `\n\n${options.rolePrompt}`;
        tools = [...executableTools.map(t => convertToResponseTool(t)), ...(options.extraTools ?? [])];
        await contextHub.commitEvent('user_message_added', {
          content: '计划已批准。现在严格按计划执行，完成修改与验证后调用 task_complete。',
          attachments: [],
        }, options.agentId ?? 'main');
        continue;
      }
      yield { type: 'done' };
      return;
    }

    // 检查是否超过工具调用限制
    toolCallCount += functionCalls.size;
    if (toolCallCount > maxToolCalls) {
      if (options.requireApprovalAfterLimit !== false) {
        forceApprovalMode = true;
        yield {
          type: 'content',
          content: `\n\n[已达到工具调用上限(${maxToolCalls})，进入审批模式]`,
        };
      } else {
        yield {
          type: 'error',
          error: `工具调用次数超过限制 (${maxToolCalls})`,
          errorMeta: { kind: 'invalid_request', hint: '工具调用次数超过限制', retryable: false },
        };
        return;
      }
    }

    // 执行 Function Calls
    const toolResults: ResponseFunctionCallOutputItem[] = [];

    let taskCompleteAccepted = false;
    for (const fc of functionCalls.values()) {
      // 检查是否是 task_complete
      if (fc.name === 'task_complete') {
        const gateCheck = contextHub.canCompleteTask();
        if (!gateCheck.ok) {
          // 门禁未通过，返回拒绝原因
          toolResults.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: JSON.stringify({
              ok: false,
              error: `任务无法完成：${gateCheck.reasons.join('; ')}`,
            }),
          });
          continue;
        }
      }

      // 检查是否需要审批：强制审批模式 / 内置危险工具 / MCP 策略（approval 配置）
      const needsApproval =
        forceApprovalMode ||
        DANGEROUS_TOOLS.has(fc.name) ||
        (fc.name.startsWith('mcp__') && (await mcpManager.requiresApproval(fc.name)));
      if (needsApproval && onApproval) {
        const toolCall: ToolCall = {
          id: fc.call_id,
          type: 'function',
          function: { name: fc.name, arguments: fc.arguments },
        };

        const approved = await onApproval(toolCall);
        if (!approved) {
          toolResults.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: JSON.stringify({ ok: false, error: '用户拒绝了此操作' }),
          });
          continue;
        }
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(fc.arguments) as Record<string, unknown>;
      } catch {
        toolResults.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ ok: false, error: '工具参数不是有效 JSON' }),
        });
        continue;
      }
      const matchedPlanStep = findPlanStepForTool(contextHub.getContext(), fc.name, args);
      if (matchedPlanStep?.status === 'pending') {
        await contextHub.commitEvent('plan_step_changed', {
          stepId: matchedPlanStep.id,
          status: 'in_progress',
        }, options.agentId ?? 'main');
      }

      // 记录工具调用开始
      await contextHub.commitEvent('tool_call_started', {
        id: fc.call_id,
        name: fc.name,
        args,
        planStepId: matchedPlanStep?.id,
      }, options.agentId ?? 'main');

      yield {
        type: 'tool_call',
        toolCall: {
          id: fc.call_id,
          type: 'function',
          function: { name: fc.name, arguments: fc.arguments },
        },
      };

      // 执行工具
      try {
        // 创建工具执行上下文
        const toolContext: ToolExecutionContext = {
          sessionId,
          agentId: options.agentId ?? 'main',
          contextRevision: contextHub.getRevision(),
          workspaceRevision: contextHub.getWorkspaceRevision(),
          toolCallId: fc.call_id,
          planStepId: matchedPlanStep?.id ?? contextHub.getContext().plan.steps.find(s => s.status === 'in_progress')?.id,
        };

        const result = await invokeTool(fc.name as ToolName, args, cwd, toolContext);

        toolResults.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify(result),
        });

        // 记录工具调用完成
        await contextHub.commitEvent('tool_call_completed', {
          id: fc.call_id,
          result: result.output,
          affectedFiles: result.meta?.kind === 'edit' ? [result.meta.path] : [],
        });

        if (result.meta?.kind === 'command') {
          await contextHub.commitEvent('command_completed', {
            command: result.meta.command,
            exitCode: result.meta.exitCode,
            stdout: result.meta.stdout,
            stderr: result.meta.stderr,
            planStepId: toolContext.planStepId,
          }, options.agentId ?? 'main');
          if (result.meta.exitCode === 0) {
            const verifiedFiles = contextHub.getUnverifiedFiles();
            await contextHub.commitEvent('verification_completed', {
              kind: 'test',
              command: result.meta.command,
              relatedFiles: verifiedFiles,
              planStepIds: toolContext.planStepId ? [toolContext.planStepId] : [],
              ok: true,
              summary: `验证命令通过：${result.meta.command}`,
            }, options.agentId ?? 'main');
          }
        }

        yield {
          type: 'tool_result',
          toolResult: { name: fc.name, toolCallId: fc.call_id, result },
        };

        // 如果是写工具，记录文件修改
        if (result.meta?.kind === 'edit') {
          await contextHub.commitEvent('file_modified', {
            filePath: result.meta.path,
            toolCallId: fc.call_id,
            agentId: options.agentId ?? 'main',
            planStepId: toolContext.planStepId,
          }, options.agentId ?? 'main');
        }
        if (result.ok && matchedPlanStep) {
          await contextHub.commitEvent('plan_step_changed', {
            stepId: matchedPlanStep.id,
            status: 'completed',
          }, options.agentId ?? 'main');
        }
        if (fc.name === 'task_complete' && result.ok) taskCompleteAccepted = true;
      } catch (err) {
        const error = (err as Error).message;
        toolResults.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ ok: false, error }),
        });

        await contextHub.commitEvent('tool_call_completed', {
          id: fc.call_id,
          error,
        });

        yield {
          type: 'tool_result',
          toolResult: { name: fc.name, toolCallId: fc.call_id, result: { ok: false, output: '', error } },
        };
      }
    }

    // 添加工具结果到 Context Hub
    for (const tr of toolResults) {
      contextHub.addResponseItem(tr);
    }
    if (taskCompleteAccepted) {
      yield { type: 'task_complete' };
      yield { type: 'done' };
      return;
    }
  }

  // 超过最大迭代次数
  yield {
    type: 'error',
    error: `超过最大迭代次数 (${maxIterations})`,
    errorMeta: { kind: 'invalid_request', hint: '超过最大迭代次数', retryable: false },
  };
}

// ============================================
// 辅助函数
// ============================================

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

/**
 * 构建 instructions（每轮重新生成）
 */
function buildInstructions(systemPrompt: string, context: TaskContext): string {
  let instructions = systemPrompt;

  // 注入当前目标
  if (context.objective) {
    instructions += `\n\n## 当前目标\n${context.objective}`;
  }

  // 注入约束
  if (context.constraints.length > 0) {
    instructions += `\n\n## 约束\n${context.constraints.map(c => `- ${c}`).join('\n')}`;
  }

  // 注入决策
  if (context.decisions.length > 0) {
    instructions += `\n\n## 已确认的决策\n${context.decisions.map(d => `- ${d.description}: ${d.reason}`).join('\n')}`;
  }

  // 注入计划状态
  if (context.plan.steps.length > 0) {
    const completedSteps = context.plan.steps.filter(s => s.status === 'completed');
    const pendingSteps = context.plan.steps.filter(s => s.status !== 'completed');
    if (completedSteps.length > 0) {
      instructions += `\n\n## 已完成步骤\n${completedSteps.map(s => `- ${s.description}`).join('\n')}`;
    }
    if (pendingSteps.length > 0) {
      instructions += `\n\n## 待完成步骤\n${pendingSteps.map(s => `- [${s.status}] ${s.description}`).join('\n')}`;
    }
  }

  // 注入未验证文件
  if (context.workspace.unverifiedFiles.size > 0) {
    instructions += `\n\n## 未验证文件\n以下文件已修改但未验证：\n${Array.from(context.workspace.unverifiedFiles).map(f => `- ${f}`).join('\n')}`;
  }

  return instructions;
}

/**
 * 将 OpenAITool 转换为 ResponseFunctionTool
 */
function convertToResponseTool(tool: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }): ResponseFunctionTool {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  };
}

/**
 * 处理流式事件
 */
function handleStreamEvent(
  event: ResponseStreamEvent,
): {
  type: 'content' | 'reasoning' | 'function_call' | 'completed' | 'failed' | 'incomplete';
  content?: string;
  functionCall?: ResponseFunctionCallItem;
  items?: ResponseItem[];
  usage?: import('../../shared/responses').ResponseUsage;
  error?: string;
  /** incomplete 截断原因（max_output_tokens / content_filter 等） */
  reason?: string;
} {
  switch (event.type) {
    case 'response.output_text.delta':
      return { type: 'content', content: event.delta };

    case 'response.reasoning_text.delta':
      return { type: 'reasoning', content: event.delta };

    case 'response.output_item.done':
      if (event.item.type !== 'function_call') return { type: 'content', content: '' };
      return {
        type: 'function_call',
        functionCall: event.item,
      };

    case 'response.function_call_arguments.done':
      return { type: 'content', content: '' };

    case 'response.completed':
      return {
        type: 'completed',
        items: event.response.output,
        usage: event.response.usage,
      };

    case 'response.failed':
      return {
        type: 'failed',
        error: event.error?.message || '请求失败',
      };

    case 'response.incomplete':
      return {
        type: 'incomplete',
        items: event.response.output,
        reason: event.incomplete_details?.reason,
      };

    default:
      return { type: 'content', content: '' };
  }
}

/**
 * 分类错误
 */
function classifyError(error: string): { kind: ErrorKind; hint: string; retryable: boolean } {
  if (error.includes('auth') || error.includes('key') || error.includes('401')) {
    return { kind: 'auth', hint: 'API Key 无效或已过期', retryable: false };
  }
  if (error.includes('rate') || error.includes('429')) {
    return { kind: 'rate_limit', hint: '请求频率超限，请稍后重试', retryable: true };
  }
  if (error.includes('context') || error.includes('too long')) {
    return { kind: 'context_too_long', hint: '上下文过长，请压缩后再试', retryable: false };
  }
  if (error.includes('timeout') || error.includes('idle')) {
    return { kind: 'idle_timeout', hint: '请求超时，请重试', retryable: true };
  }
  if (error.includes('abort') || error.includes('cancel')) {
    return { kind: 'user_aborted', hint: '请求已取消', retryable: false };
  }
  return { kind: 'unknown', hint: error, retryable: false };
}
