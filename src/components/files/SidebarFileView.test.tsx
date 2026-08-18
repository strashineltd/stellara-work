import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ElectronAPI } from '../../../shared/ipc';
import { filePreviewCache } from '../../lib/file-preview-cache';
import { SidebarFileView } from './SidebarFileView';

const TREE = {
  name: 'Workspace',
  path: '/w',
  type: 'dir',
  children: [
    {
      name: 'src',
      path: '/w/src',
      type: 'dir',
      children: [{ name: 'a.ts', path: '/w/src/a.ts', type: 'file', size: 12 }],
    },
    { name: 'b.ts', path: '/w/b.ts', type: 'file', size: 5 },
  ],
};

function installApi() {
  const mocks = {
    listTree: vi.fn().mockResolvedValue(TREE),
    readFile: vi.fn().mockResolvedValue({ content: 'BODY', size: 5, truncated: false }),
    openPath: vi.fn().mockResolvedValue(true),
    createFile: vi.fn().mockResolvedValue({ path: '/w/notes.md' }),
    mkdir: vi.fn().mockResolvedValue('/w/docs'),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: { fs: mocks } as unknown as ElectronAPI,
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
    rerender: async (next: React.ReactElement) => {
      await act(async () => {
        root!.render(next);
      });
    },
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

function rowByName(container: HTMLElement, name: string): Element {
  const rows = container.querySelectorAll('.ftree-row');
  for (const row of rows) {
    if (row.textContent?.includes(name)) return row;
  }
  throw new Error(`row not found: ${name}`);
}

async function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function fireInput(element: HTMLInputElement | null, value: string) {
  if (!element) throw new Error('Input not found');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function menuItem(container: HTMLElement, text: string): Element {
  const items = container.querySelectorAll('.new-entry-menu__item');
  for (const item of items) {
    if (item.textContent?.includes(text)) return item;
  }
  throw new Error(`menu item not found: ${text}`);
}

describe('SidebarFileView', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    filePreviewCache.clear();
    mocks = installApi();
  });

  it('shows a hint and skips listTree when workDir is empty', async () => {
    const { container } = await render(<SidebarFileView workDir={null} />);

    expect(container.textContent).toContain('先创建或选择一个项目');
    expect(mocks.listTree).not.toHaveBeenCalled();
  });

  it('loads the tree and renders root children when workDir is set', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    expect(mocks.listTree).toHaveBeenCalledWith('/w', 4);
    expect(container.querySelector('.ftree-row')?.textContent).toContain('Workspace');
    expect(container.textContent).toContain('src');
    expect(container.textContent).toContain('b.ts');
  });

  it('previews a file on click and serves repeat clicks from the cache', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await act(async () => {
      rowByName(container, 'b.ts').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(mocks.readFile).toHaveBeenCalledWith('/w', '/w/b.ts', 100 * 1024);
    expect(container.querySelector('.sidebar-file-view__preview-content')?.textContent).toContain('BODY');
    expect(filePreviewCache.get('/w', '/w/b.ts')).toEqual({ content: 'BODY', truncated: false });

    await act(async () => {
      rowByName(container, 'b.ts').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it('opens the file via fs.openPath on double-click', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await act(async () => {
      rowByName(container, 'b.ts').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    expect(mocks.openPath).toHaveBeenCalledWith('/w', '/w/b.ts');
  });

  it('reloads the tree on the refresh button', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);
    expect(mocks.listTree).toHaveBeenCalledTimes(1);

    const refresh = container.querySelector('.sidebar-file-view__refresh');
    await act(async () => {
      refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(mocks.listTree).toHaveBeenCalledTimes(2);
  });

  it('clears the preview cache and reloads when workDir changes', async () => {
    const { container, rerender } = await render(<SidebarFileView workDir="/w" />);
    filePreviewCache.set('/w2', '/w2/x.ts', { content: 'stale', truncated: false });

    await rerender(<SidebarFileView workDir="/w2" />);
    await act(async () => {});

    expect(mocks.listTree).toHaveBeenLastCalledWith('/w2', 4);
    expect(filePreviewCache.get('/w2', '/w2/x.ts')).toBeNull();
    expect(container.textContent).toContain('Workspace');
  });

  it('disables the new entry trigger when there is no work directory', async () => {
    const { container } = await render(<SidebarFileView workDir={null} />);
    const trigger = container.querySelector('.new-entry-menu__trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.disabled).toBe(true);
  });

  it('opens the new entry dropdown with file and folder options', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await fireClick(container.querySelector('.new-entry-menu__trigger'));
    expect(container.textContent).toContain('新建文件');
    expect(container.textContent).toContain('新建文件夹');
  });

  it('creates a new file and refreshes the tree on success', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await fireClick(container.querySelector('.new-entry-menu__trigger'));
    await fireClick(menuItem(container, '新建文件'));
    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, 'notes.md');
    await fireClick(container.querySelector('.new-entry-menu__confirm'));

    expect(mocks.createFile).toHaveBeenCalledWith('/w', 'notes.md');
    expect(mocks.listTree).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
  });

  it('creates a new folder via fs.mkdir and refreshes the tree on success', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await fireClick(container.querySelector('.new-entry-menu__trigger'));
    await fireClick(menuItem(container, '新建文件夹'));
    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, 'docs');
    await fireClick(container.querySelector('.new-entry-menu__confirm'));

    expect(mocks.mkdir).toHaveBeenCalledWith('/w', 'docs');
    expect(mocks.listTree).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
  });

  it('shows an error and does not call the API for invalid names', async () => {
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await fireClick(container.querySelector('.new-entry-menu__trigger'));
    await fireClick(menuItem(container, '新建文件'));

    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, '../evil.md');
    await fireClick(container.querySelector('.new-entry-menu__confirm'));
    expect(container.querySelector('.new-entry-menu__error')?.textContent).toContain('不能包含');
    expect(mocks.createFile).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();

    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, '   ');
    await fireClick(container.querySelector('.new-entry-menu__confirm'));
    expect(container.querySelector('.new-entry-menu__error')?.textContent).toContain('请输入名称');
    expect(mocks.createFile).not.toHaveBeenCalled();
  });

  it('shows the API error and keeps the input open on failure', async () => {
    mocks.createFile.mockRejectedValueOnce(new Error('文件已存在，请使用其他名称'));
    const { container } = await render(<SidebarFileView workDir="/w" />);

    await fireClick(container.querySelector('.new-entry-menu__trigger'));
    await fireClick(menuItem(container, '新建文件'));
    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, 'dup.md');
    await fireClick(container.querySelector('.new-entry-menu__confirm'));

    expect(mocks.createFile).toHaveBeenCalledWith('/w', 'dup.md');
    expect(container.querySelector('.new-entry-menu__error')?.textContent).toContain('文件已存在');
    expect(container.querySelector('.new-entry-menu__input')).toBeTruthy();
    expect(mocks.listTree).toHaveBeenCalledTimes(1);
  });
});
