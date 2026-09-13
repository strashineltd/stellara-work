/**
 * 日志 / 诊断文本脱敏（M5）。
 *
 * 目标：去掉可识别个人身份或可用的凭据，同时保留排障所需的上下文
 * （时间戳、级别、消息主体、键名）。
 *
 * 纯字符串处理，无副作用；调用方在写日志或把文本交给渲染层之前调用。
 */

/** 邮箱 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * 裸长数字串（uid / 手机号等，7 位起）。
 * 端口（4 位）、行号、`YYYY-MM-DD HH:mm:ss` 时间戳的数字段均短于 7 位，不受影响。
 */
const BARE_DIGITS_RE = /\b\d{7,}\b/g;

/** JWT（header.payload.signature，常见 eyJ 开头） */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g;

/** Authorization 头里的 Bearer / Basic / Token 凭据 */
const AUTH_HEADER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** OpenAI 风格 sk- 密钥 */
const API_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

/** STELLARA 密钥位赋值：保留键名，值替换为 <redacted> */
const STELLARA_ASSIGN_RE =
  /\b(STELLARA_(?:KEY|SERVER|CLOUD)_[A-Za-z0-9._-]+)\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g;

/** 通用密钥型键名赋值（*_TOKEN / *_SECRET / *_PASSWORD / *_API_KEY） */
const GENERIC_SECRET_ASSIGN_RE =
  /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Za-z0-9_]*)\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/gi;

export function redactSensitiveText(text: string): string {
  return text
    .replace(STELLARA_ASSIGN_RE, '$1=<redacted>')
    .replace(GENERIC_SECRET_ASSIGN_RE, '$1=<redacted>')
    .replace(AUTH_HEADER_RE, '$1 <redacted>')
    .replace(JWT_RE, '<redacted-token>')
    .replace(API_KEY_RE, '<redacted-key>')
    .replace(EMAIL_RE, '<redacted-email>')
    // 放最后：邮箱/令牌/赋值先整体替换，避免长数字规则先拆散它们的形态
    .replace(BARE_DIGITS_RE, '<redacted-number>');
}

/**
 * 诊断日志尾：**先脱敏再截断**。
 *
 * 顺序不可颠倒：先 `slice` 可能把密钥/令牌的前缀截掉，使其不再匹配脱敏模式，
 * 从而在返回渲染层的日志尾中泄露剩余片段。
 */
export function redactLogTail(raw: string, limit = 2000): string {
  return redactSensitiveText(raw).slice(-limit);
}

/** 账号标识 → 固定占位（不泄露 email / username / uid / phone） */
export function redactAccountRef(account: {
  email?: string | null;
  username?: string | null;
  uid?: string | null;
}): string {
  if (account.email) return 'email=<redacted>';
  if (account.username) return 'username=<redacted>';
  return 'uid=<redacted>';
}
