/**
 * 会话桥接：本地会话与远端 OpenCode server 会话的统一门面。
 *
 * - 依赖全部注入（不 import electron），main.ts 负责接线。
 * - 远端会话在本地只存映射行（sessions 表）；消息按需经适配器转换，不落库。
 * - list() 对账：连上的服务器拉取远端列表并 upsert / 清理映射；
 *   拉取失败不清缓存，该轮视为离线。
 */

import type { CreateSessionArgs, SessionSummary } from '@shared/ipc';
import type { MessageRow, Session } from '../store/db';
import { remoteMessagesToRows } from './message-adapter';
import type { OpencodeClient } from './opencode-client';
import type { RemoteSession } from './types';

export interface SessionBridgeManager {
  statuses(): Array<{ id: string; status: string }>;
  getClient(id: string): OpencodeClient | null;
}

export interface SessionBridgeDb {
  listSessions(): Session[];
  getSession(id: string): Session | null;
  createSession(input: {
    id: string;
    title: string;
    modelId: string;
    workDir?: string;
    projectId?: string;
    runtime?: 'local' | 'server';
    serverId?: string;
    remoteSessionId?: string;
  }): Session;
  findSessionByRemote(serverId: string, remoteSessionId: string): Session | undefined;
  listServerSessions(serverId: string): Session[];
  deleteSession(id: string): void;
  deleteSessionByRemote(serverId: string, remoteSessionId: string): void;
  renameSession(id: string, title: string): void;
  updateSessionMeta(id: string, patch: { title?: string; updatedAt?: number; modelId?: string }): void;
  getMessages(sessionId: string): MessageRow[];
}

export interface SessionBridgeDeps {
  manager: SessionBridgeManager;
  db: SessionBridgeDb;
  uuid: () => string;
}

const REMOTE_FALLBACK_TITLE = '远端会话';
const SERVER_NOT_CONNECTED = '服务器未连接';

export class SessionBridge {
  private readonly manager: SessionBridgeManager;
  private readonly db: SessionBridgeDb;
  private readonly uuid: () => string;

  constructor(deps: SessionBridgeDeps) {
    this.manager = deps.manager;
    this.db = deps.db;
    this.uuid = deps.uuid;
  }

  async list(): Promise<SessionSummary[]> {
    const serverState = new Map<string, 'online' | 'offline'>();
    for (const status of this.manager.statuses()) {
      serverState.set(status.id, status.status === 'connected' ? 'online' : 'offline');
    }

    for (const [serverId] of [...serverState]) {
      if (serverState.get(serverId) !== 'online') continue;
      const client = this.manager.getClient(serverId);
      if (!client) {
        serverState.set(serverId, 'offline');
        continue;
      }
      try {
        const remotes = await client.listSessions();
        const remoteIds = new Set<string>();
        for (const remote of remotes ?? []) {
          const remoteId = typeof remote?.id === 'string' ? remote.id : '';
          if (!remoteId) continue;
          remoteIds.add(remoteId);
          this.upsertRemoteRow(serverId, remoteId, remote);
        }
        for (const cached of this.db.listServerSessions(serverId)) {
          if (cached.remoteSessionId && !remoteIds.has(cached.remoteSessionId)) {
            this.db.deleteSessionByRemote(serverId, cached.remoteSessionId);
          }
        }
      } catch {
        // 拉取失败：保留缓存，该轮视为离线
        serverState.set(serverId, 'offline');
      }
    }

    return this.db.listSessions().map((session) => this.toSummary(session, serverState));
  }

