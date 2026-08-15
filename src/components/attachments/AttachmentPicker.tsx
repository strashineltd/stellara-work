import { useState } from 'react';
import type { AttachmentMeta } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { formatFileSize } from '../../lib/chat-utils';

interface AttachmentPickerProps {
  attachments: AttachmentMeta[];
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  /** 附件按钮点击（父组件负责打开文件对话框并添加） */
  onPick?: () => void;
  /** 拖拽提取出的文件路径（父组件负责转成附件元数据） */
  onAddPaths?: (paths: string[]) => void;
  disabled?: boolean;
}

/**
 * 公共附件选择器：选择按钮 + 拖拽（overlay）+ chip 列表（增删）
 */
export function AttachmentPicker({
  attachments,
  onAttachmentsChange,
  onPick,
  onAddPaths,
  disabled,
}: AttachmentPickerProps) {
  const [dropActive, setDropActive] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    if (disabled) return;
    const paths: string[] = [];
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      try {
        const p = window.electronAPI.dialog.getPathForFile(file);
        if (p) paths.push(p);
      } catch { /* 非本地文件（如浏览器预览）忽略 */ }
    }
    if (paths.length > 0) onAddPaths?.(paths);
  }

  return (
    <div
      className="attach-picker"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropActive(false);
      }}
      onDrop={handleDrop}
    >
      {dropActive && (
        <div className="attach-drop-overlay" role="status">
          释放以添加附件
        </div>
      )}
      <button
        className="attach-btn"
        type="button"
        title="添加附件（也可拖拽文件到此处）"
        aria-label="添加附件"
        onClick={() => onPick?.()}
        disabled={disabled}
      >
        <Icon name="paperclip" size={14} />
      </button>
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a) => (
            <span className="attach-chip" key={a.id} title={a.name}>
              <Icon name="file" size={12} />
              <span className="attach-chip-name">{a.name}</span>
              <span className="attach-chip-size">{formatFileSize(a.size)}</span>
              <button
                className="attach-chip-remove"
                type="button"
                aria-label={`移除 ${a.name}`}
                onClick={() => onAttachmentsChange(attachments.filter((x) => x.id !== a.id))}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
