/**
 * Responses API Agent Loop
 *
 * 替代原有的 runAgentLoop（基于 Chat Completions），使用 Responses API。
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
import { getSystemPrompt, type AgentPlatformInfo } from './plan';
import { ContextHub, type TaskContext, type PlanStep } from '../context/context-hub';

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
  /** 达到 maxToolCalls 上限后转为强制审批模式 */
  requireApprovalAfterLimit?: boolean;
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

  // 注入记忆
  try {
    const { retrieveMemoriesForInjection } = await import('../memory/memory-injector');
    const { memories, promptBlock } = await retrieveMemoriesForInjection(userMessage, {
      maxMemories: 10,
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
  const tools = planMode
    ? planModeTools.map(t => convertToResponseTool(t))
    : [...allTools.map(t => convertToResponseTool(t)), ...(options.extraTools ?? [])];

  // 主循环
  while (iteration < maxIterations) {
    iteration++;

    // 检查中断信号
    if (signal?.aborted) {
      yield { type: 'error', error: '用户中断', errorMeta: { kind: 'user_aborted', hint: '请求已取消', retryable: false } };
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

    // 调用模型
    let responseItems: ResponseItem[] = [];
    let functionCalls: ResponseFunctionCallItem[] = [];
    let failed = false;
    let errorMessage = '';

    try {
      for await (const event of client.createStream(request, signal)) {
        // 处理流式事件
        const result = handleStreamEvent(event);

        if (result.type === 'content') {
          yield { type: 'content', content: result.content };
        } else if (result.type === 'reasoning') {
          // reasoning 事件（UI 可选展示）
        } else if (result.type === 'function_call') {
          functionCalls.push(result.functionCall!);
        } else if (result.type === 'completed') {
          responseItems = result.items || [];
        } else if (result.type === 'failed') {
          failed = true;
          errorMessage = result.error || '未知错误';
        } else if (result.type === 'incomplete') {
          // 输出截断
          yield { type: 'content', content: '\n\n[输出截断]' };
          responseItems = result.items || [];
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
    if (functionCalls.length === 0) {
      yield { type: 'done' };
      return;
    }

    // 检查是否超过工具调用限制
    toolCallCount += functionCalls.length;
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

    for (const fc of functionCalls) {
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

      // 检查是否需要审批
      const needsApproval = forceApprovalMode || DANGEROUS_TOOLS.has(fc.name);
      if (needsApproval && onApproval) {
        const toolCall: ToolCall = {
          id: fc.call_id,
          type: 'function',
          function: { name: fc.name, arguments: fc.arguments },
        };

        yield {
          type: 'approval_required',
          approval: {
            id: fc.call_id,
            toolName: fc.name,
            args: fc.arguments,
            toolCallId: fc.call_id,
          },
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

      // 记录工具调用开始
      await contextHub.commitEvent('tool_call_started', {
        id: fc.call_id,
        name: fc.name,
        args: JSON.parse(fc.arguments),
      });

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
        const args = JSON.parse(fc.arguments);

        // 创建工具执行上下文
        const toolContext: ToolExecutionContext = {
          sessionId,
          agentId: 'main',
          contextRevision: contextHub.getRevision(),
          workspaceRevision: contextHub.getWorkspaceRevision(),
          toolCallId: fc.call_id,
          planStepId: contextHub.getContext().plan.steps.find(s => s.status === 'in_progress')?.id,
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

        yield {
          type: 'tool_result',
          toolResult: { name: fc.name, toolCallId: fc.call_id, result },
        };

        // 如果是写工具，记录文件修改
        if (result.meta?.kind === 'edit') {
          await contextHub.commitEvent('file_modified', {
            filePath: result.meta.path,
            toolCallId: fc.call_id,
            agentId: 'main',
          });
        }
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
  error?: string;
} {
  switch (event.type) {
    case 'response.output_text.delta':
      return { type: 'content', content: event.delta };

    case 'response.reasoning_text.delta':
      return { type: 'reasoning' };

    case 'response.function_call_arguments.done':
      return {
        type: 'function_call',
        functionCall: {
          type: 'function_call',
          call_id: event.call_id || event.item_id,
          name: '', // 需要从 output_item.done 获取
          arguments: event.arguments,
        },
      };

    case 'response.completed':
      return {
        type: 'completed',
        items: event.response.output,
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
