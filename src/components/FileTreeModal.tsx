import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { FsNode } from '../../shared/ipc';
import { FileTreeNode, formatSize } from './FileTreeNode';
import { Icon } from './Icon';
import { NewEntryMenu } from './files/NewEntryMenu';
import { presenceRootProps, type PresenceMotionProps } from '../lib/presence-ui';

interface FileTreeModalProps extends PresenceMotionProps {
  workDir: string;
  onClose: () => void;
}

/**
 * 文件树 modal
 * - 左：树（可展开/折叠）
 * - 右：选中的文件预览
 */
export function FileTreeModal({ workDir, onClose, presence }: FileTreeModalProps) {
  const [tree, setTree] = useState<FsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([workDir]));
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ content: string; size: number; truncated: boolean } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const currentWorkDirRef = useRef<string | null>(workDir);
  const treeRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  useLayoutEffect(() => {
    currentWorkDirRef.current = workDir;
    treeRequestRef.current += 1;
    previewRequestRef.current += 1;
    setTree(null);
    setExpanded(new Set([workDir]));
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setTreeError(null);

    return () => {
      if (currentWorkDirRef.current === workDir) currentWorkDirRef.current = null;
      treeRequestRef.current += 1;
      previewRequestRef.current += 1;
    };
  }, [workDir]);

  useLayoutEffect(() => {
    if (presence?.state === 'entering') {
      closeButtonRef.current?.focus({ preventScroll: true });
    }
  }, [presence?.state]);

  const loadTree = useCallback(() => {
    const requestWorkDir = workDir;
    if (currentWorkDirRef.current !== requestWorkDir) return;
    const request = ++treeRequestRef.current;
    setTreeError(null);
    window.electronAPI.fs.listTree(requestWorkDir, 4)
      .then((t) => {
        if (currentWorkDirRef.current === requestWorkDir && treeRequestRef.current === request) {
          setTree(t);
        }
      })
      .catch((e) => {
        if (currentWorkDirRef.current === requestWorkDir && treeRequestRef.current === request) {
          setTreeError(e instanceof Error ? e.message : String(e));
        }
      });
  }, [workDir]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && presence?.state !== 'closing') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, presence?.state]);

  const loadPreview = useCallback(async (path: string) => {
    const requestWorkDir = workDir;
    if (currentWorkDirRef.current !== requestWorkDir) return;
    const request = ++previewRequestRef.current;
    setSelected(path);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const r = await window.electronAPI.fs.readFile(requestWorkDir, path, 100 * 1024);
      if (currentWorkDirRef.current === requestWorkDir && previewRequestRef.current === request) {
        setPreview(r);
      }
    } catch (e) {
      if (currentWorkDirRef.current === requestWorkDir && previewRequestRef.current === request) {
        setPreviewError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (currentWorkDirRef.current === requestWorkDir && previewRequestRef.current === request) {
        setPreviewLoading(false);
      }
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
    <div
      className="modal-backdrop"
      {...presenceRootProps(presence)}
      onClick={() => {
        if (presence?.state !== 'closing') onClose();
      }}
    >
      <div
        className="modal file-tree-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-tree-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="file-tree-header">
          <h3 id="file-tree-title">文件浏览 · {workDir}</h3>
          <div className="file-tree-header__actions">
            <NewEntryMenu key={workDir} workDir={workDir} onCreated={loadTree} />
            <button
              ref={closeButtonRef}
              className="btn-icon"
              onClick={() => {
                if (presence?.state !== 'closing') onClose();
              }}
              type="button"
              title="关闭"
              aria-label="关闭文件浏览"
              autoFocus
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        <div className="file-tree-body">
          <div className="file-tree-pane">
            {treeError && <p className="empty-hint error">{treeError}</p>}
            {!treeError && !tree && <p className="empty-hint" role="status">正在加载文件…</p>}
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
            {selected && previewLoading && <p className="empty-hint" role="status">正在加载预览…</p>}
            {selected && previewError && <p className="empty-hint error">{previewError}</p>}
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
