import log from 'electron-log/main';
import { redactSensitiveText } from '../security/redact';

/**
 * 云服务错误映射（从 cloudbase-client.ts 拆出，便于单测且不依赖 SDK）。
 *
 * 安全边界（M6）：返回给渲染层的内容一律来自本地映射表或固定中文文案，
 * **绝不透传服务端原文**（可能含端点、参数、账号信息）。原始细节只写本地日志。
 */

/** 未配置 Publishable Key —— 属于"开发者尚未配置"，不是用户操作失败 */
export class CloudNotConfiguredError extends Error {
  readonly code = 'CLOUD_NOT_CONFIGURED';
  constructor() {
    super('尚未配置 CloudBase Publishable Key');
    this.name = 'CloudNotConfiguredError';
  }
}

/** 失败结构（IPC 可序列化） */
export interface CloudFailure {
  /** 机器可读错误码 */
  code: string;
  /** 面向用户的中文说明 */
  message: string;
  /** 可选的下一步建议 */
  hint: string;
}

/**
 * SDK 抛出的 AuthError 公开结构
 * （见 @cloudbase/js-sdk/oauth 的 `auth/auth-error.d.ts`）。
 *
 * 最有价值的是 `category`：SDK 内部把五花八门的服务端错误归一化成了 14 个稳定分类，
 * 比只读 `code`（有时是 gRPC 风格、有时是英文原文）可靠得多。
 * `retryAfter` 只在 RATE_LIMITED 时有值；`helpMessage` 是官方中文说明。
 */
interface RawAuthError {
  code?: unknown;
  category?: unknown;
  message?: unknown;
  helpMessage?: unknown;
  retryAfter?: unknown;
}

/**
 * AuthErrorCategory → 稳定错误码 + 中文文案。
 *
 * `code` 会原样交给渲染层，渲染层据此决定「错误挂在哪」：
 * 字段级 inline（用户自己能改）还是顶部横幅（系统级）。
 */
const CATEGORY_MAP: Record<string, CloudFailure> = {
  INVALID_CREDENTIALS: {
    code: 'invalid_credentials',
    message: '邮箱/用户名或密码不正确',
    hint: '请检查后重试；忘记密码可用「忘记密码」重置',
  },
  USER_NOT_FOUND: {
    code: 'user_not_found',
    message: '该账号不存在',
    hint: '请确认邮箱或用户名，或先注册一个云账号',
  },
  USER_STATUS_ABNORMAL: {
    code: 'user_disabled',
    message: '账号状态异常',
    hint: '账号可能被封禁或仍在审核中，请联系管理员',
  },
  PROVIDER_NOT_ENABLED: {
    code: 'provider_not_enabled',
    message: '该登录方式未启用',
    hint: '请到云开发控制台「身份认证 → 登录方式」开启邮箱登录',
  },
  AUTH_METHOD_MISMATCH: {
    code: 'auth_method_mismatch',
    message: '登录方式不匹配',
    hint: '该账号未设置密码，请改用邮箱验证码方式登录',
  },
  RATE_LIMITED: {
    code: 'rate_limited',
    message: '请求过于频繁',
    hint: '请稍等一会儿再试',
  },
  CAPTCHA_REQUIRED: {
    code: 'captcha_required',
    message: '需要先完成图形验证码',
    hint: '当前界面暂不支持图形验证码，请先在浏览器端完成一次登录',
  },
  CAPTCHA_INVALID: {
    code: 'captcha_invalid',
    message: '图形验证码不正确',
    hint: '请重新验证',
  },
  MFA_REQUIRED: {
    code: 'mfa_required',
    message: '该账号开启了二次验证',
    hint: '本应用暂不支持多因素认证，请先在网页端关闭或改用其他账号',
  },
  VERIFICATION_FAILED: {
    code: 'verification_failed',
    message: '验证码不正确或已过期',
    hint: '请重新获取验证码后再试',
  },
  PRECONDITION_FAILED: {
    code: 'precondition_failed',
    message: '该邮箱或用户名已被占用',
    hint: '请更换后重试，或直接登录已有账号',
  },
  INVALID_PARAMS: {
    code: 'invalid_argument',
    message: '请检查填写内容',
    hint: '请确认各项格式后重试',
  },
  SERVICE_ERROR: {
    code: 'service_error',
    message: '云端服务暂不可用',
    hint: '请稍后重试',
  },
};

/**
 * 服务端 proto 字段级校验失败，形如：
 *   `invalid SignUpRequest.Username: value does not match regex pattern "^$|^[a-z][0-9a-z_-]{5,24}$"`
 *
 * ⚠️ 为什么这段特殊处理是必需的：CloudBase 的 `signUp({ email })` 只会「发验证码」，
 * 真正的注册请求是用户**填完验证码**之后由 SDK 内部补发的（见 js-sdk
 * `signUp().verifyOtp` 里的 `authApi.signUp({ ...params, verification_token })`）。
 * 所以 Username 不合法时，报错**不会**出现在「获取验证码」那一步，而是等到提交验证码
 * 才抛回来。它跟账号密码无关，必须单独翻译，否则用户会一直换验证码却永远修不好。
 */
