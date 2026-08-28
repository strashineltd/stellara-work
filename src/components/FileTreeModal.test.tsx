import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsNode } from '../../shared/ipc';
import { FileTreeModal } from './FileTreeModal';

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (nextUi: React.ReactElement) => {
      act(() => root.render(nextUi));
    },
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function tree(workDir: string, fileName: string): FsNode {
  return {
    name: workDir,
    path: workDir,
    type: 'dir',
    children: [{ name: fileName, path: `${workDir}/${fileName}`, type: 'file', size: 4 }],
  };
}

function fireInput(element: HTMLInputElement | null, value: string) {
  if (!element) throw new Error('Input not found');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('FileTreeModal', () => {
  let mocks: {
    listTree: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    createFile: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks = {
      listTree: vi.fn().mockResolvedValue({ name: 'Workspace', path: 'D:/Workspace', type: 'dir', children: [] }),
      readFile: vi.fn(),
      createFile: vi.fn().mockResolvedValue({ path: 'D:/Workspace/notes.md' }),
      mkdir: vi.fn().mockResolvedValue('D:/Workspace/docs'),
    };
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { fs: mocks },
    });
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('exposes modal dialog semantics and a labelled title', () => {
    const { container } = render(<FileTreeModal workDir="D:/Workspace" onClose={vi.fn()} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('file-tree-title');
    expect(container.querySelector('#file-tree-title')?.textContent).toContain('文件浏览');
  });

  it('closes from the Escape key', () => {
    const onClose = vi.fn();
    render(<FileTreeModal workDir="D:/Workspace" onClose={onClose} />);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses a guarded Presence backdrop while closing', () => {
    const onClose = vi.fn();
    const completeExit = vi.fn();
    const { container } = render(
      <FileTreeModal
        workDir="D:/Workspace"
        onClose={onClose}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;

    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it('provides the same new entry menu and refreshes the tree after creating a folder', async () => {
    mocks.listTree
      .mockReset()
      .mockResolvedValueOnce({ name: 'Workspace', path: 'D:/Workspace', type: 'dir', children: [] })
      .mockResolvedValueOnce(tree('D:/Workspace', 'docs'));
    const { container } = render(<FileTreeModal workDir="D:/Workspace" onClose={vi.fn()} />);
    await act(async () => {});

    const trigger = container.querySelector('.new-entry-menu__trigger');
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('新建文件');
    expect(container.textContent).toContain('新建文件夹');

    const item = Array.from(container.querySelectorAll('.new-entry-menu__item'))
      .find((el) => el.textContent?.includes('新建文件夹'));
    await act(async () => {
      item!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    fireInput(container.querySelector('.new-entry-menu__input') as HTMLInputElement, 'docs');
    await act(async () => {
      container.querySelector('.new-entry-menu__confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mocks.mkdir).toHaveBeenCalledWith('D:/Workspace', 'docs');
    expect(mocks.listTree).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[title="D:/Workspace/docs"]')).not.toBeNull();
    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
  });

  it('isolates the B form and tree from a delayed creation started in A', async () => {
    const createA = deferred<string>();
    const treeB = deferred<FsNode>();
    const staleARefresh = deferred<FsNode>();
    void staleARefresh.promise.catch(() => {});
    let aTreeRequests = 0;
    mocks.mkdir.mockReturnValue(createA.promise);
    mocks.listTree.mockImplementation((workDir: string) => {
      if (workDir === 'A') {
        aTreeRequests += 1;
        return aTreeRequests === 1 ? Promise.resolve(tree('A', 'a.txt')) : staleARefresh.promise;
      }
      return treeB.promise;
    });
    const view = render(<FileTreeModal workDir="A" onClose={vi.fn()} />);
    await act(async () => {});

    await act(async () => {
      view.container.querySelector('.new-entry-menu__trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const folderItem = Array.from(view.container.querySelectorAll('.new-entry-menu__item'))
      .find((item) => item.textContent?.includes('新建文件夹'));
    await act(async () => {
      folderItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    fireInput(view.container.querySelector('.new-entry-menu__input'), 'old-a');
    await act(async () => {
      view.container.querySelector('.new-entry-menu__confirm')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mocks.mkdir).toHaveBeenCalledWith('A', 'old-a');

    view.rerender(<FileTreeModal workDir="B" onClose={vi.fn()} />);
    await act(async () => {});
    expect.soft(view.container.querySelector('.new-entry-menu__input')).toBeNull();

    await act(async () => {
      view.container.querySelector('.new-entry-menu__trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const fileItem = Array.from(view.container.querySelectorAll('.new-entry-menu__item'))
      .find((item) => item.textContent?.includes('新建文件') && !item.textContent?.includes('新建文件夹'));
    await act(async () => {
      fileItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    fireInput(view.container.querySelector('.new-entry-menu__input'), 'b-draft.md');
    expect((view.container.querySelector('.new-entry-menu__input') as HTMLInputElement).value).toBe('b-draft.md');

    await act(async () => createA.resolve('A/old-a'));
    expect.soft(aTreeRequests).toBe(1);
    await act(async () => treeB.resolve(tree('B', 'b.txt')));
    await act(async () => staleARefresh.reject(new Error('stale A refresh failed')));

    expect.soft((view.container.querySelector('.new-entry-menu__input') as HTMLInputElement | null)?.value).toBe('b-draft.md');
    expect.soft(view.container.querySelector('[title="B/b.txt"]')).not.toBeNull();
    expect.soft(view.container.querySelector('[title="A/a.txt"]')).toBeNull();
    expect.soft(view.container.textContent).not.toContain('stale A refresh failed');
  });

  it('resets expansion to the new workDir root', async () => {
    mocks.listTree.mockImplementation((workDir: string) => Promise.resolve(tree(workDir, `${workDir.toLowerCase()}.txt`)));
    const view = render(<FileTreeModal workDir="A" onClose={vi.fn()} />);
    await act(async () => {});

    view.rerender(<FileTreeModal workDir="B" onClose={vi.fn()} />);
    await act(async () => {});

    expect(view.container.querySelector('[title="B/b.txt"]')).not.toBeNull();
  });

  it('ignores a late tree result from the previous workDir', async () => {
    const treeA = deferred<FsNode>();
    const treeB = deferred<FsNode>();
    mocks.listTree.mockImplementation((workDir: string) => workDir === 'A' ? treeA.promise : treeB.promise);
    const view = render(<FileTreeModal workDir="A" onClose={vi.fn()} />);

    view.rerender(<FileTreeModal workDir="B" onClose={vi.fn()} />);
    expect(view.container.textContent).toContain('正在加载文件');

    await act(async () => treeB.resolve(tree('B', 'b.txt')));
    expect(view.container.querySelector('[title="B"]')).not.toBeNull();

    await act(async () => treeA.resolve(tree('A', 'a.txt')));
    expect(view.container.querySelector('[title="A"]')).toBeNull();
    expect(view.container.querySelector('[title="B"]')).not.toBeNull();
  });

  it('clears the selected preview when workDir changes', async () => {
    mocks.listTree.mockImplementation((workDir: string) => Promise.resolve(tree(workDir, `${workDir.toLowerCase()}.txt`)));
    mocks.readFile.mockResolvedValue({ content: 'A preview', size: 9, truncated: false });
    const view = render(<FileTreeModal workDir="A" onClose={vi.fn()} />);
    await act(async () => {});

    await act(async () => {
      view.container.querySelector('[title="A/a.txt"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('A preview');

    view.rerender(<FileTreeModal workDir="B" onClose={vi.fn()} />);
    await act(async () => {});

    expect(view.container.textContent).toContain('点左边的文件预览');
    expect(view.container.textContent).not.toContain('A preview');
  });

  it('ignores a late preview result from the previous workDir', async () => {
    const previewA = deferred<{ content: string; size: number; truncated: boolean }>();
    mocks.listTree.mockImplementation((workDir: string) => Promise.resolve(tree(workDir, `${workDir.toLowerCase()}.txt`)));
    mocks.readFile.mockImplementation(() => previewA.promise);
    const view = render(<FileTreeModal workDir="A" onClose={vi.fn()} />);
    await act(async () => {});

    await act(async () => {
      view.container.querySelector('[title="A/a.txt"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(view.container.textContent).toContain('正在加载预览');

    view.rerender(<FileTreeModal workDir="B" onClose={vi.fn()} />);
    await act(async () => {});
    expect(view.container.querySelector('[title="B"]')).not.toBeNull();

    await act(async () => previewA.resolve({ content: 'stale A preview', size: 15, truncated: false }));
    expect(view.container.textContent).not.toContain('stale A preview');
    expect(view.container.textContent).toContain('点左边的文件预览');
  });
});
