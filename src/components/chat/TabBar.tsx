import { useState, useRef, useEffect } from 'react';
import { Icon } from '../Icon';

export type TabBarTab = {
  id: string;
  title: string;
  status: 'active' | 'waiting' | 'idle';
};

interface TabBarProps {
  tabs: TabBarTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onRename?: (id: string) => void;
  onCloseOthers?: (id: string) => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNewTab, onRename, onCloseOthers }: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  function handleContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }

  return (
    <div className="tab-bar" role="tablist" aria-label="打开的会话">
      {tabs.map((t, index) => (
        <div key={t.id} className={`tab-chip-shell${t.id === activeId ? ' tab-chip-shell--active' : ''}`}>
          <button
            role="tab"
            type="button"
            id={`session-tab-${t.id}`}
            aria-selected={t.id === activeId}
            tabIndex={t.id === activeId ? 0 : -1}
            data-tab-id={t.id}
            className={`tab-chip${t.id === activeId ? ' tab-chip--active' : ''}`}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => handleContextMenu(e, t.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              let nextIndex = index;
              if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
              if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
              if (event.key === 'Home') nextIndex = 0;
              if (event.key === 'End') nextIndex = tabs.length - 1;
              const next = tabs[nextIndex];
              if (!next) return;
              onSelect(next.id);
              requestAnimationFrame(() => {
                document.getElementById(`session-tab-${next.id}`)?.focus();
              });
            }}
          >
            <span className={`tab-chip-dot tab-chip-dot--${t.status}`} aria-hidden="true" />
            <span className="tab-chip-title">{t.title}</span>
          </button>
          <button
            type="button"
            className="tab-chip-close"
            aria-label={`关闭标签页：${t.title}`}
            title={`关闭 ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <button
        className="tab-chip tab-chip--new"
        onClick={onNewTab}
        aria-label="新建会话标签页"
        title="新建会话"
        type="button"
      >
        <Icon name="plus" size={14} />
      </button>

      {contextMenu && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          {onRename && (
            <button
              className="tab-context-menu-item"
              type="button"
              role="menuitem"
              onClick={() => { onRename(contextMenu.tabId); setContextMenu(null); }}
            >
              重命名
            </button>
          )}
          {onCloseOthers && (
            <button
              className="tab-context-menu-item"
              type="button"
              role="menuitem"
              onClick={() => { onCloseOthers(contextMenu.tabId); setContextMenu(null); }}
            >
              关闭其他
            </button>
          )}
          <button
            className="tab-context-menu-item"
            type="button"
            role="menuitem"
            onClick={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
