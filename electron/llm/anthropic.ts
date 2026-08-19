/**
 * Anthropic Messages API 客户端
 *
 * 支持 Anthropic Messages API（`POST /v1/messages`）。
 * 用于自定义模型选择 Anthropic 格式时使用。
 *
 * 特性：
 * - 流式响应（SSE）
 * - Function Calling（tools）
 * - 多模态（图片）
 * - 取消支持
 */

import log from 'electron-log/main';
import { classifyThrownError } from './error-classifier';
import type { ErrorMeta } from '../../shared/ipc';

// ─── 超时常量 ─────────────────────────────────────────

const STREAM_IDLE_TIMEOUT_MS = 120_000;
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000;

// ─── 重试配置 ─────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

// ─── 类型定义 ─────────────────────────────────────────

export interface AnthropicConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** API 版本（默认 2023-06-01） */
  apiVersion?: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

export interface AnthropicContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  content?: string;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContent[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  stop_sequence?: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicStreamEvent {
  type: string;
  // 事件特定字段
  index?: number;
  delta?: { type: string; text?: string; partial_json?: string };
  content_block?: AnthropicContent;
  message?: AnthropicResponse;
  error?: { type: string; message: string };
}

// ─── 工具函数 ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0]!;
  if (typeof (AbortSignal as { any?: unknown }).any === 'function') {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(active);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const s of active) {
    if (s.aborted) { ctrl.abort(); break; }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

// ─── AnthropicClient 类 ─────────────────────────────────

export class AnthropicClient {
  private abortController: AbortController | null = null;

  constructor(private config: AnthropicConfig) {}

  /**
   * 取消当前请求
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 非流式请求
   */
  async create(request: AnthropicRequest, signal?: AbortSignal): Promise<AnthropicResponse> {
    this.abortController = new AbortController();
    const combinedSignal = anySignal([signal, this.abortController.signal]);

    const url = this.buildUrl();
    const body: AnthropicRequest = {
      ...request,
      model: this.config.model,
      stream: false,
    };

    return this.fetchWithRetry<AnthropicResponse>(url, body, combinedSignal);
  }

  /**
   * 流式请求，返回 AsyncIterable<AnthropicStreamEvent>
   */
  async *createStream(
    request: AnthropicRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AnthropicStreamEvent> {
    this.abortController = new AbortController();
    const combinedSignal = anySignal([signal, this.abortController.signal]);

    const url = this.buildUrl();
    const body: AnthropicRequest = {
      ...request,
      model: this.config.model,
      stream: true,
    };

    yield* this.fetchStreamWithRetry(url, body, combinedSignal);
  }

  /**
   * 非流式 ping（测试连接）
   */
  async ping(signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.create(
        {
          model: this.config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'ping' }],
        },
        signal,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ─── 内部方法 ─────────────────────────────────────────

  private buildUrl(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    if (base.endsWith('/v1/messages')) return base;
    if (base.endsWith('/v1')) return `${base}/messages`;
    return `${base}/v1/messages`;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.config.apiVersion || '2023-06-01',
    };
  }

  private async fetchWithRetry<T>(
    url: string,
    body: AnthropicRequest,
    signal: AbortSignal,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) throw new Error('请求已取消');

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          const errorMeta = this.classifyError(response.status, errorText);
          lastError = new Error(errorMeta.hint);

          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            log.warn(`Anthropic API 返回 ${response.status}，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
            continue;
          }

          throw lastError;
        }

        return await response.json() as T;
      } catch (err) {
        if ((err as Error).name === 'AbortError' || signal.aborted) {
          throw new Error('请求已取消');
        }

        const errorMeta = classifyThrownError(err);
        lastError = new Error(errorMeta.hint);

        if (errorMeta.retryable && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn(`Anthropic API 异常，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errorMeta.hint}`);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('重试次数已用尽');
  }

  private async *fetchStreamWithRetry(
    url: string,
    body: AnthropicRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnthropicStreamEvent> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) throw new Error('请求已取消');

      try {
        yield* this.fetchStream(url, body, signal);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError' || signal.aborted) {
          throw new Error('请求已取消');
        }

        const errorMeta = classifyThrownError(err);
        lastError = new Error(errorMeta.hint);

        if (errorMeta.retryable && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn(`Anthropic stream 异常，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errorMeta.hint}`);
          await sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('重试次数已用尽');
  }

  private async *fetchStream(
    url: string,
    body: AnthropicRequest,
    signal: AbortSignal,
  ): AsyncGenerator<AnthropicStreamEvent> {
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const errorMeta = this.classifyError(response.status, errorText);
      throw new Error(errorMeta.hint);
    }

    if (!response.body) {
      throw new Error('响应体为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastChunkTime = Date.now();
    let receivedFirstChunk = false;

    const checkIdle = (): void => {
      const now = Date.now();
      const elapsed = now - lastChunkTime;
      const timeout = receivedFirstChunk ? STREAM_IDLE_TIMEOUT_MS : STREAM_FIRST_CHUNK_TIMEOUT_MS;
      if (elapsed > timeout) {
        reader.cancel().catch(() => {});
        throw new Error(`流空闲超时 (${Math.round(elapsed / 1000)}s)`);
      }
    };

    const idleTimer = setInterval(checkIdle, 5_000);

    try {
      while (true) {
        if (signal.aborted) {
          reader.cancel().catch(() => {});
          throw new Error('请求已取消');
        }

        const { done, value } = await reader.read();
        if (done) break;

        lastChunkTime = Date.now();
        receivedFirstChunk = true;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const json = line.slice(6).trim();
            try {
              const event = JSON.parse(json) as AnthropicStreamEvent;
              yield event;
            } catch {
              log.debug(`SSE 解析失败，跳过: ${json.slice(0, 100)}`);
            }
          }
        }
      }
    } finally {
      clearInterval(idleTimer);
      reader.releaseLock();
    }
  }

  private classifyError(status: number, body: string): ErrorMeta {
    let errorBody: { error?: { type?: string; message?: string } } | null = null;
    try {
      errorBody = JSON.parse(body);
    } catch {}

    const kind = this.mapStatusToKind(status);
    let hint = errorBody?.error?.message || '';
    if (!hint) {
      switch (status) {
        case 401: hint = 'API Key 无效或已过期'; break;
        case 403: hint = 'API Key 无权限访问该资源'; break;
        case 429: hint = '请求频率超限，请稍后重试'; break;
        case 402: hint = 'API 额度已用尽'; break;
        case 404: hint = '模型不存在或不可用'; break;
        case 413: hint = '上下文过长，超出模型限制'; break;
        case 400: hint = '请求参数无效'; break;
        default: hint = `HTTP ${status}`; break;
      }
    }

    return {
      kind,
      hint,
      retryable: RETRYABLE_STATUS_CODES.has(status),
    };
  }

  private mapStatusToKind(status: number): ErrorMeta['kind'] {
    switch (status) {
      case 401: case 403: return 'auth';
      case 429: return 'rate_limit';
      case 402: return 'quota';
      case 404: return 'model_not_found';
      case 413: return 'context_too_long';
      case 400: return 'invalid_request';
      default: return status >= 500 ? 'server' : 'unknown';
    }
  }
}
