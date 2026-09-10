import { useEffect, useState } from 'react';
import type { ApprovalMode } from '../../lib/navigation';
import { usePresence } from '../../hooks/usePresence';
import { presenceRootProps } from '../../lib/presence-ui';
import { Icon } from '../Icon';

const MODES: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  { id: 'auto', label: '帮我批准', hint: '自动批准工具的每步操作' },
  { id: 'step', label: '逐步批准', hint: '每个工具操作都需要你确认' },
  { id: 'plan', label: '计划模式', hint: '先产出计划，批准后再执行' },
];

interface ApprovalModeMenuProps {
  mode: ApprovalMode;
  onModeChange: (mode: ApprovalMode) => void;
  disabled?: boolean;
}

export function ApprovalModeMenu(props: ApprovalModeMenuProps) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open, 120);
  const current = MODES.find((item) => item.id === props.mode) ?? MODES[1]!;

  // 点外部 / Escape 关闭审批模式下拉
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.approval-mode-menu')) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span className="approval-mode-menu">
      <button
        className="approval-mode-menu__trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => {
          if (props.disabled) return;
          setOpen((value) => !value);
        }}
      >
        <Icon name="shield" size={14} />
        <span>{current.label}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {presence.mounted && (
        <div className="approval-mode-menu__list" role="listbox" aria-label="审批模式" {...presenceRootProps(presence)}>
          {MODES.map((item) => (
            <button
              key={item.id}
              className={`approval-mode-menu__item${item.id === props.mode ? ' active' : ''}`}
              type="button"
              role="option"
              aria-selected={item.id === props.mode}
              onClick={() => {
                props.onModeChange(item.id);
                setOpen(false);
              }}
            >
              <strong>{item.label}</strong>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
