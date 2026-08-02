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

describe('FileTreeModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        fs: {
          listTree: vi.fn().mockResolvedValue({ name: 'Workspace', path: 'D:/Workspace', type: 'dir', children: [] }),
          readFile: vi.fn(),
        },
      },
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
});
