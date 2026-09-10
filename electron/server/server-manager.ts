/**
 * 服务器管理器：配置 CRUD + 连接状态机 + 事件分发。
 *
 * - 依赖全部注入（不 import electron），main.ts 负责接线。
 * - 凭据只经 deps 读写，绝不进入 list()/statuses() 输出。
 * - 状态变化通过 onStatusChanged 广播快照；远端事件经 onEvent 按 serverId 分发。
 */

import { randomUUID } from 'node:crypto';
import type { ServerEntry, ServerInput, ServerRuntimeStatus, ServerTestResult } from '@shared/ipc';
import { normalizeServerUrl, type ServerConfigEntry } from '../config/config-v2';
import type { HealthInfo, OpencodeClient } from './opencode-client';
import type { RemoteEvent } from './types';

export interface ServerManagerDeps {
  loadEntries: () => Promise<ServerConfigEntry[]>;
  addEntry: (entry: ServerConfigEntry) => Promise<unknown>;
  updateEntry: (id: string, patch: Partial<ServerConfigEntry>) => Promise<unknown>;
  removeEntry: (id: string) => Promise<unknown>;
  getPassword: (id: string) => string | null;
  setPassword: (id: string, password: string) => Promise<void>;
  deletePassword: (id: string) => Promise<void>;
  createClient: (entry: ServerConfigEntry, password: string | null) => OpencodeClient;
  /** 缺省 = 无默认服务器（isDefault 恒 false）。主进程接线时提供。 */
  getDefaultServerId?: () => string | null | Promise<string | null>;
  /** 缺省 = no-op。主进程接线时提供。 */
  setDefaultServerId?: (id: string | null) => Promise<void>;
  now?: () => string;
}

export interface ServerStatus {
  id: string;
  status: ServerRuntimeStatus;
  error?: string;
  version?: string;
}

interface RuntimeState {
  status: ServerRuntimeStatus;
  error?: string;
  version?: string;
  client?: OpencodeClient;
  unsubscribe?: () => void;
}

const URL_ERROR = '服务器 URL 必须是 http:// 或 https:// 地址';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeConnectError(error: unknown): string {
  const message = errorMessage(error);
  return /HTTP (401|403)\b/.test(message) ? `鉴权失败: ${message}` : `连接失败: ${message}`;
}

export class ServerManager {
  private readonly deps: ServerManagerDeps;
  private entries = new Map<string, ServerConfigEntry>();
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly knownPasswords = new Set<string>();
  private readonly statusListeners = new Set<(statuses: ServerStatus[]) => void>();
  private readonly eventListeners = new Set<(serverId: string, event: RemoteEvent) => void>();

  constructor(deps: ServerManagerDeps) {
    this.deps = deps;
  }

  async list(): Promise<ServerEntry[]> {
    const entries = await this.syncEntries();
    const defaultId = await this.getDefaultId();
    return entries.map((entry) => this.toEntry(entry, defaultId));
  }

  async add(input: ServerInput): Promise<ServerEntry> {
    const url = normalizeServerUrl(input.url);
    if (!url) throw new Error(URL_ERROR);
    const password = input.password ? input.password : null;
    const entry: ServerConfigEntry = {
      id: randomUUID(),
      name: input.name?.trim() || new URL(url).host,
      url,
      createdAt: this.now(),
    };
    if (input.username !== undefined) entry.username = input.username;

    await this.probe(entry, password);
    await this.deps.addEntry(entry);
    if (password !== null) {
      await this.deps.setPassword(entry.id, password);
      this.knownPasswords.add(entry.id);
    }
    await this.syncEntries();
    await this.connect(entry.id);
    return this.toEntry(entry, await this.getDefaultId());
  }

