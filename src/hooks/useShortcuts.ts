import { useEffect, useRef } from 'react';
import {
  SHORTCUT_DEFS,
  DEFAULT_SHORTCUTS,
  eventToBinding,
  type ShortcutAction,
  type ShortcutBindings,
} from '../../shared/shortcuts';

/**
 * 挂全局 keydown，按当前 bindings 匹配，命中就调对应 action。
 *
 * actions 用 ref 包裹 → effect 只在 bindings 变时重绑，避免每次 render 都重接监听。
 */
export function useShortcuts(
  bindings: ShortcutBindings | undefined,
  actions: Partial<Record<ShortcutAction, () => void>>,
  enabled = true,
): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      const binding = eventToBinding(e);
      if (!binding) return;
      for (const def of SHORTCUT_DEFS) {
        const actual = bindings?.[def.action] ?? DEFAULT_SHORTCUTS[def.action];
        if (actual === binding && actionsRef.current[def.action]) {
          actionsRef.current[def.action]!();
          e.preventDefault();
          return;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings, enabled]);
}