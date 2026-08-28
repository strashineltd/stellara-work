import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REDUCED_MOTION_QUERY } from "./useReducedMotion";
import { usePresence } from "./usePresence";

function PresenceProbe({
  present,
  exitMs,
}: {
  present: boolean;
  exitMs?: number;
}) {
  const presence = usePresence(present, exitMs);
  return presence.mounted ? (
    <div
      data-presence-root
      data-motion-state={presence.state}
      onTransitionEnd={presence.completeExit}
    >
      <span data-presence-child />
    </div>
  ) : null;
}

interface MountedView {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

let animationFrames: Map<number, FrameRequestCallback>;
let media: MediaQueryList;
let mediaListeners: Set<EventListenerOrEventListenerObject>;
let mountedViews: Set<MountedView>;
let nextAnimationFrameId: number;
let reducedMotion: boolean;

function renderPresence(present: boolean, exitMs?: number, strict = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);

  function render(nextPresent: boolean) {
    const probe = <PresenceProbe present={nextPresent} exitMs={exitMs} />;
    act(() => {
      root.render(strict ? <StrictMode>{probe}</StrictMode> : probe);
    });
  }

  render(present);

  return {
    container,
    rerender: render,
    unmount() {
      if (!mountedViews.delete(view)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

function getPresenceRoot(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[data-presence-root]");
}

function flushAnimationFrame() {
  const frame = animationFrames.entries().next().value as
    [number, FrameRequestCallback] | undefined;
  expect(frame).toBeDefined();
  if (!frame) return;

  animationFrames.delete(frame[0]);
  act(() => frame[1](16));
}

function dispatchTransitionEnd(element: Element) {
  act(() => {
    element.dispatchEvent(new Event("transitionend", { bubbles: true }));
  });
}

function setReducedMotion(next: boolean) {
  reducedMotion = next;
  act(() => {
    media.dispatchEvent(new Event("change"));
  });
}

describe("usePresence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.innerHTML = "";

    animationFrames = new Map();
    mountedViews = new Set();
    nextAnimationFrameId = 1;
    reducedMotion = false;
    mediaListeners = new Set();

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextAnimationFrameId++;
        animationFrames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        animationFrames.delete(id);
      }),
    );

    media = {
      get matches() {
        return reducedMotion;
      },
      media: REDUCED_MOTION_QUERY,
      onchange: null,
      addEventListener(
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        mediaListeners.add(listener);
      },
      removeEventListener(
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        mediaListeners.delete(listener);
      },
      dispatchEvent(event: Event) {
        mediaListeners.forEach((listener) => {
          if (typeof listener === "function") {
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
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.clearAllTimers();
    animationFrames.clear();
    mediaListeners.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("mounts as entering and opens after one animation frame", () => {
    const view = renderPresence(false);

    expect(getPresenceRoot(view.container)).toBeNull();
    view.rerender(true);
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe(
      "entering",
    );

    flushAnimationFrame();
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe("open");
  });

  it("remains closing until its root transition ends", () => {
    const view = renderPresence(true);
    flushAnimationFrame();

    view.rerender(false);
    const root = getPresenceRoot(view.container);
    expect(root?.dataset.motionState).toBe("closing");

    dispatchTransitionEnd(root!);
    expect(getPresenceRoot(view.container)).toBeNull();
  });

  it("ignores a child transition end while closing", () => {
    const view = renderPresence(true);
    flushAnimationFrame();
    view.rerender(false);

    const child = view.container.querySelector("[data-presence-child]");
    dispatchTransitionEnd(child!);

    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe(
      "closing",
    );
  });

  it("uses the default exit timeout as a transition fallback", () => {
    const view = renderPresence(true);
    flushAnimationFrame();
    view.rerender(false);

    act(() => vi.advanceTimersByTime(189));
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe(
      "closing",
    );

    act(() => vi.advanceTimersByTime(1));
    expect(getPresenceRoot(view.container)).toBeNull();
  });

  it("uses a custom exit timeout as a transition fallback", () => {
    const view = renderPresence(true, 20);
    flushAnimationFrame();
    view.rerender(false);

    act(() => vi.advanceTimersByTime(69));
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe(
      "closing",
    );

    act(() => vi.advanceTimersByTime(1));
    expect(getPresenceRoot(view.container)).toBeNull();
  });

  it("cancels stale exit completion when rapidly reopened", () => {
    const view = renderPresence(true);
    flushAnimationFrame();
    view.rerender(false);

    const closingRoot = getPresenceRoot(view.container);
    expect(vi.getTimerCount()).toBe(1);
    view.rerender(true);
    expect(vi.getTimerCount()).toBe(0);

    dispatchTransitionEnd(closingRoot!);
    act(() => vi.advanceTimersByTime(190));
    flushAnimationFrame();

    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe("open");
  });

  it("unmounts synchronously under initial reduced motion", () => {
    reducedMotion = true;
    const view = renderPresence(true);
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe("open");

    view.rerender(false);

    expect(getPresenceRoot(view.container)).toBeNull();
    expect(animationFrames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes a pending exit when reduced motion turns on", () => {
    const view = renderPresence(true);
    flushAnimationFrame();
    view.rerender(false);
    expect(getPresenceRoot(view.container)?.dataset.motionState).toBe(
      "closing",
    );
    expect(vi.getTimerCount()).toBe(1);

    setReducedMotion(true);

    expect(getPresenceRoot(view.container)).toBeNull();
    expect(animationFrames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up enter and exit work when Strict Mode roots unmount", () => {
    const closingView = renderPresence(true, undefined, true);
    flushAnimationFrame();
    closingView.rerender(false);
    expect(vi.getTimerCount()).toBe(1);

    const enteringView = renderPresence(true, undefined, true);
    expect(animationFrames.size).toBe(1);

    closingView.unmount();
    enteringView.unmount();

    expect(animationFrames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