  async update(id: string, patch: Partial<ServerInput>): Promise<ServerEntry> {
    const entry = await this.requireEntry(id);
    const changes: Partial<ServerConfigEntry> = {};
    if (patch.url !== undefined) {
      const url = normalizeServerUrl(patch.url);
      if (!url) throw new Error(URL_ERROR);
      changes.url = url;
    }
    if (patch.name !== undefined) changes.name = patch.name.trim() || entry.name;
    if (patch.username !== undefined) changes.username = patch.username;
    if (Object.keys(changes).length > 0) await this.deps.updateEntry(id, changes);

    if (patch.password !== undefined) {
      if (patch.password === '') {
        await this.deps.deletePassword(id);
        this.knownPasswords.delete(id);
      } else {
        await this.deps.setPassword(id, patch.password);
        this.knownPasswords.add(id);
      }
    }

    const updated = { ...entry, ...changes };
    this.entries.set(id, updated);

    const state = this.runtime.get(id);
    const credentialsChanged = patch.url !== undefined || patch.username !== undefined || patch.password !== undefined;
    if (state && (state.status === 'connected' || state.status === 'connecting') && credentialsChanged) {
      this.dispose(id);
      await this.connect(id);
    }
    return this.toEntry(updated, await this.getDefaultId());
  }

  async remove(id: string): Promise<void> {
    this.dispose(id);
    this.runtime.delete(id);
    this.entries.delete(id);
    this.knownPasswords.delete(id);
    await this.deps.deletePassword(id);
    await this.deps.removeEntry(id);
    this.emitStatuses();
  }

  async setDefault(id: string | null): Promise<void> {
    if (id !== null) await this.requireEntry(id);
    if (this.deps.setDefaultServerId) await this.deps.setDefaultServerId(id);
  }

  statuses(): ServerStatus[] {
    return [...this.runtime.entries()].map(([id, state]) => ({
      id,
      status: state.status,
      ...(state.error !== undefined ? { error: state.error } : {}),
      ...(state.version !== undefined ? { version: state.version } : {}),
    }));
  }

  async test(id: string): Promise<ServerTestResult> {
    const entry = await this.requireEntry(id);
    try {
      const info = await this.probe(entry, this.deps.getPassword(id));
      return {
        ok: true,
        status: 'connected',
        ...(typeof info.version === 'string' ? { version: info.version } : {}),
      };
    } catch (error) {
      return { ok: false, status: 'error', error: errorMessage(error) };
    }
  }

  getClient(id: string): OpencodeClient | null {
    const state = this.runtime.get(id);
    if (!state || state.status !== 'connected' || !state.client) return null;
    return state.client;
  }

  async connectAll(): Promise<void> {
    const entries = await this.syncEntries();
    for (const entry of entries) await this.connect(entry.id);
  }

  disconnectAll(): void {
    let changed = false;
    for (const id of [...this.runtime.keys()]) {
      if (this.dispose(id)) changed = true;
    }
    if (changed) this.emitStatuses();
  }

