import type { ModelConfig, ChatMessage, ChatStreamEvent, ToolCall } from '../../shared/ipc';
import { OpenAICompatClient } from '../llm/openai-compat';
import { allTools, planModeTools, invokeTool } from './tools';
import { getSystemPrompt } from './plan';

export interface AgentLoopOptions {
  model: ModelConfig;
  cwd: string;
  /** 之前轮次的消息（不含 system；不含本轮的 user）— 多轮上下文 */
  history?: ChatMessage[];
  maxIterations?: number;
  onApproval?: (toolCall: ToolCall) => Promise<boolean>;
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
  const { model, cwd, history = [], maxIterations = 10, onApproval } = options;

  const client = new OpenAICompatClient(model);
  // 拼消息：system + 之前轮次（剔除 system 与 tool_calls/tool 名） + 本轮 user
  // renderer 发的 history 已经不含 system；这里也防御一下
  const prior = history.filter((m) => m.role !== 'system');
  const messages: ChatMessage[] = [
    { role: 'system', content: getSystemPrompt(false) },
    ...prior,
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  let planMode = false;

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
          toolResult: { name: toolName, result: { ok: false, error: '参数 JSON 解析失败' } },
        };
        continue;
      }

      // Plan 模式检查
      if (planMode && !isReadOnlyTool(toolName)) {
        yield {
          type: 'tool_result',
          toolResult: { name: toolName, result: { ok: false, error: 'Plan 模式禁止调用此工具' } },
        };
        continue;
      }

      // 危险操作需要批准
      if (isDangerousTool(toolName) && onApproval) {
        const approved = await onApproval(toolCall);
        if (!approved) {
          yield {
            type: 'tool_result',
            toolResult: { name: toolName, result: { ok: false, error: '用户拒绝' } },
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
        toolResult: { name: toolName, result },
      };

      // 把 tool 结果加到消息历史
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: result.ok ? result.output : `Error: ${result.error ?? '未知错误'}`,
      });
    }
  }

  yield { type: 'error', error: `达到最大迭代次数 ${maxIterations}，强制结束` };
}

function isReadOnlyTool(name: string): boolean {
  return name === 'read_file' || name === 'search_files';
}

function isDangerousTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file' || name === 'run_command';
}
