import { useEffect, useState } from 'react';
import type { FsNode } from '../../shared/ipc';
import { Icon } from './Icon';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  }

  const nodeBadge = badge?.(node);

  return (
    <li>
      <div
        className={`ftree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => {
          if (isDir) onToggle(node.path);
          else onSelect(node.path);
        }}
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
      {menuOpen && menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          isDir={isDir}
          path={node.path}
          workDir={workDir}
          onClose={() => { setMenuOpen(false); setMenuPos(null); }}
        />
      )}
    </li>
  );
}

function ContextMenu({ x, y, isDir, path, onClose, workDir }: {
  x: number; y: number; isDir: boolean; path: string; onClose: () => void; workDir: string;
}) {
  useEffect(() => {
    const onClick = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
      onClick={(e) => e.stopPropagation()}
    >
      <li onClick={() => { void copyPath(); onClose(); }}>
        <Icon name="copy" size={14} />
        <span>复制路径</span>
      </li>
      <li onClick={() => { void openInExplorer(); onClose(); }}>
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
