import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../../shared/ipc';
import { DEFAULT_SHORTCUTS } from '../../../shared/shortcuts';
import { SettingsShortcutsPanel } from './SettingsShortcutsPanel';

function installApi(settings: Record<string, unknown> = {}) {
  const mocks = {
    get: vi.fn().mockResolvedValue(settings),
    update: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      settings: mocks,
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

let cleanup: (() => void) | null = null;

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  cleanup = () => {
    act(() => root!.unmount());
    document.body.removeChild(container);
  };
  return {
    container,
  };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function fireKeydown(init: KeyboardEventInit) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

function byText(root: Element, text: string): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(text)) return node.parentElement;
  }
  return null;
}

describe('SettingsShortcutsPanel', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.documentElement.dataset.platform;
    mocks = installApi();
  });

  it('renders three groups (导航/操作/标签页) with all shortcut rows', async () => {
    const { container } = await render(<SettingsShortcutsPanel onChanged={vi.fn()} />);

    const sectionTitles = container.querySelectorAll('.settings-section__title');
    expect(sectionTitles[0]!.textContent).toContain('导航');
    expect(sectionTitles[1]!.textContent).toContain('操作');
    expect(sectionTitles[2]!.textContent).toContain('标签页');

    const rows = container.querySelectorAll('.settings-shortcut-row');
    expect(rows.length).toBe(17);
    expect(byText(container, '切换左会话栏')).toBeTruthy();
    expect(byText(container, '切换 Plan 模式')).toBeTruthy();
    expect(byText(container, '切换到 Tab 1')).toBeTruthy();
    expect(byText(container, '恢复关闭的 Tab')).toBeTruthy();
  });

  it('shows Cmd bindings on darwin platforms', async () => {
    document.documentElement.dataset.platform = 'darwin';
    const { container } = await render(<SettingsShortcutsPanel onChanged={vi.fn()} />);

    const sidebarRow = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    expect(sidebarRow?.querySelector('.kbd')?.textContent).toBe('Cmd + B');
    const paletteRow = container.querySelector('.settings-shortcut-row[data-action="openCommandPalette"]');
    expect(paletteRow?.querySelector('.kbd')?.textContent).toBe('Cmd + K');
    const planRow = container.querySelector('.settings-shortcut-row[data-action="togglePlanMode"]');
    expect(planRow?.querySelector('.kbd')?.textContent).toBe('Cmd + Shift + P');
  });

  it('keeps Ctrl bindings on non-darwin platforms', async () => {
    document.documentElement.dataset.platform = 'win32';
    const { container } = await render(<SettingsShortcutsPanel onChanged={vi.fn()} />);

    const sidebarRow = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    expect(sidebarRow?.querySelector('.kbd')?.textContent).toBe('Ctrl + B');
  });

  it('enters recording mode when a row is clicked', async () => {
    const { container } = await render(<SettingsShortcutsPanel onChanged={vi.fn()} />);

    const row = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    await fireClick(row);

    const kbd = row?.querySelector('.kbd');
    expect(kbd?.textContent).toBe('按任意键…');
    expect(kbd?.classList.contains('rec')).toBe(true);
  });

  it('commits a recorded combo via settings.update and notifies parent', async () => {
    const onChanged = vi.fn();
    mocks = installApi({ shortcuts: { toggleSidebar: 'Ctrl+Alt+X' } });
    const { container } = await render(<SettingsShortcutsPanel onChanged={onChanged} />);

    const row = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    await fireClick(row);
    await fireKeydown({ key: 'b', ctrlKey: true });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const patch = mocks.update.mock.calls[0]![0] as { shortcuts: Record<string, string> };
    expect(patch.shortcuts.toggleSidebar).toBe('Ctrl+B');
    expect(patch.shortcuts.togglePlanMode).toBe(DEFAULT_SHORTCUTS.togglePlanMode);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(row?.querySelector('.kbd')?.classList.contains('rec')).toBe(false);
  });

  it('cancels recording on Escape without saving', async () => {
    const onChanged = vi.fn();
    mocks = installApi({ shortcuts: { toggleSidebar: 'Ctrl+Alt+X' } });
    const { container } = await render(<SettingsShortcutsPanel onChanged={onChanged} />);

    const row = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    await fireClick(row);
    await fireKeydown({ key: 'Escape' });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(row?.querySelector('.kbd')?.textContent).toBe('Ctrl + Alt + X');
  });

  it('reset all clears overrides and persists an empty shortcuts map', async () => {
    const onChanged = vi.fn();
    mocks = installApi({ shortcuts: { toggleSidebar: 'Ctrl+Alt+X' } });
    const { container } = await render(<SettingsShortcutsPanel onChanged={onChanged} />);

    const row = container.querySelector('.settings-shortcut-row[data-action="toggleSidebar"]');
    expect(row?.querySelector('.kbd')?.textContent).toBe('Ctrl + Alt + X');

    await fireClick(byText(container, '重置全部'));

    expect(mocks.update).toHaveBeenCalledWith({ shortcuts: {} });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(row?.querySelector('.kbd')?.textContent).toBe('Ctrl + B');
  });
});
