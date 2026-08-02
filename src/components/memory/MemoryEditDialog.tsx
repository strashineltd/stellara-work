import { useState, useEffect, useRef } from 'react';
import type { Memory } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface MemoryEditDialogProps {
  memory?: Memory;
  onSave: (data: { content: string; kind: string; scope: string; importance: number; tags: string[] }) => void;
  onClose: () => void;
}

const KIND_OPTIONS = [
  { value: 'fact', label: '事实' },
  { value: 'preference', label: '偏好' },
  { value: 'decision', label: '决策' },
  { value: 'codebase', label: '代码库' },
  { value: 'requirement', label: '需求' },
  { value: 'meeting', label: '会议' },
];

const SCOPE_OPTIONS = [
  { value: 'personal', label: '个人' },
  { value: 'project', label: '项目' },
  { value: 'workspace', label: '企业' },
];

export function MemoryEditDialog({ memory, onSave, onClose }: MemoryEditDialogProps) {
  const [content, setContent] = useState(memory?.content ?? '');
  const [kind, setKind] = useState(memory?.kind ?? 'fact');
  const [scope, setScope] = useState(memory?.scope ?? 'personal');
  const [importance, setImportance] = useState(memory?.importance ?? 0.5);
  const [tagsInput, setTagsInput] = useState(memory?.tags?.join(', ') ?? '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    onSave({ content: content.trim(), kind, scope, importance, tags });
  }

  const isEdit = !!memory;

  return (
    <div className="memory-dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="memory-dialog"
        role="dialog"
        aria-label={isEdit ? '编辑记忆' : '新建记忆'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="memory-dialog__header">
          <h2 className="memory-dialog__title">{isEdit ? '编辑记忆' : '新建记忆'}</h2>
          <button className="memory-dialog__close" type="button" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={16} />
          </button>
        </div>
        <form className="memory-dialog__form" onSubmit={handleSubmit}>
          <label className="memory-dialog__field">
            <span className="memory-dialog__label">内容</span>
            <textarea
              ref={contentRef}
              className="memory-dialog__textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              required
              placeholder="输入记忆内容..."
            />
          </label>
          <div className="memory-dialog__row">
            <label className="memory-dialog__field">
              <span className="memory-dialog__label">类型</span>
              <select
                className="memory-dialog__select"
                value={kind}
                onChange={(e) => setKind(e.target.value as Memory['kind'])}
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="memory-dialog__field">
              <span className="memory-dialog__label">作用域</span>
              <select
                className="memory-dialog__select"
                value={scope}
                onChange={(e) => setScope(e.target.value as Memory['scope'])}
              >
                {SCOPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="memory-dialog__field">
            <span className="memory-dialog__label">重要性 ({Math.round(importance * 100)}%)</span>
            <input
              className="memory-dialog__range"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={importance}
              onChange={(e) => setImportance(parseFloat(e.target.value))}
            />
          </label>
          <label className="memory-dialog__field">
            <span className="memory-dialog__label">标签（逗号分隔）</span>
            <input
              className="memory-dialog__input"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </label>
          <div className="memory-dialog__actions">
            <button className="memory-dialog__btn memory-dialog__btn--cancel" type="button" onClick={onClose}>
              取消
            </button>
            <button className="memory-dialog__btn memory-dialog__btn--save" type="submit" disabled={!content.trim()}>
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
