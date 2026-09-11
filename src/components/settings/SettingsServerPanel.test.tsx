import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, ServerEntry, ServerStatusEntry, ServerTestResult } from '../../../shared/ipc';
import { SettingsServerPanel } from './SettingsServerPanel';

const SERVERS: ServerEntry[] = [
  {
    id: 'srv-1',
    name: '本地服务器',
    url: 'http://localhost:4096',
    username: 'opencode',
    hasPassword: true,
    isDefault: false,
    createdAt: '2026-09-10T00:00:00Z',
  },
  {
    id: 'srv-2',
    name: '远程开发机',
    url: 'http://10.0.0.5:4096',
    hasPassword: false,
    isDefault: true,
    createdAt: '2026-09-10T00:00:00Z',
  },
];

const STATUSES: ServerStatusEntry[] = [
  { id: 'srv-1', status: 'connected' },
  { id: 'srv-2', status: 'disconnected' },
];

const NEW_SERVER: ServerEntry = {
  id: 'srv-3',
  name: '开发服务器',
  url: 'http://127.0.0.1:4096',
  hasPassword: true,
  isDefault: false,
  createdAt: '2026-09-11T00:00:00Z',
};

function installApi(servers: ServerEntry[] = SERVERS, statuses: ServerStatusEntry[] = STATUSES) {
  const mocks = {
    list: vi.fn().mockResolvedValue(servers),
    add: vi.fn().mockResolvedValue(NEW_SERVER),
    update: vi.fn().mockResolvedValue(SERVERS[0]),
    remove: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue({ ok: true, status: 'connected' } as ServerTestResult),
    setDefault: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue(statuses),
    onStatusChanged: vi.fn().mockReturnValue(() => {}),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: { servers: mocks } as unknown as ElectronAPI,
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

function firePointerDown(element: Element | Document) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

function fireEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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

function row(container: Element, id: string): Element {
  const element = container.querySelector(`.settings-server-row[data-server-id="${id}"]`);
  if (!element) throw new Error(`server row not found: ${id}`);
  return element;
}

function menuItem(rowElement: Element, text: string): Element {
  const items = Array.from(rowElement.querySelectorAll('[role="menuitem"]'));
  const found = items.find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`menu item not found: ${text}`);
  return found;
}

async function openMenu(container: Element, id: string) {
  await fireClick(row(container, id).querySelector('.settings-server-row__menu-btn'));
}

describe('SettingsServerPanel', () => {
  let mocks: ReturnType<typeof installApi>;
  let confirmMock: ReturnType<typeof vi.fn<() => boolean>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    confirmMock = vi.fn<() => boolean>().mockReturnValue(true);
    window.confirm = confirmMock as unknown as typeof window.confirm;
    mocks = installApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the empty state and the add button when there are no servers', async () => {
    installApi([], []);
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    expect(container.querySelector('.settings-server-row')).toBeNull();
    expect(byText(container, '还没有服务器')).toBeTruthy();
    expect(container.querySelector('.settings-server-add')?.textContent).toContain('添加服务器');
  });

  it('opens the add dialog and rejects an empty URL without calling servers.add', async () => {
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-server-add'));
    const dialog = container.querySelector('.server-dialog');
    expect(dialog).toBeTruthy();

    const urlInput = dialog!.querySelector('#server-url') as HTMLInputElement;
    expect(urlInput.value).toBe('http://localhost:4096');
    fireChange(urlInput, '   ');

    await fireClick(dialog!.querySelector('.server-dialog__save'));

    expect(mocks.add).not.toHaveBeenCalled();
    expect(byText(dialog!, '请填写服务器 URL')).toBeTruthy();
    expect(container.querySelector('.server-dialog')).toBeTruthy();
  });

  it('adds a server with url/name/password, closes the dialog and refreshes the list', async () => {
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-server-add'));
    const dialog = container.querySelector('.server-dialog') as HTMLElement;
    fireChange(dialog.querySelector('#server-url') as HTMLInputElement, 'http://127.0.0.1:4096');
    fireChange(dialog.querySelector('#server-name') as HTMLInputElement, '开发服务器');
    fireChange(dialog.querySelector('#server-password') as HTMLInputElement, 'secret');

    await fireClick(dialog.querySelector('.server-dialog__save'));

    expect(mocks.add).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:4096',
      name: '开发服务器',
      password: 'secret',
    });
    expect(container.querySelector('.server-dialog')).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it('renders rows with status dots and runs a connection test from the row menu', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsServerPanel onChanged={onChanged} />);

    const first = row(container, 'srv-1');
    expect(first.querySelector('.server-status-dot')?.getAttribute('data-status')).toBe('connected');
    expect(first.textContent).toContain('本地服务器');
    expect(first.textContent).toContain('http://localhost:4096');
    expect(row(container, 'srv-2').querySelector('.server-status-dot')?.getAttribute('data-status')).toBe(
      'disconnected',
    );

    await openMenu(container, 'srv-1');
    await fireClick(menuItem(row(container, 'srv-1'), '测试连接'));

    expect(mocks.test).toHaveBeenCalledWith('srv-1');
    expect(byText(row(container, 'srv-1'), '连接成功')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);

    mocks.test.mockResolvedValueOnce({ ok: false, status: 'error', error: '鉴权失败: HTTP 401' });
    await openMenu(container, 'srv-1');
    await fireClick(menuItem(row(container, 'srv-1'), '测试连接'));

    expect(byText(row(container, 'srv-1'), '鉴权失败，请检查用户名或密码')).toBeTruthy();
    expect(row(container, 'srv-1').querySelector('.server-status-dot')?.getAttribute('data-status')).toBe('error');
  });

  it('closes the row menu on outside pointerdown and Escape, and still toggles from the trigger', async () => {
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    await openMenu(container, 'srv-1');
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeTruthy();
    firePointerDown(document.body);
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeNull();

    await openMenu(container, 'srv-1');
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeTruthy();
    fireEscape();
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeNull();

    const trigger = row(container, 'srv-1').querySelector('.settings-server-row__menu-btn')!;
    firePointerDown(trigger);
    await fireClick(trigger);
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeTruthy();
    firePointerDown(trigger);
    await fireClick(trigger);
    expect(row(container, 'srv-1').querySelector('.settings-server-row__menu')).toBeNull();
  });

  it('subscribes to onStatusChanged and merges broadcasts into row dots', async () => {
    const unsubscribe = vi.fn();
    mocks.onStatusChanged.mockReturnValue(unsubscribe);
    const { container, unmount } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    expect(mocks.onStatusChanged).toHaveBeenCalledTimes(1);
    const emit = mocks.onStatusChanged.mock.calls[0]![0] as (statuses: ServerStatusEntry[]) => void;

    await act(async () => {
      emit([
        { id: 'srv-1', status: 'connecting' },
        { id: 'srv-2', status: 'error', error: '连接失败' },
      ]);
    });

    expect(row(container, 'srv-1').querySelector('.server-status-dot')?.getAttribute('data-status')).toBe('connecting');
    expect(row(container, 'srv-2').querySelector('.server-status-dot')?.getAttribute('data-status')).toBe('error');

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sets a default server and deletes one only after confirmation', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsServerPanel onChanged={onChanged} />);

    await openMenu(container, 'srv-1');
    await fireClick(menuItem(row(container, 'srv-1'), '设为默认'));

    expect(mocks.setDefault).toHaveBeenCalledWith('srv-1');
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledTimes(1);

    await openMenu(container, 'srv-1');
    await fireClick(menuItem(row(container, 'srv-1'), '删除'));

    expect(confirmMock).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith('srv-1');
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(onChanged).toHaveBeenCalledTimes(2);

    confirmMock.mockReturnValue(false);
    await openMenu(container, 'srv-2');
    await fireClick(menuItem(row(container, 'srv-2'), '删除'));

    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it('edits a server without echoing the stored password', async () => {
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    await openMenu(container, 'srv-1');
    await fireClick(menuItem(row(container, 'srv-1'), '编辑'));

    const dialog = container.querySelector('.server-dialog') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect((dialog.querySelector('#server-url') as HTMLInputElement).value).toBe('http://localhost:4096');
    expect((dialog.querySelector('#server-name') as HTMLInputElement).value).toBe('本地服务器');
    expect((dialog.querySelector('#server-username') as HTMLInputElement).value).toBe('opencode');

    const password = dialog.querySelector('#server-password') as HTMLInputElement;
    expect(password.value).toBe('');
    expect(password.getAttribute('placeholder')).toContain('保持不变');

    fireChange(dialog.querySelector('#server-name') as HTMLInputElement, '改名服务器');
    await fireClick(dialog.querySelector('.server-dialog__save'));

    expect(mocks.update).toHaveBeenCalledWith('srv-1', {
      url: 'http://localhost:4096',
      name: '改名服务器',
    });
    expect(container.querySelector('.server-dialog')).toBeNull();
  });

  it('maps auth and protocol save failures to Chinese hints and keeps the dialog open', async () => {
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    mocks.add.mockRejectedValueOnce(new Error('鉴权失败: HTTP 401'));
    await fireClick(container.querySelector('.settings-server-add'));
    let dialog = container.querySelector('.server-dialog') as HTMLElement;
    fireChange(dialog.querySelector('#server-url') as HTMLInputElement, 'http://localhost:4096');
    fireChange(dialog.querySelector('#server-password') as HTMLInputElement, 'bad');
    await fireClick(dialog.querySelector('.server-dialog__save'));

    expect(byText(dialog, '鉴权失败，请检查用户名或密码')).toBeTruthy();
    expect(container.querySelector('.server-dialog')).toBeTruthy();

    mocks.add.mockRejectedValueOnce(new Error('服务器 URL 必须是 http:// 或 https:// 地址'));
    await fireClick(dialog.querySelector('.server-dialog__cancel'));
    await fireClick(container.querySelector('.settings-server-add'));
    dialog = container.querySelector('.server-dialog') as HTMLElement;
    fireChange(dialog.querySelector('#server-url') as HTMLInputElement, 'file:///etc/passwd');
    await fireClick(dialog.querySelector('.server-dialog__save'));

    expect(byText(dialog, '服务器 URL 仅支持 http/https')).toBeTruthy();
  });

  it('disables the save button while the save is in flight', async () => {
    let resolveAdd!: (value: ServerEntry) => void;
    mocks.add.mockReturnValueOnce(
      new Promise<ServerEntry>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    const { container } = await render(<SettingsServerPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-server-add'));
    const dialog = container.querySelector('.server-dialog') as HTMLElement;
    const save = dialog.querySelector('.server-dialog__save') as HTMLButtonElement;
    await fireClick(save);

    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain('保存中');

    await act(async () => {
      resolveAdd(NEW_SERVER);
      await Promise.resolve();
    });
    expect(container.querySelector('.server-dialog')).toBeNull();
  });
});
