import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalIdentity } from '../../shared/ipc';
import { AccountBadge } from './AccountBadge';

const LEO: LocalIdentity = { id: 'u1', name: 'Leo', kind: 'user' };
const DEFAULT_IDENTITY: LocalIdentity = { id: 'default', name: '本地默认', kind: 'default' };
const IDENTITIES: LocalIdentity[] = [
  DEFAULT_IDENTITY,
  LEO,
  { id: 'u2', name: 'Ada', kind: 'user' },
];

let switchCalls: Array<{ id: string; force: boolean | undefined }> = [];
let identityChanged: ((user: LocalIdentity) => void) | null = null;

function renderBadge() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<AccountBadge />);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fireClick(el: Element | null | undefined) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  switchCalls = [];
  identityChanged = null;
  (window as any).electronAPI = {
    identity: {
      getCurrent: vi.fn().mockResolvedValue(LEO),
      list: vi.fn().mockResolvedValue(IDENTITIES),
      switch: vi.fn(async (id: string, force?: boolean) => {
        switchCalls.push({ id, force });
        return { ok: true, user: IDENTITIES.find((item) => item.id === id) ?? DEFAULT_IDENTITY };
      }),
      onChanged: vi.fn((callback: (user: LocalIdentity) => void) => {
        identityChanged = callback;
        return () => {
          identityChanged = null;
        };
      }),
    },
    auth: { local: { create: vi.fn() } },
  };
});

afterEach(() => {
  delete (window as any).electronAPI;
  document.body.replaceChildren();
});

describe('AccountBadge', () => {
  it('renders the current identity as avatar with display name', async () => {
    const { container, unmount } = renderBadge();
    await act(async () => {});

    const trigger = container.querySelector('.account-badge__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.querySelector('.account-avatar')?.textContent).toBe('L');
    expect(trigger!.querySelector('.account-badge__name')?.textContent).toBe('Leo');
    expect(trigger!.querySelector('[data-icon="chevron-down"]')).toBeNull();
    expect(trigger!.getAttribute('title')).toBe('Leo');
    unmount();
  });

  it('opens the identity menu and switches identity on click', async () => {
    const { container, unmount } = renderBadge();
    await act(async () => {});

    fireClick(container.querySelector('.account-badge__trigger'));
    expect(container.querySelector('.account-badge__menu')).not.toBeNull();

    const ada = Array.from(container.querySelectorAll('.account-badge__item'))
      .find((el) => el.textContent?.includes('Ada'));
    expect(ada).toBeTruthy();
    fireClick(ada);
    await act(async () => {});

    expect(switchCalls).toHaveLength(1);
    expect(switchCalls[0]!.id).toBe('u2');
    expect(switchCalls[0]!.force).toBeUndefined();
    expect(container.querySelector('.account-badge__menu')).toBeNull();
    unmount();
  });

  it('renders the default profile without a local user instead of throwing', async () => {
    (window as any).electronAPI = {
      identity: {
        getCurrent: vi.fn().mockResolvedValue(DEFAULT_IDENTITY),
        list: vi.fn().mockResolvedValue([DEFAULT_IDENTITY]),
        switch: vi.fn(),
        onChanged: vi.fn().mockReturnValue(() => {}),
      },
    };
    const { container, unmount } = renderBadge();
    await act(async () => {});

    const trigger = container.querySelector('.account-badge__trigger');
    expect(trigger).not.toBeNull();
    expect(trigger!.querySelector('.account-avatar')?.textContent).toBe('本');
    expect(trigger!.querySelector('.account-badge__name')?.textContent).toBe('本地默认');
    unmount();
  });

  it('refreshes when the main process broadcasts an identity change', async () => {
    const { container, unmount } = renderBadge();
    await act(async () => {});

    (window as any).electronAPI.identity.getCurrent.mockResolvedValue(DEFAULT_IDENTITY);
    act(() => identityChanged?.(DEFAULT_IDENTITY));
    await act(async () => {});

    expect(container.querySelector('.account-badge__name')?.textContent).toBe('本地默认');
    unmount();
  });
});
