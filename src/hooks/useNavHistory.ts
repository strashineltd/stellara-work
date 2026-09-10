import { useCallback, useRef, useState } from 'react';
import type { NavState } from '../lib/navigation';

export type { NavState } from '../lib/navigation';

function equalNav(a: NavState, b: NavState): boolean {
  return a.section === b.section && a.sessionId === b.sessionId;
}

export function useNavHistory(initial: NavState) {
  const [current, setCurrent] = useState<NavState>(initial);
  const currentRef = useRef<NavState>(initial);
  const past = useRef<NavState[]>([]);
  const future = useRef<NavState[]>([]);

  const push = useCallback((next: NavState) => {
    const prev = currentRef.current;
    if (equalNav(prev, next)) return;
    past.current.push(prev);
    future.current = [];
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const replace = useCallback((next: NavState) => {
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const back = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(currentRef.current);
    currentRef.current = prev;
    setCurrent(prev);
  }, []);

  const forward = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(currentRef.current);
    currentRef.current = next;
    setCurrent(next);
  }, []);

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
