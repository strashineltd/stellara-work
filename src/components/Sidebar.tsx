import { useState, useEffect, useRef } from 'react';
import type { SessionSummary } from '../../shared/ipc';

interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

/**
 * 左侧会话列表
 * - 顶部「+ 新建会话」按钮
 * - 每条：title（双击重命名）+ 消息数 + 时间 + × 删除（常驻）
 */
export function Sidebar({ sessions, activeId, onSelect, onNew, onDelete, onRename }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  function startEdit(s: SessionSummary) {
    setEditingId(s.id);
    setEditValue(s.title);
  }

  function commitEdit() {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim().slice(0, 50));
    }
    setEditingId(null);
    setEditValue('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

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
            {editingId === s.id ? (
              <input
                ref={editInputRef}
                className="session-title-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitEdit();
                  else if (e.key === 'Escape') cancelEdit();
                  else if (e.key === 'Tab') commitEdit();
                }}
                onBlur={commitEdit}
                maxLength={50}
              />
            ) : (
              <div
                className="session-title"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit(s);
                }}
                title="双击重命名"
              >
                {s.title}
              </div>
            )}
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
