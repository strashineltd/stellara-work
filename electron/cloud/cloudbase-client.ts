import cloudbase from '@cloudbase/js-sdk';

/**
 * CloudBase 客户端（主进程单例）
 *
 * 为什么放在主进程：
 * - 渲染进程的 CSP 是 `connect-src 'self'`，完全禁止外网请求
 * - 云会话 token 属于敏感凭证，不该进入渲染进程的 JS 堆或 localStorage
 *
 * 为什么用 @cloudbase/js-sdk 而不是裸 HTTP：
 * - v3.x 提供官方 Node 构建（`exports["."].node` → dist/index.node.cjs.js），
 *   在 Electron 主进程可直接 require，无需 window / localStorage
 * - 走官方 SDK 意味着调用签名与官方文档一致，不必猜测 HTTP 端点与字段名
 * - 用户身份认证全部由 CloudBase 托管（密码哈希 / JWT / 防暴力破解 / 会话管理）
 *
 * 安全边界：
 * - 本模块只持有 **Publishable Key**（官方定位为"可安全暴露于客户端"）
 * - 绝不在客户端使用 API Key（管理员权限）—— 那是服务端凭证
 */

/** CloudBase 环境（腾讯云 stellara-prod） */
export const CLOUDBASE_ENV_ID = 'stellara-prod-d0g594tmi6e977e10';
/** 环境地域，未指定时官方默认上海 */
export const CLOUDBASE_REGION = 'ap-shanghai';

/**
 * Publishable Key 的来源：应用数据目录下 `.env` 的该变量。
 * 见 electron/config/env.ts（0600 权限，不进 git）。
 */
export const PUBLISHABLE_KEY_ENV = 'STELLARA_CLOUDBASE_PUBLISHABLE_KEY';

export type CloudBaseApp = ReturnType<typeof cloudbase.init>;
/** 注意：`app.auth` 是「可调用对象」——既能 `app.auth()`（v1 兼容）也能 `app.auth.signUp()` */
export type CloudBaseAuth = CloudBaseApp['auth'];

let _app: CloudBaseApp | null = null;
let _boundKey: string | null = null;

/** 读取配置的 Publishable Key；未配置返回 null */
export function getPublishableKey(): string | null {
  const raw = process.env[PUBLISHABLE_KEY_ENV];
  const key = raw?.trim();
  return key ? key : null;
}

/** 云账号功能是否已具备启用条件 */
export function isCloudConfigured(): boolean {
  return getPublishableKey() !== null;
}

/**
 * 取（惰性初始化）CloudBase app 单例。
 * Key 变化时自动重建，避免开发期改 .env 后拿到旧实例。
 */
export function getCloudApp(): CloudBaseApp {
  const key = getPublishableKey();
  if (!key) {
    throw new CloudNotConfiguredError();
  }
  if (_app && _boundKey === key) return _app;
  _app = cloudbase.init({
    env: CLOUDBASE_ENV_ID,
    region: CLOUDBASE_REGION,
    accessKey: key,
  });
  _boundKey = key;
  return _app;
}

/** 取 auth 单例 */
export function getCloudAuth(): CloudBaseAuth {
  return getCloudApp().auth;
}

/** 丢弃当前实例（登出 / 清空数据 / Key 变更后调用） */
export function resetCloudClient(): void {
  _app = null;
  _boundKey = null;
}

// ============================================
// 错误映射
// ============================================

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

/** 从 SDK 抛出的错误里提取 code（SDK 错误形如 { code, category, message }） */
function extractCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
  }
  return 'unknown';
}

function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(err);
}

/**
 * 服务端 proto 字段级校验失败，形如：
 *   `invalid SignUpRequest.Username: value does not match regex pattern "^$|^[a-z][0-9a-z_-]{5,24}$"`
 *
 * ⚠️ 为什么这段特殊处理是必需的：CloudBase 的 `signUp({ email })` 只会「发验证码」，
 * 真正的注册请求是用户**填完验证码**之后由 SDK 内部补发的（见 js-sdk
 * `signUp().verifyOtp` 里的 `authApi.signUp({ ...params, verification_token })`）。
 * 所以 Username 不合法时，报错**不会**出现在「获取验证码」那一步，而是等到提交验证码
 * 才抛回来。若按通用 invalid_argument 提示「验证码错误或已过期」，用户会一直换验证码
 * 却永远修不好。
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

/** SDK 错误码 → 中文提示 */
const CODE_HINTS: Record<string, string> = {
  invalid_argument: '请检查填写内容；验证码错误或已过期时请重新获取',
  unauthenticated: '登录状态已失效，请重新登录',
  failed_precondition: '该邮箱或账号已被占用，请更换',
  not_found: '账号不存在',
  unavailable: '服务暂不可用，请稍后再试',
  permission_denied: '操作被拒绝，请确认账号权限',
  resource_exhausted: '请求过于频繁，请稍后再试',
  already_exists: '该账号已注册，请直接登录',
  internal: '服务内部错误，请稍后再试',
};

/**
 * 把任意 SDK / 网络错误统一成可展示的 CloudFailure。
 * 供 IPC 层直接返回给渲染进程。
 */
export function describeCloudError(err: unknown): CloudFailure {
  if (err instanceof CloudNotConfiguredError) {
    return {
      code: err.code,
      message: err.message,
      hint: `请在应用数据目录的 .env 中配置 ${PUBLISHABLE_KEY_ENV}（Publishable Key 可从云开发控制台「API Key 配置」获取）`,
    };
  }

  const code = extractCode(err);
  const raw = extractMessage(err);
  const hint = CODE_HINTS[code];

  // 网络层错误（fetch 失败 / DNS / 超时）
  const looksLikeNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|timeout/i.test(raw);
  if (looksLikeNetwork) {
    return { code: 'network', message: '网络连接失败', hint: '请检查网络连接后重试' };
  }

  // 字段级校验失败（英文原型信息对用户不可读，且会被 invalid_argument 的通用提示带偏）
  const fieldRule = FIELD_RULE_ERRORS.find((rule) => rule.match.test(raw));
  if (fieldRule) {
    return { code: code === 'unknown' ? 'invalid_argument' : code, message: fieldRule.message, hint: fieldRule.hint };
  }

  return {
    code,
    message: raw,
    hint: hint ?? '请稍后重试，或查看应用日志',
  };
}
