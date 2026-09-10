import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavHistory, type NavState } from './useNavHistory';
import { INITIAL_NAV } from '../lib/navigation';

let api: ReturnType<typeof useNavHistory> | null = null;

function Harness() {
  api = useNavHistory(INITIAL_NAV);
  return <span>{`${api.current.section}:${api.current.sessionId ?? '-'}:${String(api.canGoBack)}:${String(api.canGoForward)}`}</span>;
}

function renderHarness(strict = false) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />); });
  return { container, root, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

describe('useNavHistory', () => {
  beforeEach(() => { api = null; document.body.innerHTML = ''; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });

  it('starts at the initial state with no history', () => {
    const view = renderHarness();
    expect(api!.current).toEqual(INITIAL_NAV);
    expect(api!.canGoBack).toBe(false);
    expect(api!.canGoForward).toBe(false);
    view.unmount();
  });

  it('pushes, goes back and forward', () => {
    const view = renderHarness();
    const session: NavState = { section: 'tasks', sessionId: 's1' };
    act(() => { api!.push(session); });
    expect(api!.current).toEqual(session);
    expect(api!.canGoBack).toBe(true);
    act(() => { api!.back(); });
    expect(api!.current).toEqual(INITIAL_NAV);
    expect(api!.canGoForward).toBe(true);
    act(() => { api!.forward(); });
    expect(api!.current).toEqual(session);
    view.unmount();
  });

  it('push clears forward history and replace does not grow history', () => {
    const view = renderHarness();
    act(() => { api!.push({ section: 'memory', sessionId: null }); });
    act(() => { api!.back(); });
    act(() => { api!.push({ section: 'files', sessionId: null }); });
    expect(api!.canGoForward).toBe(false);
    act(() => { api!.replace({ section: 'scheduled', sessionId: null }); });
    expect(api!.current.section).toBe('scheduled');
    act(() => { api!.back(); });
    expect(api!.current.section).toBe('home');
    view.unmount();
  });

  it('pushing the same state is a no-op', () => {
    const view = renderHarness();
    act(() => { api!.push(INITIAL_NAV); });
    expect(api!.canGoBack).toBe(false);
    view.unmount();
  });

  it('is StrictMode-safe: one push adds exactly one history entry', () => {
    const view = renderHarness(true);
    const session: NavState = { section: 'tasks', sessionId: 's1' };
    act(() => { api!.push(session); });
    expect(api!.current).toEqual(session);
    expect(api!.canGoBack).toBe(true);
    act(() => { api!.back(); });
    expect(api!.current).toEqual(INITIAL_NAV);
    expect(api!.canGoBack).toBe(false);
    view.unmount();
  });
});
