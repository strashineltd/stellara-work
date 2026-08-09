import type { ModelConfig, ChatMessage, ChatStreamEvent, ToolCall, SkillDef } from '../../shared/ipc';
import { OpenAICompatClient } from '../llm/openai-compat';
import { allTools, planModeTools, invokeTool } from './tools';
import { getSystemPrompt, type AgentPlatformInfo } from './plan';
import { compressIfNeeded, type CompressionConfig } from './compress';
import { parsePlanFromContent, formatPlanProgress, tryMatchToolToPlanStep, type Plan } from './plan-parser';
import { injectVerificationPrompt, generateFailureGuidance } from './verification';

export interface AgentLoopOptions {
  model: ModelConfig;
  cwd: string;
  /** 运行平台信息（注入 system prompt，保证命令输出与平台一致）；缺省用本机平台 */
  platform?: AgentPlatformInfo;
  /** 之前轮次的消息（不含 system；不含本轮的 user）— 多轮上下文 */
  history?: ChatMessage[];
  /** Plan 模式：agent 只能调只读工具 */
  planMode?: boolean;
  /** 从 plan mode 传入的结构化计划（build mode 用其追踪进度） */
  plan?: Plan | null;
  maxIterations?: number;
  /** 上下文压缩配置；不传则用默认（24K token 阈值 + 保留最近 12 轮） */
  compression?: Partial<CompressionConfig>;
  /** skills/ 目录下加载的技能定义（注入 system prompt） */
  skills?: SkillDef[];
  /** /skill-name 精确调用的单个 skill（有值时只注入该 skill 的 prompt，不列其他 skill） */
  activeSkill?: SkillDef;
  /** 中断信号（abort controller） */
  signal?: AbortSignal;
  /**
   * 危险工具被调用前的批准回调。
   * 返回 true 放行；false 拒绝（agent 会收到"用户拒绝"错误并继续）。
   *
   * 实现方：通常是主进程 → 通过 IPC 让 renderer 弹 modal → 用户回应 → resolve。
   * 必须实现超时，否则 agent 会卡死。
   */
  onApproval?: (toolCall: ToolCall) => Promise<boolean>;
  /**
   * Plan 批准回调：plan 模式产出 READY TO EXECUTE 计划后暂停，等待用户批准。
   * 返回 true 则切到 build 模式继续执行；返回 false 则 yield user_aborted 错误并停止。
   *
   * 实现方：通常是主进程 → 通过 IPC 让 renderer 弹批准 modal → 用户回应 → resolve。
   * 必须实现超时，否则 agent 会卡死。
   */
  onPlanApproval?: (plan: Plan) => Promise<boolean>;
}

// 只读工具集合（可并行执行）
const READ_ONLY_TOOLS = new Set(['read_file', 'search_files', 'search_content', 'list_files', 'git_status', 'git_diff', 'git_log']);

// 危险工具集合（需要审批）
const DANGEROUS_TOOLS = new Set(['write_file', 'edit_file', 'run_command', 'web_fetch']);

/**
 * Agent 循环：plan → tool → verify
 *
 * 流式 yield ChatStreamEvent 给调用方。
 * 每次 LLM 响应后检查 tool_calls，调度执行，把结果回给 LLM，继续迭代。
 * 最多迭代 maxIterations 次（默认 200），防止死循环。
 *
 * 增强：
 * - 只读工具并行执行
 * - Plan 步骤状态实时追踪
 * - 工具调用缓存（per-iteration）
 */
