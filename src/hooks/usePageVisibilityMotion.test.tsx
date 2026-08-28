import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageVisibilityMotion } from './usePageVisibilityMotion';

function Probe() {
  usePageVisibilityMotion();
  return null;
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
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
}

describe('usePageVisibilityMotion', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.innerHTML = '';
    setDocumentHidden(false);
    document.documentElement.removeAttribute('data-page-hidden');
  });

  afterEach(() => {
    delete (document as unknown as { hidden?: boolean }).hidden;
    document.documentElement.removeAttribute('data-page-hidden');
    vi.unstubAllGlobals();
  });

  it('sets data-page-hidden on the root when the document starts hidden', () => {
    setDocumentHidden(true);

    const view = renderProbe();

    expect(document.documentElement.hasAttribute('data-page-hidden')).toBe(true);
    view.unmount();
  });

  it('toggles data-page-hidden on visibilitychange', () => {
    const view = renderProbe();
    expect(document.documentElement.hasAttribute('data-page-hidden')).toBe(false);

    setDocumentHidden(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(document.documentElement.hasAttribute('data-page-hidden')).toBe(true);

    setDocumentHidden(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(document.documentElement.hasAttribute('data-page-hidden')).toBe(false);

    view.unmount();
  });

  it('removes the visibilitychange listener and root attribute on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const view = renderProbe();
    const handler = addSpy.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(handler).toBeTypeOf('function');

    view.unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', handler);
    expect(document.documentElement.hasAttribute('data-page-hidden')).toBe(false);
  });
});