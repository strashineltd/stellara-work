import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Memory } from '../../../shared/ipc';
import { presenceRootProps, type PresenceMotionProps } from '../../lib/presence-ui';

interface MemoryDeleteDialogProps extends PresenceMotionProps {
  memory: Memory;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

const PREVIEW_LENGTH = 80;

export function MemoryDeleteDialog({ memory, onConfirm, onClose, presence }: MemoryDeleteDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const initializedRef = useRef(false);
  const memoryIdRef = useRef(memory.id);
  const operationGenerationRef = useRef(0);
  const confirmingRef = useRef(false);
  const focusAfterResetRef = useRef(false);
  const presenceState = presence?.state;
  const isClosing = presenceState === 'closing';

  useLayoutEffect(() => {
    const freshOpenMount = !initializedRef.current && !isClosing;
    const memoryChanged = memoryIdRef.current !== memory.id;
    initializedRef.current = true;
    memoryIdRef.current = memory.id;
    if (isClosing) {
      operationGenerationRef.current += 1;
      focusAfterResetRef.current = false;
      return;
    }
    if (!freshOpenMount && !memoryChanged && presenceState !== 'entering') return;

    operationGenerationRef.current += 1;
    confirmingRef.current = false;
    focusAfterResetRef.current = true;
    setConfirming(false);
  }, [isClosing, memory.id, presenceState]);

  useLayoutEffect(() => {
    if (!focusAfterResetRef.current || !cancelRef.current) return;
    focusAfterResetRef.current = false;
    cancelRef.current.focus({ preventScroll: true });
  });

  useLayoutEffect(() => () => {
    operationGenerationRef.current += 1;
    confirmingRef.current = false;
    focusAfterResetRef.current = false;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isClosing && !confirmingRef.current) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isClosing, onClose]);

  function handleClose() {
    if (!isClosing && !confirmingRef.current) onClose();
  }

  async function handleConfirm() {
    if (isClosing || confirmingRef.current) return;
    const operationGeneration = ++operationGenerationRef.current;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      await onConfirm();
    } catch {
      // The owner preserves the existing mutation error behavior.
    } finally {
      if (operationGenerationRef.current === operationGeneration) {
        confirmingRef.current = false;
        setConfirming(false);
      }
    }
  }

  const preview =
    memory.content.length > PREVIEW_LENGTH
      ? `${memory.content.slice(0, PREVIEW_LENGTH)}…`
      : memory.content;

  return (
    <div className="modal-backdrop" {...presenceRootProps(presence)} onClick={handleClose}>
      <div
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除记忆"
        aria-busy={confirming || undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>删除这条记忆？</h3>
        <p className="memory-delete-preview">{preview}</p>
        <div className="modal-actions">
          <button
            ref={cancelRef}
            className="btn btn-ghost"
            type="button"
            onClick={handleClose}
            disabled={isClosing || confirming}
            autoFocus
          >
            取消
          </button>
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isClosing || confirming}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
