import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { filePreviewCache } from '../../lib/file-preview-cache';

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 320;

interface FileHoverPreviewProps {
  anchor: { x: number; y: number };
  path: string;
  workDir: string;
  onClose: () => void;
  onHoverChange?: (inside: boolean) => void;
}

export function FileHoverPreview({ anchor, path, workDir, onClose, onHoverChange }: FileHoverPreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = filePreviewCache.get(workDir, path);
    if (cached !== null) {
      setContent(cached.content);
      setTruncated(cached.truncated);
      return;
    }
    void window.electronAPI.fs
      .readFile(workDir, path, 100 * 1024)
      .then((res) => {
        if (cancelled) return;
        setContent(res.content);
        setTruncated(res.truncated);
        filePreviewCache.set(workDir, path, { content: res.content, truncated: res.truncated });
      })
      .catch(() => {
        if (!cancelled) setError('无法预览此文件');
      });
    return () => {
      cancelled = true;
    };
  }, [workDir, path]);

  const left = window.innerWidth - anchor.x < PREVIEW_WIDTH ? Math.max(0, anchor.x - PREVIEW_WIDTH) : anchor.x;
  const top = window.innerHeight - anchor.y < PREVIEW_HEIGHT ? anchor.y - PREVIEW_HEIGHT - 8 : anchor.y;

  const openFile = () => {
    void window.electronAPI.fs.openPath(workDir, path);
    onClose();
  };

  return createPortal(
    <div
      className="file-hover-preview"
      style={{ left, top }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="file-hover-preview__head">
        <span className="file-hover-preview__path" title={path}>
          {path}
        </span>
        <button type="button" className="file-hover-preview__open" onClick={openFile}>
          打开
        </button>
      </div>
      {error ? (
        <div className="file-hover-preview__error">{error}</div>
      ) : (
        <>
          <pre className="file-hover-preview__body">{content ?? ''}</pre>
          {truncated && <div className="file-hover-preview__truncated">已截断</div>}
        </>
      )}
    </div>,
    document.body,
  );
}
