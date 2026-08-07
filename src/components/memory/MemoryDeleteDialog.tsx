import { useEffect } from 'react';
import type { Memory } from '../../../shared/ipc';

interface MemoryDeleteDialogProps {
  memory: Memory;
  onConfirm: () => void;
  onClose: () => void;
}

const PREVIEW_LENGTH = 80;

export function MemoryDeleteDialog({ memory, onConfirm, onClose }: MemoryDeleteDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const preview =
    memory.content.length > PREVIEW_LENGTH
      ? `${memory.content.slice(0, PREVIEW_LENGTH)}…`
      : memory.content;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-label="删除记忆"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>删除这条记忆？</h3>
        <p className="memory-delete-preview">{preview}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-danger" type="button" onClick={onConfirm}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
