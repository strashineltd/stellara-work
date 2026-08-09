import { createParser, type EventSourceMessage } from 'eventsource-parser';
import log from 'electron-log/main';
import { v4 as uuid } from 'uuid';
import { buildChatCompletionsUrl } from './endpoint';
import { classifyHttpError, classifyThrownError } from './error-classifier';
import type {
  ModelConfig,
  ChatMessage,
  ToolCall,
  ChatStreamEvent,
  OpenAITool,
} from '../../shared/ipc';

/**
 * Idle-timeout for the streaming SSE read loop.
 *
 * Why 120s: most LLM inter-token gaps are well under 2s, but Chinese models
 * (GLM, Kimi, DeepSeek) on long tool_call deltas can pause 30-60s mid-stream.
 * 120s catches truly hung streams within ~2 minutes instead of the previous
 * &gt;5-minute hang. Tune the constant below if a slower model is added later.
 *
 * First-byte latency for the very first chunk uses a tighter window — most
 * providers respond within 30s or fail outright (auth, bad model name, DNS).
 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 30_000;
const SUMMARIZE_TIMEOUT_MS = 60_000;

/**
 * Compose multiple AbortSignals into one. AbortSignal.any is in Node ≥19.1
 * (Electron 32 ships Node 20). We still keep a manual fallback so this file
 * remains unit-testable on any runtime and degrades gracefully.
 */
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

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream: boolean;
  temperature?: number;
  max_tokens?: number;
}

/**
 * OpenAI 兼容协议的 Chat Completions 客户端
 *
 * 特性：
 * - SSE 流式响应
 * - function calling 解析
 * - AbortSignal 取消
 * - 自动重试（指数退避，限流时）
 */
export class OpenAICompatClient {
  constructor(private config: ModelConfig) {}

  /**
   * 发送一个 chat completion 请求，返回流式事件
   *
   * `idleTimeoutMs` 默认 120s：流空闲超过这个时长就 abort + yield error。
   * 在测试里可以传一个更小的值（比如 300ms）来验证 idle timeout 触发逻辑。
   */
  async *chat(
    request: ChatCompletionRequest,
    signal?: AbortSignal,
    idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
  ): AsyncGenerator<ChatStreamEvent> {
    const url = buildChatCompletionsUrl(this.config.baseUrl);

    // Idle timer：组合 user-signal + idle-controller 的 abort。
    // 每收到一个 chunk 重置一次；如果到点没动静，abort fetch + yield error。
    const idleController = new AbortController();
    const composedSignal = anySignal([signal, idleController.signal]);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let firstChunkArrived = false;

    const armTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      const ms = firstChunkArrived ? idleTimeoutMs : STREAM_FIRST_CHUNK_TIMEOUT_MS;
      idleTimer = setTimeout(() => {
        const reason = firstChunkArrived
          ? `流空闲超过 ${idleTimeoutMs / 1000}s 未收到新数据，疑似连接挂起`
          : `等待首块响应超过 ${STREAM_FIRST_CHUNK_TIMEOUT_MS / 1000}s`;
        log.warn(`[openai-compat] ${reason}（model=${request.model}）`);
        idleController.abort(new Error(reason));
      }, ms);
    };

