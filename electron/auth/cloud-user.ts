import type { CloudAccount } from '../../shared/ipc';

/**
 * CloudBase js-sdk 返回的「user」**不是**它自己的原始结构。
 *
 * v3 起 SDK 内部会先跑一遍 `convertToUser()`（见 @cloudbase/js-sdk auth 包的
 * `convertToUser`），把它转成 **Supabase 形状**：
 *
 * ```
 * {
 *   id, aud, role, email, phone, confirmed_at, created_at, updated_at,
 *   app_metadata:  { provider, providers },
 *   user_metadata: { uid, username, name, nickName, picture, avatarUrl, ... },
 *   identities:    [...]
 * }
 * ```
 *
 * ⚠️ 关键坑：顶层**没有** `uid` / `username` / `name` / `phoneNumber`。
 * 旧代码直接读 `user.uid` 恒为 `undefined`，`toAccount` 便返回 null，
 * 调用方又一律用 `as never` 强转（TS 因此完全失明），
 * 最终表现为「注册/登录成功但未取到用户信息」。
 */

/** SDK 用户对象（Supabase 形状为主，兼容更早的原始字段） */
export interface RawCloudUser {
  // —— SDK v3 默认：Supabase 形状 ——
  id?: string;
  email?: string;
  phone?: string;
  user_metadata?: {
    uid?: string;
    username?: string;
    name?: string;
    nickName?: string;
  };
  // —— 兼容：直接透传原始结构（不同接入路径 / 未来版本） ——
  uid?: string;
  sub?: string;
  username?: string;
  name?: string;
  phone_number?: string;
}

/**
 * 归一化 SDK user → 渲染层可见的账号元数据。
 * 取不到 uid 一律返回 null（调用方据此判定"没拿到用户"）。
 */
export function toCloudAccount(user: RawCloudUser | null | undefined): CloudAccount | null {
  if (!user) return null;

  const meta = user.user_metadata ?? {};
  const uid = user.uid ?? user.id ?? user.sub ?? meta.uid;
  if (!uid) return null;

  return {
    uid,
    // email / phone 在 SDK 里为空串（如纯手机号用户），统一收敛成 undefined
    email: user.email || undefined,
    username: user.username || meta.username || undefined,
    displayName: user.name || meta.name || meta.nickName || undefined,
    phone: user.phone || user.phone_number || undefined,
  };
}
