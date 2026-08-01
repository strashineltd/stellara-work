import type { ModelConfig, ChatMessage, ChatStreamEvent, ToolCall } from '../../shared/ipc';
import { OpenAICompatClient } from '../llm/openai-compat';
import { allTools, planModeTools, invokeTool } from './tools';
import { getSystemPrompt } from './plan';

export interface AgentLoopOptions {
  model: ModelConfig;
  cwd: string;
  /** 之前轮次的消息（不含 system；不含本轮的 user）— 多轮上下文 */
  history?: ChatMessage[];
  /** Plan 模式：agent 只能调只读工具 */
  planMode?: boolean;
  maxIterations?: number;
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

/**
 * Agent 循环：plan → tool → verify
 *
 * 流式 yield ChatStreamEvent 给调用方。
 * 每次 LLM 响应后检查 tool_calls，调度执行，把结果回给 LLM，继续迭代。
 * 最多迭代 maxIterations 次（默认 10），防止死循环。
 */
export async function* runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const { model, cwd, history = [], planMode: initialPlanMode = false, maxIterations = 200, onApproval } = options;
  let planMode = initialPlanMode;

  const client = new OpenAICompatClient(model);
  // 拼消息：system（按 planMode 切） + 之前轮次 + 本轮 user
  const prior = history.filter((m) => m.role !== 'system');
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(planMode) },
    ...prior,
    { role: 'user', content: userMessage },
  ];

  // 死循环检测：连续失败同一个 tool
  let lastFailedTool: string | null = null;
  let lastFailedToolCount = 0;
  let iteration = 0;

  // Plan 批准门禁：本 run 是否已产出 READY TO EXECUTE 计划（防重试/多轮绕过门禁）
  let planGateDone = false;

  while (iteration < maxIterations) {
    iteration++;

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
      undefined,
    );

    // 累积这一轮的响应
    let assistantContent = '';
    const toolCalls: ToolCall[] = [];

    for await (const event of stream) {
      if (event.type === 'content' && event.content) {
        assistantContent += event.content;
        yield event;
      } else if (event.type === 'tool_call' && event.toolCall) {
        toolCalls.push(event.toolCall);
      } else if (event.type === 'error') {
        yield event;
        return;
      } else if (event.type === 'done') {
        // done
      }
    }

    // Plan 模式：从 LLM 输出中提取结构化计划
    if (planMode && assistantContent && !planGateDone) {
      const parsed = parsePlanFromContent(assistantContent);
      if (parsed) {
        options.plan = parsed;
        yield { type: 'plan', plan: parsed.steps.map((s) => s.description) };
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
              content: `${getSystemPrompt(false, options.skills, options.activeSkill)}\n\n${formatPlanProgress(parsed)}`,
            };
          }
          if (toolCalls.length > 0) {
            messages.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });
          } else {
            messages.push({ role: 'assistant', content: assistantContent });
          }
          continue; // 下一轮以 build 工具集继续执行
        } else if (parsed.readyToExecute) {
          planGateDone = true;
          yield { type: 'plan_ready', plan: parsed.steps.map((s) => s.description) };
        }
      }
    }

    // 没有 tool_call → 任务结束
    if (toolCalls.length === 0) {
      yield { type: 'done' };
      return;
    }

    // 把 assistant 消息加入历史
    messages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls,
    });

    // 依次执行 tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolArgs: unknown;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: '参数 JSON 解析失败' } },
        };
        continue;
      }

      // Plan 模式检查
      if (planMode && !isReadOnlyTool(toolName)) {
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: 'Plan 模式禁止调用此工具' } },
        };
        continue;
      }

      // 危险操作需要批准
      if (isDangerousTool(toolName) && onApproval) {
        const approved = await onApproval(toolCall);
        if (!approved) {
          yield {
            type: 'tool_result',
            toolResult: { name: toolName, toolCallId: toolCall.id, result: { ok: false, error: '用户拒绝' } },
          };
          continue;
        }
      }

      // 执行
      const result = await invokeTool(
        toolName as Parameters<typeof invokeTool>[0],
        toolArgs as Parameters<typeof invokeTool>[1],
        cwd,
      );

      yield {
        type: 'tool_result',
        toolResult: { name: toolName, toolCallId: toolCall.id, result },
      };

      // 把 tool 结果加到消息历史
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: result.ok ? result.output : `Error: ${result.error ?? '未知错误'}`,
      });

      // 死循环检测：连续 3 次同一个 tool 失败 → 提前 break
      if (!result.ok) {
        if (lastFailedTool === toolName) {
          lastFailedToolCount++;
          if (lastFailedToolCount >= 3) {
            yield {
              type: 'error',
              error: `工具「${toolName}」连续 3 次失败（最后错误：${result.error ?? '未知'}）。可能是参数错误或环境问题，agent 已停止。`,
            };
            return;
          }
        } else {
          lastFailedTool = toolName;
          lastFailedToolCount = 1;
        }
      } else {
        lastFailedTool = null;
        lastFailedToolCount = 0;
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

function isReadOnlyTool(name: string): boolean {
  return name === 'read_file' || name === 'search_files';
}

function isDangerousTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file' || name === 'run_command';
}