  async create(args: CreateSessionArgs): Promise<Session> {
    if (args.runtime === 'server') {
      if (!args.serverId) throw new Error('缺少服务器 ID');
      const client = this.requireClient(args.serverId);
      const remote = await client.createSession(args.title);
      return this.db.createSession({
        id: this.uuid(),
        title: remote.title ?? args.title ?? REMOTE_FALLBACK_TITLE,
        modelId: args.serverModel ? `${args.serverModel.providerID}/${args.serverModel.modelID}` : '',
        runtime: 'server',
        serverId: args.serverId,
        remoteSessionId: remote.id,
      });
    }

    return this.db.createSession({
      id: this.uuid(),
      title: args.title ?? 'New session',
      modelId: args.modelId ?? '',
      ...(args.workDir !== undefined ? { workDir: args.workDir } : {}),
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      runtime: 'local',
    });
  }

  async get(id: string): Promise<{ session: Session; messages: MessageRow[] }> {
    const session = this.db.getSession(id);
    if (!session) throw new Error(`Session 不存在: ${id}`);

    if (session.runtime === 'server') {
      const client = this.requireClient(session.serverId);
      if (!session.remoteSessionId) throw new Error('会话缺少远端映射');
      const messages = await client.listMessages(session.remoteSessionId);
      return { session, messages: remoteMessagesToRows(id, messages) };
    }

    return { session, messages: this.db.getMessages(id) };
  }

  async remove(id: string): Promise<void> {
    const session = this.db.getSession(id);
    if (!session) return;

    if (session.runtime === 'server') {
      const client = this.requireClient(session.serverId);
      if (!session.remoteSessionId) throw new Error('会话缺少远端映射');
      await client.deleteSession(session.remoteSessionId);
    }

    this.db.deleteSession(id);
  }

  async rename(id: string, title: string): Promise<void> {
    const session = this.db.getSession(id);
    if (!session) throw new Error(`Session 不存在: ${id}`);

    if (session.runtime === 'server') {
      const client = this.requireClient(session.serverId);
      if (!session.remoteSessionId) throw new Error('会话缺少远端映射');
      await client.updateSession(session.remoteSessionId, title);
    }

    this.db.renameSession(id, title);
  }

  private requireClient(serverId: string | undefined): OpencodeClient {
    if (serverId) {
      const status = this.manager.statuses().find((entry) => entry.id === serverId);
      if (status?.status === 'connected') {
        const client = this.manager.getClient(serverId);
        if (client) return client;
      }
    }
    throw new Error(SERVER_NOT_CONNECTED);
  }

  private upsertRemoteRow(serverId: string, remoteId: string, remote: RemoteSession): void {
    const existing = this.db.findSessionByRemote(serverId, remoteId);
    const patch: { title?: string; updatedAt?: number } = {};
    if (typeof remote.title === 'string') patch.title = remote.title;
    if (typeof remote.time?.updated === 'number') patch.updatedAt = remote.time.updated;

    if (existing) {
      this.db.updateSessionMeta(existing.id, patch);
      return;
    }

    this.db.createSession({
      id: this.uuid(),
      title: remote.title ?? REMOTE_FALLBACK_TITLE,
      modelId: '',
      runtime: 'server',
      serverId,
      remoteSessionId: remoteId,
    });
  }

  private toSummary(session: Session, serverState: Map<string, 'online' | 'offline'>): SessionSummary {
    const summary: SessionSummary = {
      id: session.id,
      title: session.title,
      modelId: session.modelId,
      ...(session.projectId !== undefined ? { projectId: session.projectId } : {}),
      ...(session.workDir !== undefined ? { workDir: session.workDir } : {}),
      messageCount: session.messageCount,
      updatedAt: session.updatedAt,
    };

    if (session.runtime !== 'server') {
      return { ...summary, runtime: 'local' };
    }

    const offline = session.serverId === undefined || serverState.get(session.serverId) !== 'online';
    return {
      ...summary,
      runtime: 'server',
      ...(session.serverId !== undefined ? { serverId: session.serverId } : {}),
      ...(session.remoteSessionId !== undefined ? { remoteSessionId: session.remoteSessionId } : {}),
      ...(offline ? { offline: true } : {}),
    };
  }
}
