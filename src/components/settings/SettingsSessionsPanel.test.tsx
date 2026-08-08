import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, SessionSummary } from '../../../shared/ipc';
import { SettingsSessionsPanel } from './SettingsSessionsPanel';

const SESSIONS: SessionSummary[] = [
  {
    id: 's1',
    title: '记忆中心升级：UI 重设计与 MD 导出',
    modelId: 'deepseek-v4-pro',
    workDir: '/Users/lhy/桌面端项目',
    messageCount: 42,
    updatedAt: Date.now() - 3600_000,
  },
  {
    id: 's2',
    title: 'macOS 深度适配：Agent 平台感知',
    modelId: 'glm-5.2',
    workDir: '/Users/lhy/桌面端项目',
    messageCount: 7,
    updatedAt: Date.now() - 90 * 86_400_000,
  },
  {
    id: 's3',
    title: '数据本地桌面 Agent 原型讨论',
    modelId: 'deepseek-v4-pro',
    messageCount: 3,
    updatedAt: Date.now() - 3 * 86_400_000,
  },
];

function installApi(sessions: SessionSummary[] = SESSIONS) {
  const mocks = {
    list: vi.fn().mockResolvedValue(sessions),
    delete: vi.fn().mockResolvedValue(undefined),
    resetSelective: vi.fn().mockResolvedValue({ cleared: 'sessions', count: sessions.length }),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      sessions: { list: mocks.list, delete: mocks.delete },
      settings: {
        get: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue(undefined),
        resetSelective: mocks.resetSelective,
      },
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

async function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('SettingsSessionsPanel', () => {
  let mocks: ReturnType<typeof installApi>;
  let confirmMock: ReturnType<typeof vi.fn<(message?: string) => boolean>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmMock = vi.fn<(message?: string) => boolean>().mockReturnValue(true);
    window.confirm = confirmMock;
    mocks = installApi();
  });

  it('renders sessions with title, relative time, project name and count', async () => {
    const { container } = await render(<SettingsSessionsPanel onChanged={vi.fn()} />);

    expect(mocks.list).toHaveBeenCalledTimes(1);

    const rows = container.querySelectorAll('.settings-session-row');
    expect(rows.length).toBe(3);

    const row0 = rows[0]!;
    expect(row0.textContent).toContain('记忆中心升级：UI 重设计与 MD 导出');
    expect(row0.textContent).toContain('1 小时前');
    expect(row0.textContent).toContain('桌面端项目');

    const row1 = rows[1]!;
    expect(row1.textContent).toContain('macOS 深度适配：Agent 平台感知');

    const row2 = rows[2]!;
    expect(row2.textContent).toContain('未分组');

    const title = container.querySelector('.settings-section__title');
    expect(title?.textContent).toContain('最近会话');
    expect(title?.textContent).toContain('3');
  });

  it('shows an empty hint when there are no sessions', async () => {
    installApi([]);
    const { container } = await render(<SettingsSessionsPanel onChanged={vi.fn()} />);

    expect(container.querySelector('.settings-session-row')).toBeNull();
    expect(container.textContent).toContain('还没有会话');
  });

  it('deletes a session after confirm and refreshes the list; skips when cancelled', async () => {
    const { container } = await render(<SettingsSessionsPanel onChanged={vi.fn()} />);

    const rows = container.querySelectorAll('.settings-session-row');
    await fireClick(rows[0]!.querySelector('.icon-btn[title="删除"]'));

    expect(confirmMock).toHaveBeenCalled();
    expect(mocks.delete).toHaveBeenCalledWith('s1');
    expect(mocks.list).toHaveBeenCalledTimes(2);

    confirmMock.mockReturnValue(false);
    await fireClick(rows[1]!.querySelector('.icon-btn[title="删除"]'));
    expect(mocks.delete).toHaveBeenCalledTimes(1);
  });

  it('clears all sessions via resetSelective after confirm and notifies parent', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsSessionsPanel onChanged={onChanged} />);

    const dangerZone = container.querySelector('.settings-danger-zone');
    expect(dangerZone?.textContent).toContain('清空所有会话');

    await fireClick(dangerZone!.querySelector('.btn-danger'));

    expect(confirmMock).toHaveBeenCalled();
    expect(mocks.resetSelective).toHaveBeenCalledWith('sessions');
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('skips clearing all sessions when the confirm dialog is dismissed', async () => {
    confirmMock.mockReturnValue(false);
    const { container } = await render(<SettingsSessionsPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-danger-zone .btn-danger'));

    expect(mocks.resetSelective).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});