export async function* runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const { model, cwd, history = [], planMode: initialPlanMode = false, maxIterations = 200, onApproval } = options;
  let planMode = initialPlanMode;

  const signal = options.signal;
  const client = new OpenAICompatClient(model);

  // Memory OS: 检索相关记忆并注入 system prompt
  const platformInfo = options.platform ?? { platform: process.platform, arch: process.arch };
  let systemPrompt = getSystemPrompt(planMode, platformInfo, options.skills, options.activeSkill);
  if (!planMode) {
    try {
      const { retrieveMemoriesForInjection } = await import('../memory/memory-injector');
      const { memories, promptBlock } = await retrieveMemoriesForInjection(userMessage, {
        maxMemories: 10,
      });
      if (promptBlock) {
        systemPrompt += `\n\n${promptBlock}`;
        yield {
          type: 'memory_context',
          memories: memories.map((m) => ({ kind: m.kind, content: m.content, importance: m.importance, source: m.source })),
        };
      }
    } catch {
      // 记忆注入失败不影响 agent 运行
    }
  }

  // 拼消息：system（按 planMode 切） + 之前轮次 + 本轮 user
  const prior = history.filter((m) => m.role !== 'system');
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...prior,
    { role: 'user', content: userMessage },
  ];

  // 死循环检测：per-turn 连续任意 tool 失败
  let consecutiveFailures = 0;
  let iteration = 0;

  // 本次 run 的累计 token 用量与工具调用次数（跨轮累计）
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const toolCallCounts: Record<string, number> = {};

  // Plan 批准门禁：本 run 是否已产出 READY TO EXECUTE 计划（防重试/多轮绕过门禁）
  let planGateDone = false;
  // 是否已 yield 过 plan 事件（多轮计划只向调用方发一次）
  let planEmitted = false;

  // 任务预算限制
  const MAX_TOOL_CALLS = 50;
  const MAX_RUNTIME_MS = 10 * 60 * 1000; // 10 分钟
  const MAX_COMMANDS = 20;
  const startTime = Date.now();
  let totalToolCalls = 0;
  let totalCommands = 0;

  while (iteration < maxIterations) {
    if (signal?.aborted) break;
    iteration++;
    consecutiveFailures = 0; // 每轮重置

    // 工具调用缓存：per-iteration，只读工具结果缓存
    const toolCache = new Map<string, { ok: boolean; output: string; error?: string }>();

    // 上下文压缩：每次 LLM 调用前判定，超阈值则压缩最早一批消息
    const compressResult = await compressIfNeeded(messages, client, options.compression);
    if (compressResult.compressed) {
      messages = compressResult.messages;
      yield {
        type: 'summary',
        tokensBefore: compressResult.tokensBefore,
        tokensAfter: compressResult.tokensAfter,
        compressedCount: compressResult.compressedCount ?? 0,
        summary: compressResult.summary ?? '',
      };
    }

    // 调 LLM
    const tools = planMode ? planModeTools : allTools;
    const stream = client.chat(
      {
        model: model.model,
        messages,
        tools,
        tool_choice: 'auto',
        stream: true,
      },
      signal,
    );

    // 累积这一轮的响应
    let assistantContent = '';
    const toolCalls: ToolCall[] = [];
    let lastUsage: ChatStreamEvent['usage'] | undefined;

    for await (const event of stream) {
      if (event.type === 'content' && event.content) {
        assistantContent += event.content;
        yield event;
      } else if (event.type === 'tool_call' && event.toolCall) {
        toolCalls.push(event.toolCall);
      } else if (event.type === 'usage' && event.usage) {
        lastUsage = event.usage;
        totalPromptTokens += event.usage.promptTokens;
        totalCompletionTokens += event.usage.completionTokens;
      } else if (event.type === 'error') {
        yield event;
        return;
      } else if (event.type === 'done') {
        // done
      }
    }

    // 每轮至少 yield 一次 usage（LLM 未上报时用估算 0 兜底）；totals/toolCounts 为本次 run 累计值
    yield {
      type: 'usage',
      usage: lastUsage ?? { promptTokens: 0, completionTokens: 0, estimated: true },
      totals: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
      toolCounts: { ...toolCallCounts },
    };

    // Plan 模式：从 LLM 输出中提取结构化计划
    if (planMode && assistantContent && !planGateDone) {
      const parsed = parsePlanFromContent(assistantContent);
      if (parsed) {
        options.plan = parsed;
        if (!planEmitted) {
          planEmitted = true;
          yield { type: 'plan', plan: parsed.steps.map((s) => s.description) };
        }
        if (parsed.readyToExecute && options.onPlanApproval) {
          const approved = await options.onPlanApproval(parsed);
          if (!approved) {
            yield {
              type: 'error',
              error: '计划已被拒绝，任务已停止。可以重新描述需求后再试。',
              errorMeta: {
                kind: 'user_aborted',
                hint: '你拒绝了这份计划，任务已停止。',
                action: 'retry',
                retryable: true,
              },
            };
            return;
          }
          planGateDone = true;
          yield { type: 'plan_ready', plan: parsed.steps.map((s) => s.description) };

          // 批准后切换到 build 模式：重建 system prompt 并注入计划进度
          planMode = false;
          if (messages[0]?.role === 'system') {
            messages[0] = {
              role: 'system',
              content: `${getSystemPrompt(false, platformInfo, options.skills, options.activeSkill)}\n\n${formatPlanProgress(parsed)}`,
            };
          }
          if (toolCalls.length === 0) {
            messages.push({ role: 'assistant', content: assistantContent });
            continue; // 纯文本计划：下一轮以 build 工具集继续执行
          }
        } else if (parsed.readyToExecute) {
          planGateDone = true;
          yield { type: 'plan_ready', plan: parsed.steps.map((s) => s.description) };
        }
      }
    }

    // Build 模式 + 有计划：仅在首轮注入进度上下文到 system message
    if (!planMode && options.plan && messages[0]?.role === 'system' && iteration === 1) {
      const progressText = formatPlanProgress(options.plan);
      const basePrompt = messages[0].content.replace(/\n\n当前计划进度：[\s\S]*$/, '');
      messages[0] = { ...messages[0], content: `${basePrompt}\n\n${progressText}` };
    }

    // task_complete 检测
    const hasTaskComplete = toolCalls.some((tc) => tc.function.name === 'task_complete');

    // 没有 tool_call → 任务结束
    if (toolCalls.length === 0 || signal?.aborted) {
      if (hasTaskComplete) {
        yield { type: 'task_complete' };
      }
      yield { type: 'done' };
      return;
    }

    // LLM 只调了 task_complete → 立即结束
    if (hasTaskComplete && toolCalls.length === 1) {
      yield { type: 'task_complete' };
      yield { type: 'done' };
      return;
    }

    // 把 assistant 消息加入历史
    messages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls,
    });

    // 分类 tool calls：只读 vs 需审批/写入
    const readOnlyCalls: ToolCall[] = [];
    const writeCalls: ToolCall[] = [];
    for (const tc of toolCalls) {
      if (READ_ONLY_TOOLS.has(tc.function.name) && !planMode) {
        readOnlyCalls.push(tc);
      } else {
        writeCalls.push(tc);
      }
    }

    // 任务预算检查
    const elapsed = Date.now() - startTime;
    if (totalToolCalls >= MAX_TOOL_CALLS) {
      yield { type: 'error', error: `达到工具调用上限 (${MAX_TOOL_CALLS})，任务已停止。请简化需求后重试。` };
      return;
    }
    if (elapsed >= MAX_RUNTIME_MS) {
      yield { type: 'error', error: `达到运行时间上限 (${Math.round(MAX_RUNTIME_MS / 60000)} 分钟)，任务已停止。` };
      return;
    }
    const pendingCalls = readOnlyCalls.length + writeCalls.length;
    if (totalToolCalls + pendingCalls > MAX_TOOL_CALLS) {
      yield { type: 'error', error: `剩余工具调用将超过上限 (${totalToolCalls}+${pendingCalls} > ${MAX_TOOL_CALLS})，任务已停止。` };
      return;
    }

    // 并行执行只读工具
    if (readOnlyCalls.length > 0) {
      // Plan 步骤追踪：执行前标记 in_progress
      if (options.plan) {
        for (const toolCall of readOnlyCalls) {
          let toolArgs: Record<string, unknown> = {};
          try { toolArgs = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
          const matched = tryMatchToolToPlanStep(options.plan, toolCall.function.name, toolArgs);
          if (matched && matched.status === 'pending') {
            matched.status = 'in_progress';
          }
        }
        yield { type: 'plan_progress', planSteps: options.plan.steps.map((s) => ({ description: s.description, status: s.status })) };
      }

      const results = await Promise.all(
        readOnlyCalls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          let toolArgs: unknown;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch (err) {
            return {
              toolCall,
              result: { ok: false, output: '', error: `参数 JSON 解析失败 — ${err instanceof Error ? err.message : String(err)}` },
            };
          }

          // 检查缓存
          const cacheKey = `${toolName}:${JSON.stringify(toolArgs)}`;
          const cached = toolCache.get(cacheKey);
          if (cached) {
            return { toolCall, result: cached, fromCache: true };
          }

          const result = await invokeTool(
            toolName as Parameters<typeof invokeTool>[0],
            toolArgs as Parameters<typeof invokeTool>[1],
            cwd,
          );

          // 缓存只读结果
          if (result.ok) {
            toolCallCounts[toolName] = (toolCallCounts[toolName] ?? 0) + 1;
            toolCache.set(cacheKey, { ok: result.ok, output: result.output, error: result.error });
          }

          return { toolCall, result };
        }),
      );

      // yield 所有结果并更新消息
      for (const { toolCall, result } of results) {
        const toolName = toolCall.function.name;
        totalToolCalls++;
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, toolCallId: toolCall.id, result },
        };
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: result.ok ? result.output : `Error: ${result.error ?? '未知错误'}`,
        });

        // Plan 步骤追踪
        if (options.plan && result.ok) {
          const matched = tryMatchToolToPlanStep(options.plan, toolName, JSON.parse(toolCall.function.arguments));
          if (matched && matched.status !== 'completed') {
            matched.status = 'completed';
            yield { type: 'plan_progress', planSteps: options.plan.steps.map((s) => ({ description: s.description, status: s.status })) };
          }
        }
      }
    }

    // 串行执行写入/shell 工具
    for (const toolCall of writeCalls) {
      const toolName = toolCall.function.name;
      let toolArgs: unknown;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch (err) {
        const errorMsg = `参数 JSON 解析失败 — ${err instanceof Error ? err.message : String(err)}`;
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: errorMsg } },
        };
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: `Error: ${errorMsg}`,
        });
        continue;
      }

      // Plan 模式检查
      if (planMode && !READ_ONLY_TOOLS.has(toolName)) {
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: 'Plan 模式禁止调用此工具' } },
        };
        continue;
      }

      // 危险操作需要批准
      if (DANGEROUS_TOOLS.has(toolName)) {
        if (!onApproval) {
          yield {
            type: 'tool_result',
            toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: '危险工具未提供 onApproval，默认拒绝' } },
          };
          continue;
        }
        if (signal?.aborted) break;
        const approved = await onApproval(toolCall);
        if (!approved) {
          yield {
            type: 'tool_result',
            toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: '用户拒绝' } },
          };
          continue;
        }
      }

      // Plan 步骤追踪：执行前标记 in_progress
      if (options.plan) {
        const matched = tryMatchToolToPlanStep(options.plan, toolName, toolArgs as Record<string, unknown>);
        if (matched && matched.status === 'pending') {
          matched.status = 'in_progress';
          yield { type: 'plan_progress', planSteps: options.plan.steps.map((s) => ({ description: s.description, status: s.status })) };
        }
      }

      // 执行
      const result = await invokeTool(
        toolName as Parameters<typeof invokeTool>[0],
        toolArgs as Parameters<typeof invokeTool>[1],
        cwd,
      );

      totalToolCalls++;
      if (toolName === 'run_command') totalCommands++;
      if (result.ok) toolCallCounts[toolName] = (toolCallCounts[toolName] ?? 0) + 1;

      // 命令数检查
      if (totalCommands > MAX_COMMANDS) {
        yield { type: 'error', error: `达到命令执行上限 (${MAX_COMMANDS})，任务已停止。` };
        return;
      }

      yield {
        type: 'tool_result',
        toolResult: { name: toolName, toolCallId: toolCall.id, result },
      };

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: result.ok ? result.output : `Error: ${result.error ?? '未知错误'}`,
      });

      // 写入后清除相关缓存
      if (result.ok && (toolName === 'write_file' || toolName === 'edit_file')) {
        const filePath = (toolArgs as { path?: string })?.path;
        if (filePath) {
          for (const key of toolCache.keys()) {
            if (key.includes(filePath)) toolCache.delete(key);
          }
        }
      }

      // Plan 步骤追踪
      if (options.plan && result.ok) {
        const matched = tryMatchToolToPlanStep(options.plan, toolName, toolArgs as Record<string, unknown>);
        if (matched && matched.status !== 'completed') {
          matched.status = 'completed';
          yield { type: 'plan_progress', planSteps: options.plan.steps.map((s) => ({ description: s.description, status: s.status })) };
        }
      }

      // 验证：写/编辑文件成功后注入重读验证
      if ((toolName === 'write_file' || toolName === 'edit_file') && result.ok) {
        const verifiedMessages = injectVerificationPrompt(messages, toolCall);
        if (verifiedMessages !== messages) {
          messages = verifiedMessages;
          yield { type: 'verify', phase: 'post_edit', target: (toolArgs as { path?: string }).path };
        }
      }

      // 命令失败引导
      if (toolName === 'run_command' && !result.ok) {
        const guidance = generateFailureGuidance(toolName, { ok: false, error: result.error, output: result.output });
        if (guidance) {
          messages.push({ role: 'system', content: guidance });
        }
      }

      // 死循环检测
      if (!result.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) {
          yield {
            type: 'error',
            error: `连续 ${consecutiveFailures} 次工具调用失败（最后错误：${toolName} — ${result.error ?? '未知'}）。可能是参数错误、环境问题或权限不足，agent 已停止。`,
          };
          return;
        }
      } else {
        consecutiveFailures = 0;
      }
    }
  }

  if (iteration >= maxIterations) {
    yield {
      type: 'error',
      error: `达到最大迭代次数 ${maxIterations}，任务太复杂或模型陷入循环。可以换个更明确的提示，或在「计划」模式下先讨论方案。`,
    };
  }
}
