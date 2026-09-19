/**
 * 旧会话历史一次性迁入 Context Hub（两条 loop 共用）。
 * 仅当 hub 为空时执行；tool_calls / tool 输出完整迁移。
 */
import type { ContextHub } from '../../context/context-hub';

export interface LegacyHistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ReadonlyArray<{ id: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function migrateHistoryToHub(hub: ContextHub, history?: LegacyHistoryMessage[]): void {
  if (!history?.length) return;
  if (hub.getResponseItems().length > 0) return;

  for (const message of history) {
    if ((message.role === 'user' || message.role === 'assistant') && message.content) {
      hub.addResponseItem({
        type: 'message',
        role: message.role,
        content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text: message.content }],
        status: 'completed',
      });
    }
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        hub.addResponseItem({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: 'completed',
        });
      }
    }
    if (message.role === 'tool' && message.tool_call_id) {
      hub.addResponseItem({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: message.content,
      });
    }
  }
}
