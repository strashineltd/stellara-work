import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalUser } from '../../shared/ipc';
import { AccountBadge } from './AccountBadge';

const LEO: LocalUser = { id: 'u1', displayName: 'Leo', createdAt: 1, updatedAt: 1 };
const ADA: LocalUser = { id: 'u2', displayName: 'Ada', createdAt: 2, updatedAt: 2 };

let switchCalls: string[] = [];

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
  (window as any).electronAPI = {
    auth: {
      local: {
        getCurrent: vi.fn().mockResolvedValue(LEO),
        list: vi.fn().mockResolvedValue([LEO, ADA]),
        switch: vi.fn(async (id: string) => {
          switchCalls.push(id);
        }),
        create: vi.fn(),
      },
    },
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

    expect(switchCalls).toEqual(['u2']);
    expect(container.querySelector('.account-badge__menu')).toBeNull();
    unmount();
  });
});
