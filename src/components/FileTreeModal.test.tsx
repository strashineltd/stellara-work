import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTreeModal } from './FileTreeModal';

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
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
    document.body.innerHTML = '';
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

  it('provides the same new entry menu and refreshes the tree after creating a folder', async () => {
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
    expect(container.querySelector('.new-entry-menu__input')).toBeNull();
  });
});