    try {
      const response = await this.fetchWithRetry(url, request, composedSignal);

      if (!response.ok) {
        const errorText = await response.text();
        const meta = classifyHttpError(response.status, errorText);
        yield {
          type: 'error',
          error: `HTTP ${response.status}: ${errorText.slice(0, 500)}`,
          errorMeta: meta,
        };
        return;
      }

      if (!response.body) {
        yield {
          type: 'error',
          error: '响应为空',
          errorMeta: { kind: 'server', hint: 'Provider 返回空响应。稍候重试。', retryable: true },
        };
        return;
      }

      // 流式解析 SSE
      // 本地 buffer：SSE onEvent 回调里塞进来，主循环在每次 feed 之后 drain 出来 yield
      const pending: ChatStreamEvent[] = [];
      const toolCallsBuffer = new Map<number, ToolCall>(); // index -> partial tool call
      let hadUsage = false; // provider 是否上报过 usage chunk
      let streamedContent = ''; // 流式 content 累积量（估算 completion tokens 用）
      const parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          if (event.data === '[DONE]') return;
          try {
            const json = JSON.parse(event.data);

            // usage chunk（流结束时某些 provider 单独发；无 delta，必须先于
            // 下面的 delta 检查捕获）
            if (json.usage) {
              hadUsage = true;
              pending.push({
                type: 'usage',
                usage: {
                  promptTokens: json.usage.prompt_tokens ?? 0,
                  completionTokens: json.usage.completion_tokens ?? 0,
                  estimated: false,
                },
              });
            }

            const delta = json.choices?.[0]?.delta;
            if (!delta) return;

            // content 增量
            if (delta.content) {
              streamedContent += delta.content;
              pending.push({ type: 'content', content: delta.content });
            }

            // tool_calls 增量
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsBuffer.has(idx)) {
                  toolCallsBuffer.set(idx, {
                    // 部分 provider（GLM / DeepSeek / Kimi 等）第一个 delta 不带 id，
                    // 后续也不补。如果不补占位，tool_call_id 就是空串，
                    // 下一轮发回 tool 消息时 OpenAI 会 HTTP 400：
                    // "Messages with role 'tool' must be a response to a preceding
                    //  message with 'tool_calls'".
                    id: tc.id ?? `call_${uuid()}`,
                    type: 'function',
                    function: { name: tc.function?.name ?? '', arguments: '' },
                  });
                }
                const buf = toolCallsBuffer.get(idx)!;
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.function.name = tc.function.name;
                if (tc.function?.arguments) {
                  buf.function.arguments += tc.function.arguments;
                }
              }
            }
          } catch {
            // 忽略解析错误（可能是 ping / 心跳）
          }
        },
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // composedSignal 一旦 abort（用户取消 / idle 超时），主动 cancel reader
      // 让正在 await 的 reader.read() 立刻 resolve/reject，避免挂死。
      // （真实 fetch 实现里 fetch 自身会被 abort，但 mock 测试场景下
      //  只有这一步才能让流真正结束。）
      const onComposedAbort = () => {
        try { reader.cancel(); } catch { /* ignore */ }
      };
      composedSignal.addEventListener('abort', onComposedAbort, { once: true });

      try {
        armTimer();
        while (true) {
          if (composedSignal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstChunkArrived) {
            firstChunkArrived = true;
            log.info(
              `[openai-compat] 首块已到达（model=${request.model}），切换到 ${idleTimeoutMs / 1000}s 空闲窗口`,
            );
          }
          armTimer();
          const text = decoder.decode(value, { stream: true });
          parser.feed(text);
          // 每个 chunk 喂完，drain 一次 pending → 真流式
          while (pending.length > 0) {
            yield pending.shift()!;
          }
        }
      } finally {
        reader.releaseLock();
        if (idleTimer) clearTimeout(idleTimer);
        composedSignal.removeEventListener('abort', onComposedAbort);
      }

      // Idle timer 触发了（用户没主动取消）→ 给前端一个清晰的 error 事件
      if (composedSignal.aborted && !signal?.aborted) {
        const reason = idleController.signal.reason;
        yield {
          type: 'error',
          error:
            reason instanceof Error
              ? reason.message
              : '流连接挂起，已自动终止',
          errorMeta: { kind: 'idle_timeout', hint: '流式响应空闲超时（120s 没新数据）。可能是 provider 丢流或网络不稳。', action: 'retry', retryable: true },
        };
        return;
      }

      // 无 usage chunk 时本地估算（避免反向依赖 agent/compress，估算内联）。
      // 字符数/4 的粗略近似：中文约 1 字 ≈ 1-2 token，英文约 4 字符 ≈ 1 token。
      if (!hadUsage) {
        const text = request.messages.map((m) => m.content ?? '').join('\n');
        const promptEstimate = Math.ceil(text.length / 4);
        const completionEstimate = Math.ceil(streamedContent.length / 4);
        yield {
          type: 'usage',
          usage: {
            promptTokens: Math.max(1, promptEstimate),
            completionTokens: Math.max(1, completionEstimate),
            estimated: true,
          },
        };
      }

      // 输出累积的 tool calls
      for (const toolCall of toolCallsBuffer.values()) {
        if (toolCall.function.name) {
          // 二次保险：万一初始化时 tc.id 也缺且后续没补，这里再补一次。
          if (!toolCall.id) {
            toolCall.id = `call_${uuid()}`;
            log.warn(`[openai-compat] tool_call id 在 yield 时仍为空，补占位 ${toolCall.id}`);
          }
          yield { type: 'tool_call', toolCall };
        }
      }
      yield { type: 'done' };
    } catch (err) {
      // 用户主动 abort → 静默退出（前端会收到用户中断）
      if (signal?.aborted) return;
      // Idle 触发的 AbortError → 用 idle reason 而非原始 AbortError 信息
      if (composedSignal.aborted) {
        const reason = idleController.signal.reason;
        yield {
          type: 'error',
          error:
            reason instanceof Error
              ? reason.message
              : '流连接挂起，已自动终止',
          errorMeta: { kind: 'idle_timeout', hint: '流式响应空闲超时。可能是 provider 丢流或网络不稳。', action: 'retry', retryable: true },
        };
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[openai-compat] chat() 异常: ${msg}`);
      const meta = classifyThrownError(err);
      yield { type: 'error', error: msg, errorMeta: meta };
    }
  }

  private async fetchWithRetry(
    url: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    maxRetries = 3,
  ): Promise<Response> {
    let attempt = 0;
    while (true) {
      attempt++;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      // 限流（429）或服务器错误（5xx）重试
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      return response;
    }
  }

  /**
   * 测试连接（发一个简单的 ping 请求）
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.fetchWithRetry(
        buildChatCompletionsUrl(this.config.baseUrl),
        {
          model: this.config.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 5,
          stream: false,
        } as ChatCompletionRequest,
        undefined,
        1,
      );
      if (response.ok) {
        return { ok: true };
      }
      const text = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 非流式摘要：发一段对话 + 摘要指令，返回 summary 文本。
   * 给 context compression 用：复用 fetchWithRetry 的限流重试 / headers。
   * max_tokens 默认 1024（摘要足够短）。
   *
   * `timeoutMs` 默认 60s：summarize 是单次非流式调用，但 fetch 可能在
   * 网络/DNS 上挂死。compress 路径只阻塞下一轮 LLM，silent hang 很难观察。
   * 抛错让 `compressIfNeeded` 的 catch 兜底跳过本次压缩。
   */
  async summarize(
    messages: ChatMessage[],
    systemPrompt: string,
    timeoutMs: number = SUMMARIZE_TIMEOUT_MS,
  ): Promise<string> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      log.warn(`[openai-compat] summarize() 超时（${timeoutMs / 1000}s），中止`);
      timeoutController.abort(new Error(`summarize 超时 ${timeoutMs / 1000}s`));
    }, timeoutMs);
    try {
      const response = await this.fetchWithRetry(
        buildChatCompletionsUrl(this.config.baseUrl),
        {
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
          max_tokens: 1024,
          stream: false,
          temperature: 0.2,
        } as ChatCompletionRequest,
        timeoutController.signal,
        2,
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`summarize HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      return (content ?? '').trim();
    } catch (err) {
      // 区分「我们自己 timeout abort」vs「fetch 抛了别的错」。
      // 真实 fetch 在 abort 时 reject 的 message 不一定包含 reason，
      // 所以从 controller.signal.reason 拿原始超时原因。
      if (timeoutController.signal.aborted) {
        const reason = timeoutController.signal.reason;
        throw reason instanceof Error ? reason : new Error('summarize 超时');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
