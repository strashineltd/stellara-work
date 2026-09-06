import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsBrowserPanel } from './SettingsBrowserPanel';

const BASE = { searchProvider: 'auto', execJsEnabled: false, hasTavilyKey: false, hasBraveKey: false, loginAllowlist: [] as string[] };

interface BrowserMocks {
  getConfig: ReturnType<typeof vi.fn>;
  updateConfig: ReturnType<typeof vi.fn>;
  setSearchKey: ReturnType<typeof vi.fn>;
  clearSearchKey: ReturnType<typeof vi.fn>;
}

let mocks: BrowserMocks;

function installApi(overrides: Partial<typeof BASE> = {}) {
  const config = { ...BASE, ...overrides };
  mocks = {
    getConfig: vi.fn().mockResolvedValue(config),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    setSearchKey: vi.fn().mockResolvedValue(undefined),
    clearSearchKey: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      browser: mocks,
      app: { onSettingsChanged: vi.fn(() => () => {}) },
    },
    writable: true,
    configurable: true,
  });
  return { mocks, config };
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

describe('SettingsBrowserPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('toggles execJsEnabled via updateConfig', async () => {
    mocks = installApi().mocks;
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    await act(async () => { box?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.updateConfig).toHaveBeenCalledWith({ execJsEnabled: true });
    unmount();
  });

  it('saves a Tavily key via setSearchKey', async () => {
    mocks = installApi().mocks;
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    const input = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => { setVal?.call(input, 'tvly-123'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
    const save = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('保存'));
    await act(async () => { save?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.setSearchKey).toHaveBeenCalledWith('tavily', 'tvly-123');
    unmount();
  });

  it('shows 已配置 and clears a configured Brave key', async () => {
    mocks = installApi({ hasBraveKey: true }).mocks;
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    expect(container.textContent).toContain('已配置');
    const clear = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('清除'));
    await act(async () => { clear?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.clearSearchKey).toHaveBeenCalledWith('brave');
    unmount();
  });

  it('warns when provider is tavily but no key is configured', async () => {
    mocks = installApi({ searchProvider: 'tavily' }).mocks;
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    expect(container.textContent).toContain('尚未配置');
    unmount();
  });

  it('adds a valid domain to the allowlist via updateConfig', async () => {
    installApi({ loginAllowlist: [] });
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    const input = container.querySelector('input[placeholder="例如 github.com"]') as HTMLInputElement | null;
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => { setVal?.call(input, 'https://Github.com/login'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
    const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('添加'));
    await act(async () => { add?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.updateConfig).toHaveBeenCalledWith({ loginAllowlist: ['github.com'] });
    unmount();
  });

  it('rejects invalid input without calling updateConfig', async () => {
    installApi({ loginAllowlist: [] });
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    const input = container.querySelector('input[placeholder="例如 github.com"]') as HTMLInputElement | null;
    const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => { setVal?.call(input, 'a b.com'); input?.dispatchEvent(new Event('input', { bubbles: true })); });
    const add = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('添加'));
    await act(async () => { add?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(container.textContent).toContain('无效的登录保留域名');
    unmount();
  });

  it('removes an allowlist chip via updateConfig', async () => {
    installApi({ loginAllowlist: ['github.com'] });
    const { container, unmount } = await render(<SettingsBrowserPanel />);
    const del = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('删除'));
    await act(async () => { del?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(mocks.updateConfig).toHaveBeenCalledWith({ loginAllowlist: [] });
    unmount();
  });
});
