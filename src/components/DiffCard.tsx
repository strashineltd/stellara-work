import { useState, useRef, useEffect, useMemo } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { MergeView } from '@codemirror/merge';
import { defaultKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { Icon } from './Icon';
import { HoverablePath } from './hover/HoverablePath';

interface DiffCardProps {
  path: string;
  before: string | null;
  after: string;
  workDir?: string;
}

function getLangExtension(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': case 'mts': case 'cts':
      return javascript({ typescript: true });
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      return javascript();
    case 'json': case 'jsonc':
      return json();
    case 'html': case 'htm':
      return html();
    case 'css': case 'scss': case 'less':
      return css();
    case 'py':
      return python();
    case 'md': case 'markdown':
      return markdown();
    default:
      return [];
  }
}

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

export function DiffCard({ path, before, after, workDir }: DiffCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | EditorView | null>(null);
  const [open, setOpen] = useState(true);

  const isNew = before === null;

  const stats = useMemo(() => {
    if (isNew) return null;
    const beforeLines = (before ?? '').split('\n');
    const afterLines = after.split('\n');
    let added = 0;
    let removed = 0;
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= beforeLines.length) added++;
      else if (i >= afterLines.length) removed++;
      else if (beforeLines[i] !== afterLines[i]) {
        added++;
        removed++;
      }
    }
    return { added, removed };
  }, [before, after, isNew]);

  useEffect(() => {
    if (!containerRef.current || !open) return;

    // Destroy previous view
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    containerRef.current.innerHTML = '';

    const dark = isDarkTheme();
    const langExt = getLangExtension(path);
    const themeExtensions = dark ? [oneDark] : [];
    const baseExtensions = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      keymap.of(defaultKeymap),
      langExt,
      ...themeExtensions,
    ];

    if (isNew || !before) {
      // New file: show read-only editor with after content
      const state = EditorState.create({
        doc: after,
        extensions: [...baseExtensions, EditorView.lineWrapping],
      });
      const view = new EditorView({
        state,
        parent: containerRef.current,
      });
      viewRef.current = view;
    } else {
      // Modified file: show merge view
      const mergeView = new MergeView({
        a: { doc: before, extensions: baseExtensions },
        b: { doc: after, extensions: baseExtensions },
        parent: containerRef.current,
        orientation: 'a-b',
        highlightChanges: true,
        gutter: true,
      });
      viewRef.current = mergeView;
    }

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [path, before, after, open, isNew]);

  return (
    <div className="tool-card tool-card-diff">
      <button
        type="button"
        className="tool-card-header"
        onClick={() => setOpen((o) => !o)}
        title={open ? '折叠' : '展开 diff'}
      >
        <span className="tool-card-icon"><Icon name={isNew ? 'file' : 'edit'} size={14} /></span>
        <span className="tool-card-name">
          {workDir
            ? <HoverablePath path={path} workDir={workDir}>{path}</HoverablePath>
            : <span>{path}</span>}
        </span>
        <span className="tool-card-summary">
          {isNew ? '新文件' : stats && (
            <>
              <span className="diff-add">+{stats.added}</span>{' '}
              <span className="diff-remove">-{stats.removed}</span>
            </>
          )}
        </span>
        <span className="tool-card-chevron">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        </span>
      </button>
      {open && (
        <div className="diff-codemirror-container" ref={containerRef} />
      )}
    </div>
  );
}
