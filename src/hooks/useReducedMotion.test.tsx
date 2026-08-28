import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, useReducedMotion } from './useReducedMotion';

function Probe() {
  return <output data-reduced={String(useReducedMotion())} />;
}

function renderProbe() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Probe />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);

    const view = renderProbe();

    expect(view.container.querySelector('output')?.dataset.reduced).toBe(
      'false',
    );
    view.unmount();
  });

  it('subscribes to the reduced-motion query and cleans up', () => {
    let matches = false;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const addEventListener = vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) =>
        listeners.add(listener),
    );
    const removeEventListener = vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) =>
        listeners.delete(listener),
    );
    const media = {
      get matches() {
        return matches;
      },
      media: REDUCED_MOTION_QUERY,
      onchange: null,
      addEventListener,
      removeEventListener,
      dispatchEvent(event: Event) {
        listeners.forEach((listener) => {
          if (typeof listener === 'function') {
            listener.call(media, event);
          } else {
            listener.handleEvent(event);
          }
        });
        return !event.defaultPrevented;
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MediaQueryList;
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('matchMedia', matchMedia);

    const view = renderProbe();
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(listeners.size).toBe(1);
    expect(view.container.querySelector('output')?.dataset.reduced).toBe(
      'false',
    );

    matches = true;
    act(() => media.dispatchEvent(new Event('change')));
    expect(view.container.querySelector('output')?.dataset.reduced).toBe(
      'true',
    );

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
