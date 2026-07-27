import { useState, useEffect, useRef, useMemo } from 'react';
import type { SessionSummary } from '../../shared/ipc';

interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  /** 'full' = normal sidebar with active highlight; 'compact' = skip active-highlight (used in tabs mode) */
  mode?: 'full' | 'compact';
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport?: (id: string) => void;
}

/** Truncate title to maxLen chars, appending ellipsis if needed. */
function truncateTitle(title: string, maxLen = 28): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + '…';
}

/** Format a timestamp into a short relative string. */
function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function Sidebar({ sessions, activeId, mode, onSelect, onNew, onDelete, onRename, onExport }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(
    () => (search ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase())) : sessions),
    [sessions, search],
  );

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuId) return;
    const h = () => setMenuId(null);
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, [menuId]);

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

  function handleRowContextMenu(e: React.MouseEvent, s: SessionSummary) {
    e.preventDefault();
    setMenuId(menuId === s.id ? null : s.id);
  }

  return (
    <aside className="sidebar">
      {/* Brand mark */}
      <div className="sidebar-brand">
        <span className="sidebar-brand-text">Stellara</span>
      </div>

      {/* New session button */}
      <div className="sidebar-header">
        <button className="btn-new-session" onClick={onNew} type="button">
          + New session
        </button>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <input
          className="sidebar-search-input"
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="sidebar-search-clear" onClick={() => setSearch('')} type="button" title="Clear">
            &times;
          </button>
        )}
      </div>

      {/* Session list */}
      <ul className="session-list">
        {filtered.length === 0 && (
          <li className="session-empty">
            {search ? 'No matches' : 'No sessions yet'}
          </li>
        )}
        {filtered.map((s) => {
          const isActive = s.id === activeId;
          // In compact mode (tabs), skip the active highlight — the TabBar handles it
          const rowClass = [
            'session-row',
            (isActive && mode !== 'compact') ? 'session-row--active' : 'session-row--idle',
          ].join(' ');

          // Status icon glyph
          const statusGlyph = isActive ? '●' : '◯'; // ● active, ◯ idle

          return (
            <li
              key={s.id}
              className={rowClass}
              data-session-id={s.id}
              onClick={() => onSelect(s.id)}
              onContextMenu={(e) => handleRowContextMenu(e, s)}
            >
              <span className="session-status-icon" aria-hidden="true">
                {statusGlyph}
              </span>

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
                <span
                  className="session-title"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEdit(s);
                  }}
                  title={s.title}
                >
                  {truncateTitle(s.title)}
                </span>
              )}

              <span className="session-time">{formatRelativeTime(s.updatedAt)}</span>

              {/* Context menu */}
              {menuId === s.id && (
                <div className="session-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="session-menu-item"
                    onClick={() => {
                      setEditingId(s.id);
                      setEditValue(s.title);
                      setMenuId(null);
                    }}
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    className="session-menu-item"
                    onClick={() => { onDelete(s.id); setMenuId(null); }}
                    type="button"
                  >
                    Delete
                  </button>
                  {onExport && (
                    <button
                      className="session-menu-item"
                      onClick={() => { onExport(s.id); setMenuId(null); }}
                      type="button"
                    >
                      Export JSON
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Bottom fixed area */}
      <div className="sidebar-footer">
        <button
          className="sidebar-settings-link"
          onClick={() => {
            // Trigger settings modal open — dispatch a custom event that App.tsx listens to
            window.dispatchEvent(new CustomEvent('stellara:open-settings'));
          }}
          type="button"
        >
          Settings
        </button>
      </div>
    </aside>
  );
}
