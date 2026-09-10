import { useCallback, useState } from 'react';
import type { NavState } from '../lib/navigation';

export type { NavState } from '../lib/navigation';

function equalNav(a: NavState, b: NavState): boolean {
  return a.section === b.section && a.sessionId === b.sessionId;
}

interface HistoryState {
  past: NavState[];
  current: NavState;
  future: NavState[];
}

export function useNavHistory(initial: NavState) {
  const [history, setHistory] = useState<HistoryState>({ past: [], current: initial, future: [] });

  const push = useCallback((next: NavState) => {
    setHistory((h) => (equalNav(h.current, next) ? h : { past: [...h.past, h.current], current: next, future: [] }));
  }, []);

  const replace = useCallback((next: NavState) => {
    setHistory((h) => (equalNav(h.current, next) ? h : { ...h, current: next }));
  }, []);

  const back = useCallback(() => {
    setHistory((h) => {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      return { past: h.past.slice(0, -1), current: prev, future: [...h.future, h.current] };
    });
  }, []);

  const forward = useCallback(() => {
    setHistory((h) => {
      const next = h.future[h.future.length - 1];
      if (!next) return h;
      return { past: [...h.past, h.current], current: next, future: h.future.slice(0, -1) };
    });
  }, []);

  return {
    current: history.current,
    canGoBack: history.past.length > 0,
    canGoForward: history.future.length > 0,
    push,
    replace,
    back,
    forward,
  };
}
