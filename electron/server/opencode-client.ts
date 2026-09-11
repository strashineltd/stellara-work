/**
 * opencode HTTP/SSE 客户端。
 *
 * - 只依赖全局 fetch（测试通过 `fetchImpl` 注入）。
 * - 所有一次性请求带超时（AbortSignal.timeout）；配置密码时带 Basic 鉴权。
 * - SSE 断线自动指数退避重连；`unsubscribe()` 停止重连并中止当前连接。
 * - 不记录、不回显密码。
 */

import { createParser } from 'eventsource-parser';
import type {
  RemoteAgent,
  RemoteEvent,
  RemoteMessage,
  RemotePath,
  RemoteProvider,
  RemoteProviderInput,
  RemoteProviderInputModel,
  RemoteProviderListResponse,
  RemoteSession,
  RemoteVcs,
} from './types';

export interface PromptBody {
  parts: Array<{ type: 'text'; text: string }>;
  model?: { providerID: string; modelID: string };
  agent?: string;
}

export type PermissionResponse = 'once' | 'always' | 'reject';

export type ConnectionStatus = 'connected' | 'reconnecting';

export interface HealthInfo {
  healthy?: boolean;
  version?: string;
  [key: string]: unknown;
}

export interface OpencodeClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  fetchImpl?: typeof fetch;
  /** 非健康检查请求超时（默认 15s）。 */
  timeoutMs?: number;
  /** 健康检查超时（默认 5s）。 */
  healthTimeoutMs?: number;
  /** SSE 重连初始退避（默认 1s）。 */
  reconnectBaseMs?: number;
  /** SSE 重连退避上限（默认 30s）。 */
  reconnectMaxMs?: number;
}

const DEFAULT_USERNAME = 'opencode';
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function authHeader(username: string | undefined, password: string | undefined): Record<string, string> {
  if (!password) return {};
  const token = Buffer.from(`${username ?? 'opencode'}:${password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

function normalizeModel(model: RemoteProviderInputModel, key?: string): RemoteProvider['models'][number] | null {
  const id = (typeof model.id === 'string' && model.id !== '' ? model.id : undefined) ?? key;
  if (id === undefined || id === '') return null;
  return { id, name: typeof model.name === 'string' && model.name !== '' ? model.name : id };
}

function normalizeProvider(input: RemoteProviderInput): RemoteProvider {
  const rawModels = input.models;
  let models: RemoteProvider['models'];
  if (Array.isArray(rawModels)) {
    models = rawModels.map((model) => normalizeModel(model)).filter((model) => model !== null);
  } else if (rawModels !== undefined && typeof rawModels === 'object' && rawModels !== null) {
    models = Object.entries(rawModels)
      .map(([key, model]) => normalizeModel(model, key))
      .filter((model) => model !== null);
  } else {
    models = [];
  }
  return { id: input.id, name: input.name ?? input.id, models };
}

interface RequestOptions {
  body?: unknown;
  timeoutMs?: number;
}

export class OpencodeClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  constructor(options: OpencodeClientOptions) {
    this.baseUrl = options.baseUrl;
    this.username = options.username ?? DEFAULT_USERNAME;
    this.password = options.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const hasBody = options.body !== undefined;
    const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method,
      headers: {
        ...authHeader(this.username, this.password),
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  health(): Promise<HealthInfo> {
    return this.request<HealthInfo>('GET', '/global/health', { timeoutMs: this.healthTimeoutMs });
  }

  listSessions(): Promise<RemoteSession[]> {
    return this.request<RemoteSession[]>('GET', '/session');
  }

  createSession(title?: string): Promise<RemoteSession> {
    return this.request<RemoteSession>('POST', '/session', { body: title === undefined ? {} : { title } });
  }

  getSession(id: string): Promise<RemoteSession> {
    return this.request<RemoteSession>('GET', `/session/${encodeURIComponent(id)}`);
  }

  updateSession(id: string, title: string): Promise<RemoteSession> {
    return this.request<RemoteSession>('PATCH', `/session/${encodeURIComponent(id)}`, { body: { title } });
  }

  deleteSession(id: string): Promise<boolean> {
    return this.request<boolean>('DELETE', `/session/${encodeURIComponent(id)}`);
  }

  listMessages(id: string): Promise<RemoteMessage[]> {
    return this.request<RemoteMessage[]>('GET', `/session/${encodeURIComponent(id)}/message`);
  }

  promptAsync(id: string, body: PromptBody): Promise<void> {
    return this.request<void>('POST', `/session/${encodeURIComponent(id)}/prompt_async`, { body });
  }

  abort(id: string): Promise<boolean> {
    return this.request<boolean>('POST', `/session/${encodeURIComponent(id)}/abort`);
  }

  respondPermission(sessionId: string, permissionID: string, response: PermissionResponse): Promise<boolean> {
    return this.request<boolean>(
      'POST',
      `/session/${encodeURIComponent(sessionId)}/permissions/${encodeURIComponent(permissionID)}`,
      { body: { response } },
    );
  }

  async listProviders(): Promise<RemoteProvider[]> {
    const data = await this.request<RemoteProviderInput[] | RemoteProviderListResponse>('GET', '/provider');
    const providers = Array.isArray(data) ? data : data.all ?? data.providers ?? [];
    return providers.map(normalizeProvider);
  }

  listAgents(): Promise<RemoteAgent[]> {
    return this.request<RemoteAgent[]>('GET', '/agent');
  }

  getPath(): Promise<RemotePath> {
    return this.request<RemotePath>('GET', '/path');
  }

  getVcs(): Promise<RemoteVcs> {
    return this.request<RemoteVcs>('GET', '/vcs');
  }

  /**
   * 订阅 `/event` SSE。回调异常会中断连接并触发重连（由服务器重新推送兜底）。
   * 注意：SSE 是长连接，不使用请求超时；生命周期由返回的 unsubscribe 控制。
   */
  subscribeEvents(
    onEvent: (event: RemoteEvent) => void,
    onStatus?: (status: ConnectionStatus) => void,
  ): () => void {
    let unsubscribed = false;
    let attempt = 0;
    let abortController: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = (): void => {
      onStatus?.('reconnecting');
      const delay = Math.min(this.reconnectBaseMs * 2 ** attempt, this.reconnectMaxMs);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void run();
      }, delay);
    };

    const run = async (): Promise<void> => {
      if (unsubscribed) return;
      const controller = new AbortController();
      abortController = controller;
      try {
        const response = await this.fetchImpl(joinUrl(this.baseUrl, '/event'), {
          headers: authHeader(this.username, this.password),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (unsubscribed) return;
        attempt = 0;
        onStatus?.('connected');
        const parser = createParser({
          onEvent: (message) => {
            if (message.data) onEvent(JSON.parse(message.data) as RemoteEvent);
          },
        });
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          if (unsubscribed) return;
          parser.feed(decoder.decode(chunk, { stream: true }));
        }
        parser.feed(decoder.decode());
      } catch {
        // 连接失败 / 中途断开：统一走重连
      }
      if (unsubscribed) return;
      scheduleReconnect();
    };

    void run();

    return () => {
      unsubscribed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      abortController?.abort();
      abortController = null;
    };
  }
}
