import { useState, useRef, useEffect, useMemo } from 'react';
import type { Extension } from '@codemirror/state';
import { Icon } from './Icon';
import { HoverablePath } from './hover/HoverablePath';

interface DiffCardProps {
  path: string;
  before: string | null;
  after: string;
  workDir?: string;
}

/** 语言包懒加载：仅在展开且命中扩展名时 import（P4，避免进主 chunk） */
async function loadLangExtension(filePath: string): Promise<Extension> {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': case 'mts': case 'cts': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ typescript: true });
    }
    case 'js': case 'jsx': case 'mjs': case 'cjs': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript();
    }
    case 'json': case 'jsonc': {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
    case 'html': case 'htm': {
      const { html } = await import('@codemirror/lang-html');
      return html();
    }
    case 'css': case 'scss': case 'less': {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
    case 'py': {
      const { python } = await import('@codemirror/lang-python');
      return python();
    }
    case 'md': case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }
    default:
      return [];
  }
}

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

/**
 * Diff 卡片
 * - P4：默认折叠（只渲染路径 + ± 行数），展开时再动态加载 CodeMirror
 * - 连续编辑 N 个文件时不会立刻挂载 N 个 MergeView
 */
export function DiffCard({ path, before, after, workDir }: DiffCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

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
    let cancelled = false;
    let view: { destroy(): void } | null = null;
    const parent = containerRef.current;
    parent.innerHTML = '';

    void (async () => {
      const [
        { EditorView, keymap },
        { EditorState },
        { MergeView },
        { defaultKeymap },
        oneDarkMod,
        langExt,
      ] = await Promise.all([
        import('@codemirror/view'),
        import('@codemirror/state'),
        import('@codemirror/merge'),
        import('@codemirror/commands'),
        import('@codemirror/theme-one-dark'),
        loadLangExtension(path),
      ]);
      if (cancelled) return;

      const dark = isDarkTheme();
      const themeExtensions = dark ? [oneDarkMod.oneDark] : [];
      const baseExtensions: Extension[] = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        keymap.of(defaultKeymap),
        langExt,
        ...themeExtensions,
      ];

      if (isNew || !before) {
        const state = EditorState.create({
          doc: after,
          extensions: [...baseExtensions, EditorView.lineWrapping],
        });
        view = new EditorView({ state, parent });
      } else {
        view = new MergeView({
          a: { doc: before, extensions: baseExtensions },
          b: { doc: after, extensions: baseExtensions },
          parent,
          orientation: 'a-b',
          highlightChanges: true,
          gutter: true,
        });
      }
    })();

    return () => {
      cancelled = true;
      if (view) {
        view.destroy();
        view = null;
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
