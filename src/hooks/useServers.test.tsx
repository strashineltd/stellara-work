import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, ServerEntry, ServerStatusEntry } from '../../shared/ipc';
import { useServers } from './useServers';

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

const STATUSES: ServerStatusEntry[] = [{ id: 'srv-1', status: 'connected' }];

let api: ReturnType<typeof useServers> | null = null;

function Harness() {
  api = useServers();
  return (
    <span>
      {api.servers.map((server) => server.name).join(',')}
      {'|'}
      {api.statuses.map((status) => `${status.id}:${status.status}`).join(',')}
    </span>
  );
}

function installApi() {
  const mocks = {
    list: vi.fn().mockResolvedValue(SERVERS),
    status: vi.fn().mockResolvedValue(STATUSES),
    onStatusChanged: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: { servers: mocks } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

async function renderHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  await act(async () => {});
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useServers', () => {
  beforeEach(() => {
    api = null;
    document.body.innerHTML = '';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  it('loads servers and statuses on mount', async () => {
    const mocks = installApi();
    const { container, unmount } = await renderHarness();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('本地服务器,远程开发机');
    expect(container.textContent).toContain('srv-1:connected');
    unmount();
  });

  it('merges onStatusChanged broadcasts and adds unknown ids', async () => {
    const mocks = installApi();
    const unsubscribe = vi.fn();
    mocks.onStatusChanged.mockReturnValue(unsubscribe);
    const { container, unmount } = await renderHarness();

    const emit = mocks.onStatusChanged.mock.calls[0]![0] as (statuses: ServerStatusEntry[]) => void;
    await act(async () => {
      emit([
        { id: 'srv-1', status: 'error', error: '连接失败' },
        { id: 'srv-3', status: 'connecting' },
      ]);
    });

    expect(api!.statuses).toEqual([
      { id: 'srv-1', status: 'error', error: '连接失败' },
      { id: 'srv-3', status: 'connecting' },
    ]);
    expect(container.textContent).toContain('srv-1:error');
    expect(container.textContent).toContain('srv-3:connecting');

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('refresh re-runs both list and status loads', async () => {
    const mocks = installApi();
    const { container, unmount } = await renderHarness();

    mocks.list.mockResolvedValue([SERVERS[1]!]);
    mocks.status.mockResolvedValue([{ id: 'srv-2', status: 'connecting' }]);
    await act(async () => {
      api!.refresh();
    });
    await act(async () => {});

    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('远程开发机');
    expect(container.textContent).not.toContain('本地服务器');
    expect(container.textContent).toContain('srv-2:connecting');
    unmount();
  });

  it('stays inert when the servers API is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: {},
      writable: true,
      configurable: true,
    });
    const { container, unmount } = await renderHarness();

    expect(container.textContent).toBe('|');
    act(() => {
      api!.refresh();
    });
    expect(container.textContent).toBe('|');
    unmount();
  });
});
