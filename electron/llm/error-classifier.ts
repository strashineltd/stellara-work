/**
 * LLM 错误分类 + 引导文案
 *
 * 把 HTTP 状态码 + 响应 body 映射成结构化的 ErrorMeta，
 * 供前端渲染针对性引导（替代裸报错）。
 *
 * 大部分 OpenAI 兼容 provider 都遵守这套错误格式：
 *   { "error": { "message": "...", "type": "...", "code": "..." } }
 */
import type { ErrorKind, ErrorMeta } from '../../shared/ipc';

const NOOP_META: ErrorMeta = {
  kind: 'unknown',
  hint: '',
  retryable: false,
};

const META_TABLE: Record<ErrorKind, ErrorMeta> = {
  auth: {
    kind: 'auth',
    hint: 'API key 无效或已过期。打开设置 → Providers 重新填 key。',
    action: 'open_settings',
    retryable: false,
  },
  rate_limit: {
    kind: 'rate_limit',
    hint: '请求被限流（429）。稍候几秒重试，或换 provider / 减少请求频率。',
    action: 'retry',
    retryable: true,
  },
  quota: {
    kind: 'quota',
    hint: 'API 余额不足（402 / 配额耗尽）。到对应厂商充值，或切换到其他 provider 的 model。',
    action: 'switch_model',
    retryable: false,
  },
  model_not_found: {
    kind: 'model_not_found',
    hint: 'Model 不存在或没权限访问。检查 model 名拼写，或换 model。',
    action: 'switch_model',
    retryable: false,
  },
  context_too_long: {
    kind: 'context_too_long',
    hint: '上下文窗口超出。开启新会话，或切换到更大的 context window（256K → 512K → 1M）。',
    action: 'switch_model',
    retryable: false,
  },
  invalid_request: {
    kind: 'invalid_request',
    hint: '请求格式不被服务端接受。可能是 tool_call id 错配或消息历史损坏。',
    action: 'retry',
    retryable: true,
  },
  server: {
    kind: 'server',
    hint: 'Provider 服务端错误（5xx）。稍候重试；如果持续失败，换 provider。',
    action: 'retry',
    retryable: true,
  },
  network: {
    kind: 'network',
    hint: '网络连接失败。检查网络 / baseUrl / 是否需要代理。',
    action: 'check_network',
    retryable: true,
  },
  idle_timeout: {
    kind: 'idle_timeout',
    hint: '流式响应空闲超时（120s 没新数据）。可能是 provider 丢流或网络不稳。',
    action: 'retry',
    retryable: true,
  },
  user_aborted: {
    kind: 'user_aborted',
    hint: '已取消',
    retryable: false,
  },
  unknown: {
    kind: 'unknown',
    hint: '',
    retryable: true,
  },
};

/**
 * 解析错误响应 body，提取 message + type + code
 */
interface ParsedError {
  message: string;
  type?: string;
  code?: string;
}

export function parseErrorBody(raw: string): ParsedError {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const err = (j.error ?? j) as Record<string, unknown>;
    return {
      message: typeof err.message === 'string' ? err.message : raw.slice(0, 300),
      type: typeof err.type === 'string' ? err.type : undefined,
      code: typeof err.code === 'string' ? err.code : undefined,
    };
  } catch {
    return { message: raw.slice(0, 300) };
  }
}

/**
 * HTTP 状态码 → 基础 kind 映射
 */
function kindFromStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 404) return 'model_not_found';
  if (status === 408 || status === 504) return 'network'; // timeout-ish
  if (status === 413) return 'context_too_long';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * 用响应 body 的 type / code / message 二次确认 kind（覆盖 400 类的细分）
 */
function refineKind(base: ErrorKind, parsed: ParsedError): ErrorKind {
  if (base === 'unknown') {
    // 400 类：靠 type/code 字符串匹配
    const text = `${parsed.type ?? ''} ${parsed.code ?? ''} ${parsed.message}`.toLowerCase();
    if (text.includes('context_length') || text.includes('maximum context')) return 'context_too_long';
    if (text.includes('model_not_found') || text.includes('model not found') || text.includes('the model does not exist')) return 'model_not_found';
    if (text.includes('quota') || text.includes('insufficient_quota') || text.includes('billing')) return 'quota';
    if (text.includes('rate_limit') || text.includes('rate limit')) return 'rate_limit';
    if (text.includes('api key') || text.includes('authentication') || text.includes('unauthorized')) return 'auth';
    if (text.includes('invalid_request')) return 'invalid_request';
    return 'unknown';
  }
  return base;
}

/**
 * 主入口：HTTP status + response body → ErrorMeta
 */
export function classifyHttpError(status: number, body: string): ErrorMeta {
  const parsed = parseErrorBody(body);
  const base = kindFromStatus(status);
  const kind = refineKind(base, parsed);
  return { ...META_TABLE[kind], kind };
}

/**
 * 把一个 thrown error（来自 fetch / AbortError / 内部）分类
 * 适用于非 HTTP 错误场景
 */
export function classifyThrownError(err: unknown): ErrorMeta {
  if (!err) return NOOP_META;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // idle timeout 标记（abort reason 是 Error）
  if (msg.includes('流空闲超过') || msg.includes('首块响应超过')) {
    return { ...META_TABLE.idle_timeout, kind: 'idle_timeout' };
  }
  if (msg.includes('用户中断') || msg.includes('aborted')) {
    return { ...META_TABLE.user_aborted, kind: 'user_aborted' };
  }
  if (
    lower.includes('fetch failed') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('eai_again') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('socket hang up')
  ) {
    return { ...META_TABLE.network, kind: 'network' };
  }
  return NOOP_META;
}