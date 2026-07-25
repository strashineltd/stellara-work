import type { SessionSummary } from '../../shared/ipc';

interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/**
 * 左侧会话列表
 * - 顶部「+ 新建会话」按钮
 * - 每条：title + 消息数 + 时间
 * - 活跃会话左边高亮，hover 时显示 × 按钮删除
 */
export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="btn btn-primary btn-new-session" onClick={onNew} type="button">
          ＋ 新建会话
        </button>
      </div>
      <ul className="session-list">
        {sessions.length === 0 && (
          <li className="session-empty">还没有会话<br />点上方按钮创建</li>
        )}
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="session-title">{s.title}</div>
            <div className="session-meta">
              <span className="session-count">{s.messageCount} 条</span>
              <span className="session-time">{formatTime(s.updatedAt)}</span>
            </div>
            <button
              className="session-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`删除会话「${s.title}」？`)) onDelete(s.id);
              }}
              title="删除会话"
              type="button"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return '刚刚';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
