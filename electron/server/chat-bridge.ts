/**
 * 远端聊天桥接：本地流（streamId）↔ 远端 OpenCode server 会话。
 *
 * - 依赖全部注入（不 import electron），main.ts 负责接线。
 * - 远端会话在服务端持有历史：start() 只发送最后一条用户文本，不重放历史。
 * - SSE 事件经 EventAdapter 适配后，仅当 `serverId:sessionID` 命中活动流时发射，
 *   与本地路径共用 `chat-stream` 通道（渲染层无需区分）。
 * - 审批：approval_required 的远端 permission id 会被替换为本地 approvalId
 *   （`srv:<streamId>:<permissionID>`）；respondApproval 命中后回传远端，仅转发成功
 *   才消费映射（失败保留可重试），同一审批并发响应只转发一次。
 */

import type { ChatStreamEvent } from '@shared/ipc';
import { EventAdapter } from './event-adapter';
import type { OpencodeClient } from './opencode-client';
import type { RemoteEvent } from './types';

export interface ServerChatDeps {
  getSession: (id: string) => { runtime?: string; serverId?: string; remoteSessionId?: string } | undefined;
  getClient: (serverId: string) => OpencodeClient | null;
  emit: (streamId: string, event: ChatStreamEvent) => void;
  newStreamId: () => string;
}

interface ActiveStream {
  serverId: string;
  remoteSessionId: string;
  sessionID: string;
}

interface PendingApproval {
  serverId: string;
  remoteSessionId: string;
  permissionID: string;
  streamId: string;
}

const NOT_SERVER_SESSION = '会话不是远端会话';
const SERVER_NOT_CONNECTED = '服务器未连接';

export class ServerChatBridge {
  private readonly deps: ServerChatDeps;
  private readonly streams = new Map<string, ActiveStream>();
  private readonly activeByRemote = new Map<string, string>();
  private readonly adapters = new Map<string, EventAdapter>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly inFlightApprovals = new Set<string>();

  constructor(deps: ServerChatDeps) {
    this.deps = deps;
  }

  async start(
    sessionId: string,
    text: string,
    model?: { providerID: string; modelID: string },
    agent?: string,
  ): Promise<{ streamId: string }> {
    const session = this.deps.getSession(sessionId);
    if (!session || session.runtime !== 'server' || !session.serverId || !session.remoteSessionId) {
      throw new Error(NOT_SERVER_SESSION);
    }
    const client = this.deps.getClient(session.serverId);
    if (!client) throw new Error(SERVER_NOT_CONNECTED);

    const streamId = this.deps.newStreamId();
    const remoteKey = `${session.serverId}:${session.remoteSessionId}`;
    const previous = this.activeByRemote.get(remoteKey);
    if (previous !== undefined) this.cleanupStream(previous);

    this.streams.set(streamId, {
      serverId: session.serverId,
      remoteSessionId: session.remoteSessionId,
      sessionID: sessionId,
    });
    this.activeByRemote.set(remoteKey, streamId);

    try {
      await client.promptAsync(session.remoteSessionId, {
        parts: [{ type: 'text', text }],
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {}),
      });
    } catch (error) {
      this.cleanupStream(streamId);
      throw error;
    }
    return { streamId };
  }

  async abort(streamId: string): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    const client = this.deps.getClient(stream.serverId);
    try {
      if (client) await client.abort(stream.remoteSessionId);
    } finally {
      this.cleanupStream(streamId);
    }
  }

  handleEvent(serverId: string, event: RemoteEvent): void {
    let adapter = this.adapters.get(serverId);
    if (!adapter) {
      adapter = new EventAdapter();
      this.adapters.set(serverId, adapter);
    }
    const { sessionID, events } = adapter.handle(event);
    if (sessionID === undefined) return;
    const streamId = this.activeByRemote.get(`${serverId}:${sessionID}`);
    if (streamId === undefined) return;
    const stream = this.streams.get(streamId);
    if (!stream) return;

    for (const streamEvent of events) {
      if (streamEvent.type === 'approval_required' && streamEvent.approval) {
        const permissionID = streamEvent.approval.id;
        const localId = `srv:${streamId}:${permissionID}`;
        this.approvals.set(localId, {
          serverId: stream.serverId,
          remoteSessionId: stream.remoteSessionId,
          permissionID,
          streamId,
        });
        this.deps.emit(streamId, { ...streamEvent, approval: { ...streamEvent.approval, id: localId } });
      } else {
        this.deps.emit(streamId, streamEvent);
      }
      if (streamEvent.type === 'done' || streamEvent.type === 'error') this.cleanupStream(streamId);
    }
  }

  async respondApproval(approvalId: string, approved: boolean): Promise<boolean> {
    const approval = this.approvals.get(approvalId);
    if (!approval || this.inFlightApprovals.has(approvalId)) return false;
    const client = this.deps.getClient(approval.serverId);
    if (!client) throw new Error(SERVER_NOT_CONNECTED);
    this.inFlightApprovals.add(approvalId);
    try {
      await client.respondPermission(approval.remoteSessionId, approval.permissionID, approved ? 'once' : 'reject');
    } finally {
      this.inFlightApprovals.delete(approvalId);
    }
    // 仅在远端应答成功后消费映射：失败保留，允许用户重试
    this.approvals.delete(approvalId);
    return true;
  }

  private cleanupStream(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (!stream) return;
    this.streams.delete(streamId);
    const remoteKey = `${stream.serverId}:${stream.remoteSessionId}`;
    if (this.activeByRemote.get(remoteKey) === streamId) this.activeByRemote.delete(remoteKey);
    for (const [approvalId, approval] of [...this.approvals]) {
      if (approval.streamId === streamId) this.approvals.delete(approvalId);
    }
  }
}
