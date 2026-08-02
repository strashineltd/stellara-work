import type { OpenAITool, ToolResult } from '../../../shared/ipc';
import type { TaskCompleteArgs } from '../../../shared/ipc';

export async function taskComplete(args: TaskCompleteArgs, _cwd: string): Promise<ToolResult> {
  return {
    ok: true,
    output: args.summary ? `✅ 任务完成：${args.summary}` : '✅ 任务完成。',
  };
}

export const taskCompleteTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'task_complete',
      description: '当你认为任务已完成时调用此工具。可选提供任务完成摘要。调用后 agent 将结束循环。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '任务完成摘要：做了什么、改了哪些文件、测试结果如何' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];
