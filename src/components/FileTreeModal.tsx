import { useEffect, useState, useCallback } from 'react';
import type { FsNode } from '../../shared/ipc';
import { FileTreeNode, formatSize } from './FileTreeNode';

interface FileTreeModalProps {
  workDir: string;
  onClose: () => void;
}

/**
 * 文件树 modal
 * - 左：树（可展开/折叠）
 * - 右：选中的文件预览
 */
export function FileTreeModal({ workDir, onClose }: FileTreeModalProps) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([workDir]));
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ content: string; size: number; truncated: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.fs.listTree(workDir, 4)
      .then((t) => { if (!cancelled) setTree(t); })
      .catch((e) => { if (!cancelled) setTreeError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [workDir]);

  const loadPreview = useCallback(async (path: string) => {
    setSelected(path);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const r = await window.electronAPI.fs.readFile(workDir, path, 100 * 1024);
      setPreview(r);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, [workDir]);

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal file-tree-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-tree-header">
          <h3>文件浏览 · {workDir}</h3>
          <button className="btn-icon" onClick={onClose} type="button" title="关闭">×</button>
        </div>
        <div className="file-tree-body">
          <div className="file-tree-pane">
            {treeError && <p className="empty-hint">⚠ {treeError}</p>}
            {!treeError && !tree && <p className="empty-hint">加载中...</p>}
            {tree && (
              <ul className="ftree">
                <FileTreeNode
                  node={tree}
                  depth={0}
                  expanded={expanded}
                  selected={selected}
                  workDir={workDir}
                  onToggle={toggleExpand}
                  onSelect={loadPreview}
                />
              </ul>
            )}
          </div>
          <div className="file-preview-pane">
            {!selected && <p className="empty-hint">点左边的文件预览</p>}
            {selected && previewLoading && <p className="empty-hint">加载中...</p>}
            {selected && previewError && <p className="empty-hint error">⚠ {previewError}</p>}
            {selected && preview && (
              <>
                <div className="file-preview-header">
                  <code className="file-preview-path">{selected}</code>
                  <span className="file-preview-size">
                    {formatSize(preview.size)}
                    {preview.truncated && ' (已截断)'}
                  </span>
                </div>
                <pre className="file-preview-content">{preview.content}</pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
