import { useEffect, useState } from 'react';
import type { FsNode } from '../../../shared/ipc';
import { filePreviewCache } from '../../lib/file-preview-cache';
import { FileTreeNode } from '../FileTreeNode';
import { Icon } from '../Icon';

export interface SidebarFileViewProps {
  workDir: string | null;
  onOpenFullScreen?: () => void;
}

/**
 * 侧边栏文件视图：上树下预览（55/45），点击预览，双击用系统应用打开。
 */
export function SidebarFileView({ workDir, onOpenFullScreen }: SidebarFileViewProps) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ content: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTree(null);
    setSelected(null);
    setPreview(null);
    setError(null);
    if (!workDir) return;
    filePreviewCache.clearForWorkDir(workDir);
    setExpanded(new Set([workDir]));
    let cancelled = false;
    window.electronAPI.fs.listTree(workDir, 4)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    return () => { cancelled = true; };
  }, [workDir]);

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleSelect(path: string) {
    if (!workDir) return;
    setSelected(path);
    setError(null);
    const cached = filePreviewCache.get(workDir, path);
    if (cached) {
      setPreview(cached);
      return;
    }
    try {
      const r = await window.electronAPI.fs.readFile(workDir, path, 100 * 1024);
      filePreviewCache.set(workDir, path, { content: r.content, truncated: r.truncated });
      setPreview({ content: r.content, truncated: r.truncated });
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    if (!workDir) return;
    const row = (e.target as HTMLElement).closest?.('.ftree-row');
    const path = row?.getAttribute('title');
    if (path) void window.electronAPI.fs.openPath(workDir, path).catch(() => {});
  }

  function refresh() {
    if (!workDir) return;
    setError(null);
    window.electronAPI.fs.listTree(workDir, 4)
      .then((t) => setTree(t))
      .catch((e) => setError(errorMessage(e)));
  }

  return (
    <div className="sidebar-file-view">
      <div className="sidebar-file-view__toolbar">
        <button
          className="btn-icon btn-icon-small sidebar-file-view__refresh"
          type="button"
          title="刷新"
          aria-label="刷新文件树"
          disabled={!workDir}
          onClick={refresh}
        >
          <Icon name="refresh" size={14} />
        </button>
        <button
          className="btn-icon btn-icon-small"
          type="button"
          title="全屏浏览"
          aria-label="全屏浏览文件"
          disabled={!workDir || !onOpenFullScreen}
          onClick={onOpenFullScreen}
        >
          <Icon name="file-tree" size={14} />
        </button>
      </div>
      <div className="sidebar-file-view__tree" onDoubleClick={handleDoubleClick}>
        {!workDir && <p className="empty-hint sidebar-file-view__empty">先创建或选择一个项目</p>}
        {workDir && error && <p className="empty-hint error sidebar-file-view__error">{error}</p>}
        {workDir && !error && !tree && <p className="empty-hint" role="status">正在加载文件…</p>}
        {workDir && tree && (
          <ul className="ftree">
            <FileTreeNode
              node={tree}
              depth={0}
              expanded={expanded}
              selected={selected}
              workDir={workDir}
              onToggle={toggleExpand}
              onSelect={handleSelect}
            />
          </ul>
        )}
      </div>
      <div className="sidebar-file-view__preview">
        {!selected && <p className="empty-hint sidebar-file-view__empty">点上面的文件预览</p>}
        {selected && !preview && !error && <p className="empty-hint" role="status">正在加载预览…</p>}
        {selected && error && <p className="empty-hint error sidebar-file-view__error">{error}</p>}
        {selected && preview && (
          <>
            <div className="sidebar-file-view__preview-head">
              <code className="sidebar-file-view__preview-path">{selected}</code>
              {preview.truncated && <span className="sidebar-file-view__preview-truncated">已截断</span>}
            </div>
            <pre className="sidebar-file-view__preview-content">{preview.content}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
