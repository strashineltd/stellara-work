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
});
