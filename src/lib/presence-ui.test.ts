import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFocusTarget, presenceRootProps, restoreFocusTarget } from './presence-ui';

describe('presence UI utilities', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('marks only closing roots inert and hidden', () => {
    const completeExit = vi.fn();
    const props = presenceRootProps({ state: 'closing', completeExit });
    expect(props['data-motion-state']).toBe('closing');
    expect(props.inert).toBe(true);
    expect(props['aria-hidden']).toBe(true);
    const root = document.createElement('div');
    props.onTransitionEnd?.({ target: root, currentTarget: root } as never);
    expect(completeExit).toHaveBeenCalledOnce();

    expect(presenceRootProps()).toEqual({
      'data-motion-state': 'open',
      inert: undefined,
      'aria-hidden': undefined,
      onTransitionEnd: undefined,
    });
  });

  it('restores focus only to a connected interactive target', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    restoreFocusTarget(trigger);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    const fallback = document.createElement('button');
    document.body.appendChild(fallback);
    restoreFocusTarget(trigger, fallback);
    expect(document.activeElement).toBe(fallback);
  });

  it('rejects targets in inert and aria-hidden trees', () => {
    const inertParent = document.createElement('div');
    inertParent.setAttribute('inert', '');
    const inertTarget = document.createElement('button');
    inertParent.appendChild(inertTarget);

    const hiddenParent = document.createElement('div');
    hiddenParent.setAttribute('aria-hidden', 'true');
    const hiddenTarget = document.createElement('button');
    hiddenParent.appendChild(hiddenTarget);

    const firstFallback = document.createElement('button');
    const secondFallback = document.createElement('button');
    document.body.append(inertParent, hiddenParent, firstFallback, secondFallback);

    restoreFocusTarget(inertTarget, firstFallback);
    expect(document.activeElement).toBe(firstFallback);
    restoreFocusTarget(hiddenTarget, secondFallback);
    expect(document.activeElement).toBe(secondFallback);
  });

  it('rejects disabled and aria-disabled targets', () => {
    const disabledTarget = document.createElement('button');
    disabledTarget.disabled = true;
    const ariaDisabledTarget = document.createElement('button');
    ariaDisabledTarget.setAttribute('aria-disabled', 'true');
    const firstFallback = document.createElement('button');
    const secondFallback = document.createElement('button');
    document.body.append(disabledTarget, ariaDisabledTarget, firstFallback, secondFallback);

    restoreFocusTarget(disabledTarget, firstFallback);
    expect(document.activeElement).toBe(firstFallback);
    restoreFocusTarget(ariaDisabledTarget, secondFallback);
    expect(document.activeElement).toBe(secondFallback);
  });

  it('captures the active element unless an explicit target is supplied', () => {
    const active = document.createElement('button');
    const explicit = document.createElement('button');
    document.body.append(active, explicit);
    active.focus();
    expect(captureFocusTarget()).toBe(active);
    expect(captureFocusTarget(explicit)).toBe(explicit);
  });
});
