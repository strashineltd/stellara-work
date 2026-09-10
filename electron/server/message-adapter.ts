/**
 * 远端消息 → MessageRow 适配。
 *
 * 纯函数：不依赖 Electron / 网络 / 计时器，便于单测。
 * - user / assistant 的 text parts 拼接为 content；reasoning 与未知 part 忽略。
 * - assistant 的 tool parts 汇总为 toolCalls JSON（含未终态的 call）。
 * - completed / error 的 tool parts 额外生成独立 tool 行。
 * - 空 assistant（无文本且无工具）跳过；仅有 tool 时保留 content 为空的 assistant 行与 toolCalls，
 *   其终态工具仍生成 tool 行；position 从 0 递增。
 * - 缺字段（parts / time / state.input）安全降级，不抛错。
 */

import type { MessageRow } from '@shared/ipc';
import type { RemoteMessage, RemotePart, RemoteTextPart, RemoteToolPart } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function isTextPart(part: RemotePart): part is RemoteTextPart {
  return part.type === 'text' && typeof part['text'] === 'string';
}

function isToolPart(part: RemotePart): part is RemoteToolPart {
  return part.type === 'tool' && typeof part['callID'] === 'string' && typeof part['tool'] === 'string';
}

export function remoteMessagesToRows(localSessionId: string, messages: RemoteMessage[]): MessageRow[] {
  const rows: MessageRow[] = [];
  const fallbackCreatedAt = Date.now();

  for (const message of messages ?? []) {
    const info = isRecord(message) && isRecord(message.info) ? message.info : undefined;
    if (!info) continue;
    const role = readString(info['role']);
    if (role !== 'user' && role !== 'assistant') continue;

    const time = isRecord(info['time']) ? info['time'] : undefined;
    const createdAt = readNumber(time?.['created']) ?? fallbackCreatedAt;
    const parts = Array.isArray(message.parts) ? message.parts : [];

    const text = parts
      .filter(isTextPart)
      .map((part) => part.text)
      .join('');

    const toolParts = parts.filter(isToolPart);
    const toolCalls = toolParts.map((part) => {
      const state = isRecord(part.state) ? part.state : undefined;
      return {
        id: part.callID,
        type: 'function' as const,
        function: {
          name: part.tool,
          arguments: JSON.stringify(state?.['input'] ?? {}) ?? '{}',
        },
      };
    });

    if (role === 'user') {
      rows.push({ sessionId: localSessionId, position: rows.length, role: 'user', content: text, createdAt });
      continue;
    }

    if (text !== '' || toolCalls.length > 0) {
      rows.push({
        sessionId: localSessionId,
        position: rows.length,
        role: 'assistant',
        content: text,
        ...(toolCalls.length > 0 ? { toolCalls: JSON.stringify(toolCalls) } : {}),
        createdAt,
      });
    }

    for (const part of toolParts) {
      const state = isRecord(part.state) ? part.state : undefined;
      const status = readString(state?.['status']);
      if (status !== 'completed' && status !== 'error') continue;
      const output = stringifyValue(state?.['output']);
      const content =
        output ?? (status === 'error' ? `Error: ${stringifyValue(state?.['error']) ?? 'Unknown error'}` : '');
      rows.push({
        sessionId: localSessionId,
        position: rows.length,
        role: 'tool',
        content,
        toolCallId: part.callID,
        toolName: part.tool,
        meta: JSON.stringify({ ok: status === 'completed' }),
        createdAt,
      });
    }
  }

  return rows;
}
