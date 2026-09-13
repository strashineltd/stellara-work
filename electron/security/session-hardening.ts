// electron/security/session-hardening.ts
// 统一的 Electron session 加固入口：
//  - 系统权限（摄像头/麦克风/定位/通知…）一律拒绝
//  - 网络请求级 SSRF 过滤（含重定向、页面子资源、fetch/img/form）
// 所有 BrowserService 分区 session 与 defaultSession 都必须经过这里，未来新增 session 不得绕过。
import { checkUrlDestination, type DnsLookup } from './net-policy';

export interface HardenSessionDeps {
  /** 测试注入 DNS；生产走 net-policy 默认 lookup */
  lookup?: DnsLookup;
  /** 被拦截时的日志回调（可选，避免依赖 electron-log） */
  onBlocked?: (url: string, reason?: string) => void;
}

const REQUEST_FILTER = {
  urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
};

/** 同一 session 只安装一次网络过滤器（同分区多标签会重复到达这里） */
const networkHardened = new WeakSet<object>();

/** 权限处理器：请求与检查一律返回 false（Electron 默认是自动放行） */
export function hardenSessionPermissions(ses: any): void {
  if (!ses) return;
  if (typeof ses.setPermissionRequestHandler === 'function') {
    ses.setPermissionRequestHandler(
      (_webContents: unknown, _permission: string, callback: (granted: boolean) => void) => callback(false),
    );
  }
  if (typeof ses.setPermissionCheckHandler === 'function') {
    ses.setPermissionCheckHandler(() => false);
  }
}

/** 请求级 SSRF 过滤：同步字面量检查 + 异步 DNS 校验，解析失败 fail-closed 取消 */
export function hardenSessionNetwork(ses: any, deps: HardenSessionDeps = {}): void {
  if (!ses || typeof ses.webRequest?.onBeforeRequest !== 'function') return;
  if (networkHardened.has(ses)) return;
  networkHardened.add(ses);
  ses.webRequest.onBeforeRequest(
    REQUEST_FILTER,
    (details: { url: string }, callback: (response: { cancel: boolean }) => void) => {
      void checkUrlDestination(details.url, { lookup: deps.lookup })
        .then((v) => {
          if (!v.ok) deps.onBlocked?.(details.url, v.error);
          callback({ cancel: !v.ok });
        })
        .catch(() => {
          // 意外异常同样拒绝（安全默认）
          callback({ cancel: true });
        });
    },
  );
}

/** 权限 + 网络双重加固；对缺少相应 API 的测试替身安全跳过 */
export function hardenSession(ses: any, deps: HardenSessionDeps = {}): void {
  hardenSessionPermissions(ses);
  hardenSessionNetwork(ses, deps);
}
