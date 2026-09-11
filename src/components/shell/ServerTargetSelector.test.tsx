import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEntry, ServerStatusEntry } from '../../../shared/ipc';
import { ServerTargetSelector } from './ServerTargetSelector';

const SERVERS: ServerEntry[] = [
  {
    id: 'srv-1',
    name: '本地服务器',
    url: 'http://localhost:4096',
    hasPassword: false,
    isDefault: false,
    createdAt: '2026-09-10T00:00:00Z',
  },
  {
    id: 'srv-2',
    name: '远程开发机',
    url: 'http://10.0.0.5:4096',
    hasPassword: true,
    isDefault: true,
    createdAt: '2026-09-10T00:00:00Z',
  },
];

const STATUSES: ServerStatusEntry[] = [
  { id: 'srv-1', status: 'connected' },
  { id: 'srv-2', status: 'error', error: '连接失败' },
];

type Props = React.ComponentProps<typeof ServerTargetSelector>;

function renderSelector(overrides: Partial<Props> = {}) {
  const props: Props = {
    servers: SERVERS,
    statuses: STATUSES,
    value: { kind: 'local' },
    onChange: vi.fn(),
    onManageServers: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<ServerTargetSelector {...props} />);
  });
  return {
    container,
    props,
    rerender: (next: Partial<Props>) => {
      Object.assign(props, next);
      act(() => {
        root.render(<ServerTargetSelector {...props} />);
      });
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function firePointerDown(element: Element | Document) {
  act(() => element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
}

function fireEscape() {
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
}

function fireTransitionEnd(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for transitionend');
  act(() => element.dispatchEvent(new Event('transitionend', { bubbles: true })));
}

describe('ServerTargetSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('shows 本地 as the default target with a connected dot', () => {
    const { container, unmount } = renderSelector();
    const trigger = container.querySelector('.server-target__trigger');
    expect(trigger?.textContent).toContain('本地');
    expect(trigger?.getAttribute('data-status')).toBe('connected');
    unmount();
  });

  it('shows the selected server name and its runtime status', () => {
    const { container, unmount } = renderSelector({ value: { kind: 'server', serverId: 'srv-2' } });
    const trigger = container.querySelector('.server-target__trigger');
    expect(trigger?.textContent).toContain('远程开发机');
    expect(trigger?.getAttribute('data-status')).toBe('error');
    unmount();
  });

  it('lists 本地 and every configured server with data-status', () => {
    const { container, unmount } = renderSelector();
    fireClick(container.querySelector('.server-target__trigger'));

    expect(container.querySelector('.server-target__menu')).not.toBeNull();
    const items = Array.from(container.querySelectorAll('.server-target__item'));
    expect(items.some((item) => item.textContent?.includes('本地'))).toBe(true);
    expect(container.querySelector('.server-target__item[data-status="connected"]')?.textContent).toContain('本地服务器');
    expect(container.querySelector('.server-target__item[data-status="error"]')?.textContent).toContain('远程开发机');
    unmount();
  });

  it('reports server selection and closes the menu', () => {
    const onChange = vi.fn();
    const { container, unmount } = renderSelector({ onChange });
    fireClick(container.querySelector('.server-target__trigger'));

    fireClick(container.querySelector('.server-target__item[data-status="connected"]'));

    expect(onChange).toHaveBeenCalledWith({ kind: 'server', serverId: 'srv-1' });
    expect(container.querySelector('.server-target__trigger')?.getAttribute('aria-expanded')).toBe('false');
    fireTransitionEnd(container.querySelector('.server-target__menu'));
    expect(container.querySelector('.server-target__menu')).toBeNull();
    unmount();
  });

  it('reports local selection', () => {
    const onChange = vi.fn();
    const { container, unmount } = renderSelector({ onChange, value: { kind: 'server', serverId: 'srv-1' } });
    fireClick(container.querySelector('.server-target__trigger'));

    const local = Array.from(container.querySelectorAll('.server-target__item')).find((item) =>
      item.textContent?.includes('本地'),
    );
    fireClick(local);

    expect(onChange).toHaveBeenCalledWith({ kind: 'local' });
    unmount();
  });

  it('offers 重连 only on error rows and reports onReconnect without changing target', () => {
    const onChange = vi.fn();
    const onReconnect = vi.fn();
    const { container, unmount } = renderSelector({ onChange, onReconnect });
    fireClick(container.querySelector('.server-target__trigger'));

    expect(container.querySelector('.server-target__row[data-server-id="srv-1"] .server-target__reconnect')).toBeNull();
    fireClick(container.querySelector('.server-target__row[data-server-id="srv-2"] .server-target__reconnect'));

    expect(onReconnect).toHaveBeenCalledWith('srv-2');
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  it('opens the server settings from the manage item', () => {
    const onManageServers = vi.fn();
    const { container, unmount } = renderSelector({ onManageServers });
    fireClick(container.querySelector('.server-target__trigger'));

    fireClick(container.querySelector('.server-target__manage'));

    expect(onManageServers).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('dismisses on outside pointerdown and Escape while the trigger keeps toggling', () => {
    const { container, unmount } = renderSelector();
    const trigger = container.querySelector('.server-target__trigger');

    fireClick(trigger);
    expect(container.querySelectorAll('.server-target__item').length).toBeGreaterThan(0);
    firePointerDown(document.body);
    fireTransitionEnd(container.querySelector('.server-target__menu'));
    expect(container.querySelector('.server-target__menu')).toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');

    fireClick(trigger);
    expect(container.querySelector('.server-target__menu')).not.toBeNull();
    fireEscape();
    fireTransitionEnd(container.querySelector('.server-target__menu'));
    expect(container.querySelector('.server-target__menu')).toBeNull();

    firePointerDown(trigger!);
    fireClick(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    firePointerDown(trigger!);
    fireClick(trigger);
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });
});
