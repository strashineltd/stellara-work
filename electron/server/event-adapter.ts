/**
 * 远端 SSE 事件 → ChatStreamEvent 适配。
 *
 * 纯逻辑实现：不依赖 Electron / 网络 / 计时器 / 日志，便于单测。
 * - 文本与推理按 `${sessionID}:${partID}` 跟踪**已发给渲染器的文本**（emitted）：
 *   message.part.delta（真实 1.18 主通道，权威流）无条件输出并追加到 emitted；
 *   message.part.updated 全文快照仅在以 emitted 为前缀且更长时输出未见后缀并前移 emitted，
 *   相等时无事件；截断/分叉时忽略且不重置 emitted（渲染始终追加，保持一致性）。
 * - 工具状态：pending → tool_call（每个 call 仅一次）、running → 无事件、
 *   completed/error → tool_result（每个 call 首个终态输出一次，重复/后续终态快照跳过；
 *   未见过的历史 call 也输出，保证容错）。
 * - 未知事件与缺字段均安全降级为空数组，不抛错。
 */

import type { ChatStreamEvent } from '@shared/ipc';
import type { RemoteEvent } from './types';

export interface AdaptedEvents {
  sessionID?: string;
  events: ChatStreamEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringifyArgs(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === undefined) return '{}';
  return JSON.stringify(input) ?? '{}';
}

function readErrorMessage(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (isRecord(raw)) {
    const message = readString(raw.message);
    if (message !== undefined) return message;
    const json = JSON.stringify(raw);
    return json === undefined ? undefined : json;
  }
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

export class EventAdapter {
  private readonly partText = new Map<string, string>();
  private readonly emittedTools = new Set<string>();
  private readonly emittedResults = new Set<string>();

  handle(event: RemoteEvent): AdaptedEvents {
    const properties = isRecord(event.properties) ? event.properties : undefined;
    const part = properties && isRecord(properties.part) ? properties.part : undefined;
    const info = properties && isRecord(properties.info) ? properties.info : undefined;
    const sessionID =
      readString(part?.sessionID) ?? readString(properties?.sessionID) ?? readString(info?.sessionID);

    switch (event.type) {
      case 'message.part.updated':
        return { sessionID, events: this.handlePart(part, sessionID) };
      case 'message.part.delta':
        return { sessionID, events: this.handlePartDelta(properties, sessionID) };
      case 'permission.updated':
      case 'permission.asked':
        return { sessionID, events: this.handlePermission(properties) };
      case 'session.idle':
        return { sessionID, events: [{ type: 'done' }] };
      case 'session.error':
        return { sessionID, events: [{ type: 'error', error: readErrorMessage(properties?.error) ?? 'Unknown error' }] };
      case 'message.updated':
        return { sessionID, events: this.handleMessage(info) };
      default:
        return { sessionID, events: [] };
    }
  }

  private handlePart(part: Record<string, unknown> | undefined, sessionID: string | undefined): ChatStreamEvent[] {
    if (!part) return [];
    const type = readString(part.type);
    if (type === 'text' || type === 'reasoning') return this.handleTextPart(type, part, sessionID);
    if (type === 'tool') return this.handleToolPart(part, sessionID);
    return [];
  }

  private handleTextPart(
    type: 'text' | 'reasoning',
    part: Record<string, unknown>,
    sessionID: string | undefined,
  ): ChatStreamEvent[] {
    const id = readString(part.id);
    const text = readString(part.text);
    if (id === undefined || text === undefined) return [];

    const key = `${sessionID ?? ''}:${id}`;
    const emitted = this.partText.get(key) ?? '';
    if (text === emitted) return [];
    if (text.startsWith(emitted) && text.length > emitted.length) {
      const delta = text.slice(emitted.length);
      this.partText.set(key, text);
      return [{ type: type === 'text' ? 'content' : 'reasoning', content: delta }];
    }
    // 截断/分叉/重写：忽略且不重置 emitted，保持追加式渲染一致
    return [];
  }

  private handlePartDelta(
    properties: Record<string, unknown> | undefined,
    sessionID: string | undefined,
  ): ChatStreamEvent[] {
    const partID = readString(properties?.partID);
    const field = readString(properties?.field);
    const delta = readString(properties?.delta);
    if (partID === undefined || delta === undefined || delta === '') return [];
    const type = field === 'text' ? 'content' : field === 'reasoning' ? 'reasoning' : undefined;
    if (type === undefined) return [];

    const key = `${sessionID ?? ''}:${partID}`;
    const emitted = this.partText.get(key) ?? '';
    this.partText.set(key, emitted + delta);
    return [{ type, content: delta }];
  }

  private handleToolPart(part: Record<string, unknown>, sessionID: string | undefined): ChatStreamEvent[] {
    const callID = readString(part.callID);
    const tool = readString(part.tool);
    if (callID === undefined || tool === undefined) return [];

    const state = isRecord(part.state) ? part.state : undefined;
    const status = readString(state?.status);
    const key = `${sessionID ?? ''}:${callID}`;

    if (status === 'pending') {
      if (this.emittedTools.has(key)) return [];
      this.emittedTools.add(key);
      return [
        {
          type: 'tool_call',
          toolCall: { id: callID, type: 'function', function: { name: tool, arguments: stringifyArgs(state?.input) } },
        },
      ];
    }

    if (status === 'completed' || status === 'error') {
      if (this.emittedResults.has(key)) return [];
      this.emittedResults.add(key);
      if (status === 'completed') {
        return [
          {
            type: 'tool_result',
            toolResult: { name: tool, toolCallId: callID, result: { ok: true, output: state?.output } },
          },
        ];
      }
      return [
        {
          type: 'tool_result',
          toolResult: { name: tool, toolCallId: callID, result: { ok: false, error: readErrorMessage(state?.error) ?? 'Unknown error' } },
        },
      ];
    }

    return [];
  }

  private handlePermission(properties: Record<string, unknown> | undefined): ChatStreamEvent[] {
    const id = readString(properties?.id);
    if (id === undefined) return [];
    return [
      {
        type: 'approval_required',
        approval: {
          id,
          toolName: readString(properties?.title) ?? '',
          args: stringifyArgs(properties?.metadata),
          toolCallId: id,
        },
      },
    ];
  }

  private handleMessage(info: Record<string, unknown> | undefined): ChatStreamEvent[] {
    if (!info) return [];
    const role = readString(info.role);
    if (role !== undefined && role !== 'assistant') return [];

    const tokens = isRecord(info.tokens) ? info.tokens : undefined;
    if (!tokens) return [];
    const input = readNumber(tokens.input);
    const output = readNumber(tokens.output);
    if (input === undefined && output === undefined) return [];

    return [{ type: 'usage', usage: { promptTokens: input ?? 0, completionTokens: output ?? 0, estimated: false } }];
  }
}
