import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

type NewEntryKind = 'file' | 'folder';

interface NewEntryMenuProps {
  workDir: string;
  disabled?: boolean;
  onCreated: () => void;
}

/**
 * 工具栏"+"下拉：新建文件 / 新建文件夹。
 * 选择后展开行内输入（输入框 + 确认 / 取消），成功后回调 onCreated（刷新树）。
 * 侧边栏文件视图与全屏文件树共用。
 */
export function NewEntryMenu({ workDir, disabled, onCreated }: NewEntryMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [kind, setKind] = useState<NewEntryKind | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen && !kind) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen, kind]);

  useEffect(() => {
    if (kind) inputRef.current?.focus();
  }, [kind]);

  function close() {
    setMenuOpen(false);
    setKind(null);
    setName('');
    setError(null);
  }

  function start(next: NewEntryKind) {
    setMenuOpen(false);
    setKind(next);
    setName('');
    setError(null);
  }

  function validateName(value: string): string | null {
    if (!value) return '请输入名称';
    if (value.includes('/') || value.includes('\\') || value.includes('..')) {
      return '名称不能包含 / \\ ..';
    }
    return null;
  }

  async function submit() {
    const trimmed = name.trim();
    const invalid = validateName(trimmed);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'file') {
        await window.electronAPI.fs.createFile(workDir, trimmed);
      } else {
        await window.electronAPI.fs.mkdir(workDir, trimmed);
      }
      close();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="new-entry-menu" ref={rootRef}>
      <button
        className="btn-icon btn-icon-small new-entry-menu__trigger"
        type="button"
        title="新建文件或文件夹"
        aria-label="新建文件或文件夹"
        disabled={disabled}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Icon name="plus" size={14} />
      </button>
      {menuOpen && (
        <div className="new-entry-menu__dropdown" role="menu">
          <button type="button" role="menuitem" className="new-entry-menu__item" onClick={() => start('file')}>
            <Icon name="file" size={14} />
            新建文件
          </button>
          <button type="button" role="menuitem" className="new-entry-menu__item" onClick={() => start('folder')}>
            <Icon name="folder" size={14} />
            新建文件夹
          </button>
        </div>
      )}
      {kind && (
        <div className="new-entry-menu__form">
          <div className="new-entry-menu__row">
            <input
              ref={inputRef}
              className="new-entry-menu__input"
              type="text"
              value={name}
              placeholder={kind === 'file' ? '文件名称' : '文件夹名称'}
              aria-label="名称"
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  close();
                }
              }}
            />
            <button
              className="btn-icon btn-icon-small new-entry-menu__confirm"
              type="button"
              title="确认"
              aria-label="确认创建"
              disabled={busy}
              onClick={() => void submit()}
            >
              <Icon name="check" size={14} />
            </button>
            <button
              className="btn-icon btn-icon-small new-entry-menu__cancel"
              type="button"
              title="取消"
              aria-label="取消创建"
              disabled={busy}
              onClick={close}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
          {error && <p className="new-entry-menu__error">{error}</p>}
        </div>
      )}
    </div>
  );
}
