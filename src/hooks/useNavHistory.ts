import { useCallback, useRef, useState } from 'react';
import type { NavState } from '../lib/navigation';

export type { NavState } from '../lib/navigation';

function equalNav(a: NavState, b: NavState): boolean {
  return a.section === b.section && a.sessionId === b.sessionId;
}

export function useNavHistory(initial: NavState) {
  const [current, setCurrent] = useState<NavState>(initial);
  const past = useRef<NavState[]>([]);
  const future = useRef<NavState[]>([]);
  const [, forceRender] = useState(0);

  const sync = useCallback(() => { forceRender((n) => n + 1); }, []);

  const push = useCallback((next: NavState) => {
    setCurrent((prev) => {
      if (equalNav(prev, next)) return prev;
      past.current.push(prev);
      future.current = [];
      return next;
    });
    sync();
  }, [sync]);

  const replace = useCallback((next: NavState) => {
    setCurrent(next);
  }, []);

  const back = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setCurrent((cur) => {
      future.current.push(cur);
      return prev;
    });
    sync();
  }, [sync]);

  const forward = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setCurrent((cur) => {
      past.current.push(cur);
      return next;
    });
    sync();
  }, [sync]);

  return {
    current,
    canGoBack: past.current.length > 0,
    canGoForward: future.current.length > 0,
    push,
    replace,
    back,
    forward,
  };
}