  onStatusChanged(callback: (statuses: ServerStatus[]) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  onEvent(callback: (serverId: string, event: RemoteEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  private async connect(id: string): Promise<void> {
    const state = this.ensureRuntime(id);
    if (state.status === 'connected' || state.status === 'connecting') return;
    const entry = await this.findEntry(id);
    if (!entry) return;

    this.setRuntime(id, { status: 'connecting', error: undefined, version: undefined });
    const client = this.deps.createClient(entry, this.deps.getPassword(id));
    let info: HealthInfo;
    try {
      info = await client.health();
      if (info.healthy === false) throw new Error('健康检查未通过');
    } catch (error) {
      this.setRuntime(id, { status: 'error', error: describeConnectError(error), version: undefined });
      return;
    }

    state.client = client;
    state.unsubscribe = client.subscribeEvents(
      (event) => this.dispatchEvent(id, event),
      (status) => {
        this.setRuntime(id, { status: status === 'reconnecting' ? 'connecting' : 'connected' });
      },
    );
    this.setRuntime(id, {
      status: 'connected',
      error: undefined,
      version: typeof info.version === 'string' ? info.version : undefined,
    });

    try {
      await this.deps.updateEntry(id, { lastConnectedAt: this.now() });
    } catch {
      // 连接已建立，写回失败不改变状态
    }
  }

  private async probe(entry: ServerConfigEntry, password: string | null): Promise<HealthInfo> {
    try {
      const info = await this.deps.createClient(entry, password).health();
      if (info.healthy === false) throw new Error('健康检查未通过');
      return info;
    } catch (error) {
      throw new Error(describeConnectError(error));
    }
  }

  private async findEntry(id: string): Promise<ServerConfigEntry | undefined> {
    const cached = this.entries.get(id);
    if (cached) return cached;
    await this.syncEntries();
    return this.entries.get(id);
  }

  private async requireEntry(id: string): Promise<ServerConfigEntry> {
    const entry = await this.findEntry(id);
    if (!entry) throw new Error(`Server 不存在: ${id}`);
    return entry;
  }

  private async syncEntries(): Promise<ServerConfigEntry[]> {
    const entries = await this.deps.loadEntries();
    const next = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of [...this.runtime.keys()]) {
      if (!next.has(id)) {
        this.dispose(id);
        this.runtime.delete(id);
        this.knownPasswords.delete(id);
      }
    }
    this.entries = next;
    for (const id of next.keys()) this.ensureRuntime(id);
    return entries;
  }

  private async getDefaultId(): Promise<string | null> {
    const getter = this.deps.getDefaultServerId;
    return getter ? await getter() : null;
  }

  private hasPassword(id: string): boolean {
    return this.knownPasswords.has(id) || this.deps.getPassword(id) !== null;
  }

  private toEntry(entry: ServerConfigEntry, defaultId: string | null): ServerEntry {
    return {
      id: entry.id,
      name: entry.name,
      url: entry.url,
      ...(entry.username !== undefined ? { username: entry.username } : {}),
      hasPassword: this.hasPassword(entry.id),
      isDefault: entry.id === defaultId,
      createdAt: entry.createdAt,
      ...(entry.lastConnectedAt !== undefined ? { lastConnectedAt: entry.lastConnectedAt } : {}),
    };
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  private ensureRuntime(id: string): RuntimeState {
    let state = this.runtime.get(id);
    if (!state) {
      state = { status: 'disconnected' };
      this.runtime.set(id, state);
    }
    return state;
  }

  private setRuntime(
    id: string,
    changes: { status?: ServerRuntimeStatus; error?: string; version?: string },
  ): void {
    const state = this.ensureRuntime(id);
    const changed =
      (changes.status !== undefined && changes.status !== state.status) ||
      ('error' in changes && changes.error !== state.error) ||
      ('version' in changes && changes.version !== state.version);
    if (changes.status !== undefined) state.status = changes.status;
    if ('error' in changes) state.error = changes.error;
    if ('version' in changes) state.version = changes.version;
    if (changed) this.emitStatuses();
  }

  private dispose(id: string): boolean {
    const state = this.runtime.get(id);
    if (!state) return false;
    state.unsubscribe?.();
    state.unsubscribe = undefined;
    state.client = undefined;
    const changed = state.status !== 'disconnected' || state.error !== undefined || state.version !== undefined;
    state.status = 'disconnected';
    state.error = undefined;
    state.version = undefined;
    return changed;
  }

  private dispatchEvent(serverId: string, event: RemoteEvent): void {
    for (const callback of [...this.eventListeners]) {
      try {
        callback(serverId, event);
      } catch {
        // 单个监听者异常不影响其余监听者与状态机
      }
    }
  }

  private emitStatuses(): void {
    const snapshot = this.statuses();
    for (const callback of [...this.statusListeners]) {
      try {
        callback(snapshot);
      } catch {
        // 单个监听者异常不影响状态机
      }
    }
  }
}
