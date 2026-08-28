/**
 * Responses API 客户端
 *
 * 使用 Responses API（POST /responses）。
 * 支持：
 * - 流式和非流式响应
 * - typed SSE事件解析
 * - Function Call（单个和并行）
 * - reasoning
 * - usage
 * - 取消
 * - 重试（429/5xx/529）
 */

import log from 'electron-log/main';
import { buildResponsesUrl } from '../../shared/responses';
import { classifyThrownError } from './error-classifier';
import type { ErrorMeta } from '../../shared/ipc';
import type {
  CreateResponseRequest,
  ResponseObject,
  ResponseStreamEvent,
} from '../../shared/responses';

// ─── 超时常量 ─────────────────────────────────────────

const STREAM_IDLE_TIMEOUT_MS = 120_000;
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000;

// ─── 重试配置 ─────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504, 529]);

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

// ─── ResponsesClient 类 ─────────────────────────────────

export interface ResponsesClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 可选的 provider capability（控制参数剪裁） */
  capabilities?: {
    reasoning?: boolean;
    parallelToolCalls?: boolean;
    maxOutputTokens?: number;
  };
}

export class ResponsesClient {
  private abortController: AbortController | null = null;

  constructor(private config: ResponsesClientConfig) {}

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
  async create(request: CreateResponseRequest, signal?: AbortSignal): Promise<ResponseObject> {
    this.abortController = new AbortController();
    const combinedSignal = anySignal([signal, this.abortController.signal]);

    const url = buildResponsesUrl(this.config.baseUrl);
    const body: CreateResponseRequest = {
      ...request,
      model: this.config.model,
      stream: false,
      store: false,
    };

    return this.fetchWithRetry<ResponseObject>(url, body, combinedSignal);
  }

  /**
   * 流式请求，返回 AsyncIterable<ResponseStreamEvent>
   */
  async *createStream(
    request: CreateResponseRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent> {
    this.abortController = new AbortController();
    const combinedSignal = anySignal([signal, this.abortController.signal]);

    const url = buildResponsesUrl(this.config.baseUrl);
    const body: CreateResponseRequest = {
      ...request,
      model: this.config.model,
      stream: true,
      store: false,
    };

    yield* this.fetchStreamWithRetry(url, body, combinedSignal);
  }

  /**
   * 非流式 ping（测试连接）
   */
  async ping(signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.create(
        { model: this.config.model, input: 'ping', stream: false, store: false, max_output_tokens: 16 },
        signal,
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ─── 内部方法 ─────────────────────────────────────────

  private async fetchWithRetry<T>(
    url: string,
    body: CreateResponseRequest,
    signal: AbortSignal,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) {
        throw new Error('请求已取消');
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          const errorMeta = this.classifyError(response.status, errorText);
          lastError = new Error(errorMeta.hint);

          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            log.warn(`Responses API 返回 ${response.status}，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
            await sleep(delay);
            continue;
          }

          throw lastError;
        }

        return await response.json() as T;
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          throw new Error('请求已取消');
        }
        if (signal.aborted) {
          throw new Error('请求已取消');
        }

        const errorMeta = classifyThrownError(err);
        lastError = new Error(errorMeta.hint);

        if (errorMeta.retryable && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn(`Responses API 异常，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errorMeta.hint}`);
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
    body: CreateResponseRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) {
        throw new Error('请求已取消');
      }

      try {
        yield* this.fetchStream(url, body, signal);
        return; // 成功完成
      } catch (err) {
        if ((err as Error).name === 'AbortError' || signal.aborted) {
          throw new Error('请求已取消');
        }

        const errorMeta = classifyThrownError(err);
        lastError = new Error(errorMeta.hint);

        if (errorMeta.retryable && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn(`Responses stream 异常，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errorMeta.hint}`);
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
    body: CreateResponseRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ResponseStreamEvent> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
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
    let idleError: Error | null = null;

    const checkIdle = (): void => {
      const now = Date.now();
      const elapsed = now - lastChunkTime;
      const timeout = receivedFirstChunk ? STREAM_IDLE_TIMEOUT_MS : STREAM_FIRST_CHUNK_TIMEOUT_MS;
      if (elapsed > timeout) {
        idleError = new Error(`流空闲超时 (${Math.round(elapsed / 1000)}s)`);
        void reader.cancel();
      }
    };

    // 设置 idle 检查
    const idleTimer = setInterval(checkIdle, 5_000);

    try {
      while (true) {
        if (signal.aborted) {
          reader.cancel().catch(() => {});
          throw new Error('请求已取消');
        }

        const { done, value } = await reader.read();
        if (idleError) throw idleError;
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
              const event = JSON.parse(json) as ResponseStreamEvent;
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
    // 尝试解析错误体
    let errorBody: { error?: { type?: string; message?: string; code?: string } } | null = null;
    try {
      errorBody = JSON.parse(body);
    } catch {}

    // 映射 HTTP 状态码
    const kind = this.mapStatusToKind(status);

    // 根据状态码和错误体生成 hint
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
