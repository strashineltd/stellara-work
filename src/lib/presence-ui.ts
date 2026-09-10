import type { TransitionEvent } from 'react';
import type { PresenceResult, PresenceState } from '../hooks/usePresence';

export type MotionPresence = Pick<PresenceResult, 'state' | 'completeExit'>;

export interface PresenceMotionProps {
  readonly presence?: MotionPresence;
}

export function presenceRootProps(presence?: MotionPresence): {
  'data-motion-state': PresenceState;
  inert: true | undefined;
  'aria-hidden': true | undefined;
  onTransitionEnd: ((event: TransitionEvent<HTMLElement>) => void) | undefined;
} {
  const state: PresenceState = presence?.state ?? 'open';
  const closing = state === 'closing';
  return {
    'data-motion-state': state,
    inert: closing ? true : undefined,
    'aria-hidden': closing ? true : undefined,
    onTransitionEnd: presence
      ? (event: TransitionEvent<HTMLElement>) => presence.completeExit(event)
      : undefined,
  };
}

export function captureFocusTarget(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit) return explicit;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

const POINTER_FOCUS_TARGET = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getPointerFocusTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const candidate = target.closest<HTMLElement>(POINTER_FOCUS_TARGET);
  if (
    !candidate?.isConnected
    || candidate.matches(':disabled, [aria-disabled="true"]')
    || candidate.closest('[inert], [aria-hidden="true"]')
  ) {
    return null;
  }
  return candidate;
}

function canFocus(target: HTMLElement | null): target is HTMLElement {
  return Boolean(
    target?.isConnected
    && !target.closest('[inert], [aria-hidden="true"]')
    && !target.matches(':disabled, [aria-disabled="true"]'),
  );
}

export function restoreFocusTarget(
  target: HTMLElement | null,
  fallback: HTMLElement | null = null,
): void {
  const next = canFocus(target) ? target : canFocus(fallback) ? fallback : null;
  next?.focus({ preventScroll: true });
}
