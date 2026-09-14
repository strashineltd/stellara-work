import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, LocalIdentity, LocalUser } from '../../../shared/ipc';
import { SettingsAccountPanel } from './SettingsAccountPanel';

const DEFAULT_IDENTITY: LocalIdentity = { id: 'default', name: '本地默认', kind: 'default' };
const LEO_IDENTITY: LocalIdentity = { id: 'u1', name: 'Leo', kind: 'user' };
const ADA_IDENTITY: LocalIdentity = { id: 'u2', name: 'Ada', kind: 'user' };
const ALL_IDENTITIES = [DEFAULT_IDENTITY, LEO_IDENTITY, ADA_IDENTITY];
const LEO_PROFILE: LocalUser = { id: 'u1', displayName: 'Leo', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };

let switchCalls: Array<{ id: string; force: boolean | undefined }> = [];
let mounted: { container: HTMLDivElement; root: Root } | null = null;

function installApi() {
  switchCalls = [];
  const identity = {
    getCurrent: vi.fn().mockResolvedValue(LEO_IDENTITY),
    list: vi.fn().mockResolvedValue(ALL_IDENTITIES),
    switch: vi.fn(async (id: string, force?: boolean) => {
      switchCalls.push({ id, force });
      if (!force) return { ok: false as const, busy: true as const, count: 2 };
      return {
        ok: true as const,
        user: ALL_IDENTITIES.find((item) => item.id === id) ?? DEFAULT_IDENTITY,
      };
    }),
    onChanged: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      identity,
      auth: {
        local: {
          getCurrent: vi.fn().mockResolvedValue(LEO_PROFILE),
          list: vi.fn().mockResolvedValue([LEO_PROFILE]),
          update: vi.fn().mockResolvedValue(LEO_PROFILE),
          create: vi.fn().mockResolvedValue({ ...LEO_PROFILE, id: 'u3', displayName: 'Local User' }),
          switch: vi.fn(),
        },
        cloud: {
          getState: vi.fn().mockResolvedValue({ configured: false, signedIn: false, account: null }),
        },
      },
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return identity;
}

async function renderPanel(): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { container, root };
  await act(async () => {
    root.render(<SettingsAccountPanel />);
  });
  await act(async () => {});
  return container;
}

async function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
}

function itemNamed(container: ParentNode, name: string): HTMLElement {
  const item = Array.from(container.querySelectorAll<HTMLElement>('.settings-item'))
    .find((el) => el.querySelector('.settings-item__title')?.textContent === name);
  if (!item) throw new Error(`settings item not found: ${name}`);
  return item;
}

function byText(container: ParentNode, text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>('button')).find(
    (el) => el.textContent?.trim() === text,
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  if (mounted) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('SettingsAccountPanel identity switching', () => {
  it('renders the default profile without hanging when no local user is active', async () => {
    const identity = installApi();
    identity.getCurrent.mockResolvedValue(DEFAULT_IDENTITY);
    const localGetCurrent = (window as any).electronAPI.auth.local.getCurrent;
    localGetCurrent.mockRejectedValue(new Error('本地用户未初始化，请先调用 initLocalUsers()'));

    const container = await renderPanel();

    expect(container.querySelector('.empty-hint')).toBeNull();
    expect(container.textContent).toContain('本地默认');
    expect(container.textContent).toContain('系统默认档');
    expect(identity.getCurrent).toHaveBeenCalled();
    expect(localGetCurrent).not.toHaveBeenCalled();
  });

  it('asks for confirmation when tasks are running and cancel aborts the switch', async () => {
    installApi();
    const container = await renderPanel();

    await fireClick(itemNamed(container, 'Ada').querySelector('button'));

    expect(switchCalls).toHaveLength(1);
    expect(switchCalls[0]!.id).toBe('u2');
    expect(switchCalls[0]!.force).toBeUndefined();
    const confirm = itemNamed(container, '切换将中断 2 个运行中的任务');
    expect(confirm).toBeTruthy();

    await fireClick(byText(confirm, '取消'));

    expect(switchCalls).toHaveLength(1);
    expect(itemNamed(container, 'Ada')).toBeTruthy();
    expect(container.textContent).not.toContain('切换将中断');
  });

  it('retries with force when the busy confirmation is accepted', async () => {
    installApi();
    const container = await renderPanel();

    await fireClick(itemNamed(container, 'Ada').querySelector('button'));
    const confirm = itemNamed(container, '切换将中断 2 个运行中的任务');
    await fireClick(byText(confirm, '继续切换'));

    expect(switchCalls).toHaveLength(2);
    expect(switchCalls[1]).toEqual({ id: 'u2', force: true });
    expect(container.textContent).not.toContain('切换将中断');
  });
});
