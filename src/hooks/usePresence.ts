import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

export const DEFAULT_PRESENCE_EXIT_MS = 140;

export type PresenceState = "entering" | "open" | "closing";

export interface PresenceEndEvent {
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
}

export interface PresenceResult {
  readonly mounted: boolean;
  readonly state: PresenceState;
  readonly completeExit: (event?: PresenceEndEvent) => void;
}

export function usePresence(
  present: boolean,
  exitMs = DEFAULT_PRESENCE_EXIT_MS,
): PresenceResult {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(present);
  const [state, setState] = useState<PresenceState>(
    present ? "entering" : "open",
  );
  const mountedRef = useRef(present);
  const presentRef = useRef(present);
  const stateRef = useRef<PresenceState>(present ? "entering" : "open");
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  presentRef.current = present;

  const updateState = useCallback((next: PresenceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearPending = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;
  }, []);

  const unmount = useCallback(() => {
    clearPending();
    mountedRef.current = false;
    setMounted(false);
    updateState("open");
  }, [clearPending, updateState]);

  useLayoutEffect(() => {
    const generation = ++generationRef.current;
    clearPending();

    if (present) {
      if (!mountedRef.current) {
        mountedRef.current = true;
        setMounted(true);
      }
      if (reducedMotion) {
        updateState("open");
      } else {
        updateState("entering");
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          if (generationRef.current === generation && presentRef.current) {
            updateState("open");
          }
        });
      }
    } else if (mountedRef.current) {
      if (reducedMotion) {
        unmount();
      } else {
        updateState("closing");
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (generationRef.current === generation && !presentRef.current) {
            unmount();
          }
        }, exitMs + 50);
      }
    }

    return clearPending;
  }, [clearPending, exitMs, present, reducedMotion, unmount, updateState]);

  const completeExit = useCallback(
    (event?: PresenceEndEvent) => {
      if (event && event.target !== event.currentTarget) return;
      if (presentRef.current || stateRef.current !== "closing") return;
      unmount();
    },
    [unmount],
  );

  return { mounted, state, completeExit };
}
