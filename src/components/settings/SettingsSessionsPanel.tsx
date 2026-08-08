import { useEffect, useState } from 'react';
import type { SessionSummary } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface SettingsSessionsPanelProps {
  /** 数据变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 2 * 86_400_000) return '昨天';
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function projectName(s: SessionSummary): string {
  if (!s.workDir) return '未分组';
  const segments = s.workDir.split(/[\\/]/).filter(Boolean);
  return segments.pop() ?? s.workDir;
}

/**
 * 设置窗口「会话」面板：最近会话列表（删除）+ 数据管理危险区（清空所有会话）。
 * 逻辑迁移自 SettingsModal 的 sessions 部分；清空后不 reload，改用 onChanged 同步。
 */
export function SettingsSessionsPanel({ onChanged, refreshKey = 0 }: SettingsSessionsPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSessions(await window.electronAPI.sessions.list());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshKey]);

  async function handleDeleteSession(id: string) {
    if (!confirm('删除该会话？')) return;
    try {
      await window.electronAPI.sessions.delete(id);
      setSessions(await window.electronAPI.sessions.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleClearAll() {
    if (!confirm('清空所有会话？删除全部会话与消息，不可恢复。')) return;
    try {
      await window.electronAPI.settings.resetSelective('sessions');
      setSessions(await window.electronAPI.sessions.list());
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>会话</h2>
          <div className="sub">管理本地会话记录</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section__title">最近会话 <span className="count">{sessions.length}</span></div>
        <div className="settings-group">
          {sessions.length === 0 && <p className="empty-hint">还没有会话</p>}
          {sessions.map((s) => (
            <div key={s.id} className="settings-item settings-session-row">
              <div className="settings-item__grow">
                <div className="settings-item__title">{s.title}</div>
                <div className="settings-item__hint">
                  {formatRelativeTime(s.updatedAt)} · {projectName(s)}
                </div>
              </div>
              <button
                className="icon-btn danger"
                title="删除"
                aria-label={`删除会话 ${s.title}`}
                onClick={() => void handleDeleteSession(s.id)}
                type="button"
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">数据管理</div>
        <div className="settings-group settings-danger-zone">
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">清空所有会话</div>
              <div className="settings-item__hint">删除全部会话与消息，不可恢复</div>
            </div>
            <button className="btn btn-danger" onClick={() => void handleClearAll()} type="button">清空</button>
          </div>
        </div>
      </div>
    </div>
  );
}
