import cloudbase from '@cloudbase/js-sdk';
import { CloudNotConfiguredError } from './cloud-errors';

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

// 错误映射已拆到 cloud-errors（不依赖 SDK，便于单测）；此处保持原导出面
export { CloudNotConfiguredError, describeCloudError } from './cloud-errors';
export type { CloudFailure } from './cloud-errors';

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