const FIELD_RULE_ERRORS: Array<{ match: RegExp; message: string; hint: string }> = [
  {
    match: /SignUpRequest\.Username/i,
    message: '用户名不符合规则',
    hint: '需 6-25 位、以小写字母开头，仅可含小写字母、数字、下划线和连字符（不能有大写字母或 . : + @）。请点「返回」修改用户名后重新获取验证码',
  },
  {
    match: /SignUpRequest\.Password/i,
    message: '密码不符合规则',
    hint: '请使用至少 6 位密码后重新获取验证码',
  },
];

/** 非 AuthError 场景（裸 HTTP / gRPC 风格 code）的兜底提示 */
const CODE_HINTS: Record<string, string> = {
  invalid_argument: '请检查填写内容后重试',
  unauthenticated: '登录状态已失效，请重新登录',
  failed_precondition: '该邮箱或账号已被占用，请更换',
  not_found: '账号不存在',
  unavailable: '服务暂不可用，请稍后再试',
  permission_denied: '操作被拒绝，请确认账号权限',
  resource_exhausted: '请求过于频繁，请稍后再试',
  already_exists: '该账号已注册，请直接登录',
  internal: '服务内部错误，请稍后再试',
};

/** 允许透传给渲染层的错误码形态（保守：短、字母数字下划线） */
const SAFE_CODE_RE = /^[A-Za-z0-9_]{1,64}$/;

function asRawAuthError(err: unknown): RawAuthError | null {
  return typeof err === 'object' && err !== null ? (err as RawAuthError) : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 从 SDK 抛出的错误里提取 code */
function extractCode(err: unknown): string {
  return readString(asRawAuthError(err)?.code) || 'unknown';
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return readString(asRawAuthError(err)?.message) || String(err);
}

/**
 * 把任意 SDK / 网络错误统一成可展示的 CloudFailure。
 * 供 IPC 层直接返回给渲染进程。
 *
 * 判定顺序（先具体、后笼统）：
 *   未配置 → 网络 → 字段级校验 → AuthError.category → 裸 code → 兜底（M6 泛化）
 */
export function describeCloudError(err: unknown): CloudFailure {
  if (err instanceof CloudNotConfiguredError) {
    return {
      code: err.code,
      message: err.message,
      hint: '请在应用数据目录的 .env 中配置 STELLARA_CLOUDBASE_PUBLISHABLE_KEY（Publishable Key 可从云开发控制台「API Key 配置」获取）',
    };
  }

  const rawAuth = asRawAuthError(err);
  const raw = extractMessage(err);

  // 网络层错误（fetch 失败 / DNS / 超时）
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|timeout/i.test(raw)) {
    return { code: 'network', message: '网络连接失败', hint: '请检查网络连接后重试' };
  }

  // 字段级校验失败：比 category 更具体，优先（英文原型信息对用户不可读）
  const fieldRule = FIELD_RULE_ERRORS.find((rule) => rule.match.test(raw));
  if (fieldRule) {
    return { code: 'field_rule', message: fieldRule.message, hint: fieldRule.hint };
  }

  // 原型链安全：`constructor` / `toString` / `__proto__` 等键名不得命中 Object.prototype
  const category = readString(rawAuth?.category);
  const mapped = Object.hasOwn(CATEGORY_MAP, category) ? CATEGORY_MAP[category] : undefined;
  if (mapped) {
    // RATE_LIMITED 会带 retryAfter，直接把还要等多久说出来
    const seconds = typeof rawAuth?.retryAfter === 'number' ? Math.ceil(rawAuth.retryAfter) : 0;
    return seconds > 0 ? { ...mapped, hint: `请等待约 ${seconds} 秒后重试` } : mapped;
  }

  // M6：未映射错误一律泛化为固定中文文案；原始细节仅写本地日志，
  // 绝不把服务端 payload（code 原文 / helpMessage / message）带回渲染层。
  const rawCode = extractCode(err);
  const code = SAFE_CODE_RE.test(rawCode) ? rawCode : 'unknown';
  log.warn(
    `未映射的云服务错误: code=${code} category=${category || '-'} ` +
      `message=${redactSensitiveText(raw)} help=${redactSensitiveText(readString(rawAuth?.helpMessage)) || '-'}`,
  );
  return {
    code,
    message: '操作失败，请稍后重试',
    hint: Object.hasOwn(CODE_HINTS, code) ? CODE_HINTS[code] : '请稍后重试，或查看应用日志',
  };
}
