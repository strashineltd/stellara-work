import type { ErrorMeta } from '../../shared/ipc';
import { Icon } from './Icon';

interface ErrorBannerProps {
  message: string;
  meta?: ErrorMeta;
  onOpenSettings?: () => void;
  onSwitchModel?: () => void;
  onRetry?: () => void;
}

/**
 * 错误横幅
 *
 * - 普通错误（无 meta）→ 红色 banner + 重试按钮
 * - 分类错误（带 meta）→ 顶部图标 + 简明消息 + 中文引导 + 行动按钮
 *
 * 行动按钮按 meta.action 自动出现：
 *   - open_settings → 打开 Settings
 *   - switch_model → 提示去切 model
 *   - check_network → 提示检查网络（无按钮）
 *   - retry → 总是显示（如 retryable）
 */
export function ErrorBanner({ message, meta, onOpenSettings, onSwitchModel, onRetry }: ErrorBannerProps) {
  const action = meta?.action;
  const showRetry = meta?.retryable ?? true;

  return (
    <div className={`error-banner ${meta ? `error-banner-${meta.kind}` : ''}`}>
      <div className="error-banner-header">
        <span className="error-icon"><Icon name="alert" size={17} /></span>
        <span className="error-text">
          {meta ? friendlyTitle(meta.kind) : message}
        </span>
        {(showRetry && onRetry) && (
          <button className="btn btn-secondary btn-retry" onClick={onRetry} type="button">
            <Icon name="refresh" size={14} />
            <span>重试</span>
          </button>
        )}
      </div>
      {meta?.hint && (
        <div className="error-banner-hint">{meta.hint}</div>
      )}
      {!meta && message && (
        <pre className="error-banner-detail">{message}</pre>
      )}
      <div className="error-banner-actions">
        {action === 'open_settings' && onOpenSettings && (
          <button className="btn btn-secondary btn-small" onClick={onOpenSettings} type="button">
            <Icon name="settings" size={14} />
            <span>打开设置</span>
          </button>
        )}
        {action === 'switch_model' && onSwitchModel && (
          <button className="btn btn-secondary btn-small" onClick={onSwitchModel} type="button">
            <Icon name="refresh" size={14} />
            <span>切换模型</span>
          </button>
        )}
        {action === 'check_network' && (
          <span className="error-banner-note">
            检查网络或 Base URL（设置 → 模型）
          </span>
        )}
      </div>
    </div>
  );
}

function friendlyTitle(kind: string): string {
  switch (kind) {
    case 'auth': return 'API key 无效';
    case 'rate_limit': return '请求被限流（429）';
    case 'quota': return 'API 余额不足';
    case 'model_not_found': return 'Model 不存在';
    case 'context_too_long': return '上下文窗口超出';
    case 'invalid_request': return '请求格式错误';
    case 'server': return 'Provider 服务端错误';
    case 'network': return '网络连接失败';
    case 'idle_timeout': return '流空闲超时';
    case 'user_aborted': return '已取消';
    default: return '出现错误';
  }
}
