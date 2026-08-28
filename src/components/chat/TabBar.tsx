import { useState, useRef, useEffect } from 'react';
import { Icon } from '../Icon';
import { usePresence } from '../../hooks/usePresence';
import { presenceRootProps, restoreFocusTarget } from '../../lib/presence-ui';

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
  onNewTab: (returnFocus?: HTMLElement | null) => void;
  onRename?: (id: string) => void;
  onCloseOthers?: (id: string) => void;
}

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  side: 'bottom';
  tabId: string;
};

const POINTER_FOCUS_TARGET = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getPointerFocusTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const candidate = target.closest<HTMLElement>(POINTER_FOCUS_TARGET);
  if (
    !candidate?.isConnected
    || candidate.matches(':disabled, [aria-disabled="true"]')
    || candidate.closest('[inert], [aria-hidden="true"]')
  ) {
    return null;
  }
  return candidate;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNewTab, onRename, onCloseOthers }: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuPresence = usePresence(contextMenu?.open === true, 120);
  const menuOpenRef = useRef(false);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const newTabRef = useRef<HTMLButtonElement | null>(null);
  const contextMenuOpen = contextMenu?.open === true;
  const menuTabId = contextMenu?.tabId ?? '';

  function closeContextMenu(
    primary: HTMLElement | null,
    fallback: HTMLElement | null,
    restoreFocus = true,
  ): boolean {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    if (restoreFocus) restoreFocusTarget(primary, fallback);
    setContextMenu((current) => (current?.open ? { ...current, open: false } : current));
    return true;
  }

  useEffect(() => {
    if (!contextMenuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.tab-context-menu')) return;
      closeContextMenu(chipRefs.current[menuTabId] ?? null, newTabRef.current, getPointerFocusTarget(e.target) === null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu(chipRefs.current[menuTabId] ?? null, newTabRef.current);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenuOpen, menuTabId]);

  useEffect(() => {
    if (contextMenuPresence.mounted || !contextMenu || contextMenu.open) return;
    setContextMenu(null);
    menuOpenRef.current = false;
  }, [contextMenu, contextMenuPresence.mounted]);

  function handleContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    menuOpenRef.current = true;
    setContextMenu({ open: true, x: e.clientX, y: e.clientY, side: 'bottom', tabId });
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
            aria-haspopup="menu"
            aria-expanded={contextMenuOpen && menuTabId === t.id}
            tabIndex={t.id === activeId ? 0 : -1}
            data-tab-id={t.id}
            ref={(el) => {
              chipRefs.current[t.id] = el;
            }}
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
        ref={newTabRef}
        className="tab-chip tab-chip--new"
        onClick={(event) => onNewTab(event.currentTarget)}
        aria-label="新建会话标签页"
        title="新建会话"
        type="button"
      >
        <Icon name="plus" size={14} />
      </button>

      {contextMenuPresence.mounted && contextMenu && (
        <div
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          data-motion="menu"
          data-side={contextMenu.side}
          {...presenceRootProps(contextMenuPresence)}
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              className="tab-context-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                if (!closeContextMenu(chipRefs.current[contextMenu.tabId] ?? null, newTabRef.current)) return;
                onRename(contextMenu.tabId);
              }}
            >
              重命名
            </button>
          )}
          {onCloseOthers && (
            <button
              className="tab-context-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                if (!closeContextMenu(chipRefs.current[contextMenu.tabId] ?? null, newTabRef.current)) return;
                onCloseOthers(contextMenu.tabId);
              }}
            >
              关闭其他
            </button>
          )}
          <button
            className="tab-context-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              if (!closeContextMenu(newTabRef.current, chipRefs.current[contextMenu.tabId] ?? null)) return;
              onClose(contextMenu.tabId);
            }}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
