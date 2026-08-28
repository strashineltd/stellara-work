import { useEffect, useRef, useState } from 'react';
import type { FsNode } from '../../shared/ipc';
import { Icon } from './Icon';
import { usePresence } from '../hooks/usePresence';
import { presenceRootProps, restoreFocusTarget, type MotionPresence } from '../lib/presence-ui';

export interface FileTreeNodeProps {
  node: FsNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  workDir: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  /** Optional compact marker displayed at the end of a row. */
  badge?: (node: FsNode) => string | undefined;
}

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  side: 'bottom';
  path: string;
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

/**
 * 文件树节点（递归）。
 * 复用 FileTreeModal 的实现，独立成模块给 WorkspacePanel 也用。
 */
export function FileTreeNode({
  node,
  depth,
  expanded,
  selected,
  workDir,
  onToggle,
  onSelect,
  badge,
}: FileTreeNodeProps) {
  const isDir = node.type === 'dir';
  const isOpen = expanded.has(node.path);
  const isSelected = selected === node.path;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuPresence = usePresence(menu?.open === true, 120);
  const menuOpenRef = useRef(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const menuOpen = menu?.open === true;

  function closeMenu(restoreFocus = true): boolean {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    if (restoreFocus) restoreFocusTarget(rowRef.current);
    setMenu((current) => (current?.open ? { ...current, open: false } : current));
    return true;
  }

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.context-menu')) return;
      closeMenu(getPointerFocusTarget(e.target) === null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu(true);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuPresence.mounted || !menu || menu.open) return;
    setMenu(null);
    menuOpenRef.current = false;
  }, [menu, menuPresence.mounted]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    menuOpenRef.current = true;
    setMenu({ open: true, x: e.clientX, y: e.clientY, side: 'bottom', path: node.path });
  }

  function handleRowAction() {
    if (isDir) onToggle(node.path);
    else onSelect(node.path);
  }

  function handleRowKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleRowAction();
  }

  const nodeBadge = badge?.(node);

  return (
    <li>
      <div
        ref={rowRef}
        className={`ftree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        tabIndex={0}
        onClick={handleRowAction}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleContextMenu}
        title={node.path}
      >
        <span className="ftree-disclosure">
          {isDir && <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />}
        </span>
        <span className="ftree-icon"><Icon name={isDir ? 'folder' : 'file'} size={14} /></span>
        <span className="ftree-name">{node.name}</span>
        {nodeBadge && <span className="ftree-badge">{nodeBadge}</span>}
        {node.size !== undefined && !isDir && (
          <span className="ftree-size">{formatSize(node.size)}</span>
        )}
      </div>
      {isDir && isOpen && node.children && node.children.length > 0 && (
        <ul className="ftree">
          {node.children.map((c) => (
            <FileTreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              workDir={workDir}
              onToggle={onToggle}
              onSelect={onSelect}
              badge={badge}
            />
          ))}
        </ul>
      )}
      {menuPresence.mounted && menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          isDir={isDir}
          path={menu.path}
          workDir={workDir}
          side={menu.side}
          presence={menuPresence}
          onClose={closeMenu}
        />
      )}
    </li>
  );
}

function ContextMenu({ x, y, isDir, path, onClose, workDir, side, presence }: {
  x: number;
  y: number;
  isDir: boolean;
  path: string;
  onClose: (restoreFocus?: boolean) => boolean;
  workDir: string;
  side: 'bottom';
  presence: MotionPresence;
}) {
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // ignore
    }
  }

  function openInExplorer() {
    void window.electronAPI.fs.openPath(workDir, path).catch((e: unknown) => {
      console.error('openPath failed:', e);
    });
  }

  return (
    <ul
      className="context-menu"
      style={{ position: 'fixed', top: y, left: x }}
      data-motion="menu"
      data-side={side}
      {...presenceRootProps(presence)}
      onClick={(e) => e.stopPropagation()}
    >
      <li onClick={() => { if (!onClose(true)) return; void copyPath(); }}>
        <Icon name="copy" size={14} />
        <span>复制路径</span>
      </li>
      <li onClick={() => { if (!onClose(true)) return; void openInExplorer(); }}>
        <Icon name="folder" size={14} />
        <span>{isDir ? '在资源管理器打开' : '在默认应用打开'}</span>
      </li>
    </ul>
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
