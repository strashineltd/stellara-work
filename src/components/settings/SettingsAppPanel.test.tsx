import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsInfo, ElectronAPI } from '../../../shared/ipc';
import { SettingsAppPanel } from './SettingsAppPanel';

const DIAG: DiagnosticsInfo = {
  version: '0.9.0-test',
  platform: 'darwin',
  arch: 'arm64',
  electron: '32.0.0',
  chrome: '128.0.0.0',
  node: '22.0.0',
  appDataPath: '/tmp/stellara',
  envPath: '/tmp/.env',
  logPath: '/tmp/main.log',
  dbSizeBytes: 20480,
  sessionCount: 3,
  messageCount: 12,
  modelCount: 1,
  activeModelId: 'deepseek-v4-pro',
  modelsWithKey: ['deepseek-v4-pro'],
  logTail: 'line1\nline2',
  collectedAt: '2026-08-08T10:00:00Z',
};

function installApi(settings: Record<string, unknown> = { theme: 'light', workspaceMode: 'sidebar' }) {
  const mocks = {
    get: vi.fn().mockResolvedValue(settings),
    update: vi.fn().mockResolvedValue(undefined),
    openDataDir: vi.fn().mockResolvedValue(undefined),
    openLogFile: vi.fn().mockResolvedValue(undefined),
    collectDiagnostics: vi.fn().mockResolvedValue(DIAG),
    resetSelective: vi.fn().mockResolvedValue({ cleared: 'all' }),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      app: {
        getInfo: vi.fn().mockResolvedValue({ version: '0.9.0-test', platform: 'darwin', appDataPath: '/tmp/stellara', envPath: '/tmp/.env' }),
      },
      settings: mocks,
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

function fireChange(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('No value setter for input');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('SettingsAppPanel', () => {
  let mocks: ReturnType<typeof installApi>;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      writable: true,
      configurable: true,
    });
    mocks = installApi();
  });

  it('renders theme and workspace mode radio cards with current settings', async () => {
    const { container } = await render(<SettingsAppPanel onChanged={vi.fn()} />);

    const themeCards = container.querySelectorAll('[role="radio"][aria-label^="主题"]');
    expect(themeCards.length).toBe(3);
    expect(themeCards[0]!.textContent).toContain('浅色');
    expect(themeCards[0]!.querySelector('.swatch')).toBeTruthy();
    expect(themeCards[1]!.textContent).toContain('深色');
    expect(themeCards[2]!.textContent).toContain('跟随系统');

    const selected = container.querySelector('[role="radio"][aria-label^="主题"][aria-checked="true"]');
    expect(selected?.textContent).toContain('浅色');

    const modeCards = container.querySelectorAll('[role="radio"][aria-label^="工作区模式"]');
    expect(modeCards.length).toBe(2);
    const selectedMode = container.querySelector('[role="radio"][aria-label^="工作区模式"][aria-checked="true"]');
    expect(selectedMode?.textContent).toContain('侧栏');
  });

  it('switches theme via settings.update and notifies parent', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsAppPanel onChanged={onChanged} />);

    const darkCard = container.querySelector('[role="radio"][aria-label="主题：深色"]');
    expect(darkCard).toBeTruthy();
    await fireClick(darkCard);

    expect(mocks.update).toHaveBeenCalledWith({ theme: 'dark' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('switches workspace mode via settings.update and notifies parent', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsAppPanel onChanged={onChanged} />);

    await fireClick(container.querySelector('[role="radio"][aria-label="工作区模式：标签页"]'));

    expect(mocks.update).toHaveBeenCalledWith({ workspaceMode: 'tabs' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('opens the data dir and the main log file', async () => {
    const { container } = await render(<SettingsAppPanel onChanged={vi.fn()} />);

    await fireClick(byText(container, '打开'));
    expect(mocks.openDataDir).toHaveBeenCalledTimes(1);

    await fireClick(byText(container, '查看'));
    expect(mocks.openLogFile).toHaveBeenCalledWith('main');
  });

  it('copies diagnostics to the clipboard', async () => {
    const { container } = await render(<SettingsAppPanel onChanged={vi.fn()} />);

    await fireClick(byText(container, '复制'));

    expect(mocks.collectDiagnostics).toHaveBeenCalledTimes(1);
    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    const text = clipboardWrite.mock.calls[0]![0] as string;
    expect(text).toContain('v0.9.0-test');
    expect(text).toContain('/tmp/main.log');
    expect(text).toContain('line1');
    expect(byText(container, '已复制')).toBeTruthy();
  });

  it('keeps the clear-all button disabled until DELETE is typed, then resets all data', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsAppPanel onChanged={onChanged} />);

    const clearButton = container.querySelector('.settings-danger-zone .btn-danger') as HTMLButtonElement;
    expect(clearButton.disabled).toBe(true);

    const input = container.querySelector('#clear-all-confirm') as HTMLInputElement;
    fireChange(input, 'DELETE');
    expect(clearButton.disabled).toBe(false);

    await fireClick(clearButton);
    expect(mocks.resetSelective).toHaveBeenCalledWith('all');
    expect(onChanged).toHaveBeenCalledTimes(1);

    expect(mocks.update).not.toHaveBeenCalled();
  });
});
