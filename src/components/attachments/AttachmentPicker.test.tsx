import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { AttachmentPicker } from './AttachmentPicker';
import type { AttachmentMeta } from '../../../shared/ipc';

const IMG_ATT: AttachmentMeta = {
  id: 'shot-1.png', name: 'shot-1.png', size: 2048,
  mimeType: 'image/png', kind: 'image', relPath: 'sess-1/shot-1.png',
};

const FILE_ATT: AttachmentMeta = {
  id: 'notes.txt', name: 'notes.txt', size: 1024,
  mimeType: 'text/plain', kind: 'file', relPath: 'sess-1/notes.txt',
};

interface RenderProps {
  attachments?: AttachmentMeta[];
  onAttachmentsChange?: (next: AttachmentMeta[]) => void;
  onPick?: () => void;
  onAddPaths?: (paths: string[]) => void;
  disabled?: boolean;
}

function render(overrides: RenderProps = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <AttachmentPicker
        attachments={overrides.attachments ?? []}
        onAttachmentsChange={overrides.onAttachmentsChange ?? vi.fn()}
        onPick={overrides.onPick ?? vi.fn()}
        onAddPaths={overrides.onAddPaths ?? vi.fn()}
        disabled={overrides.disabled ?? false}
      />,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => {
        root!.unmount();
      });
      document.body.removeChild(container);
    },
    getByText: (text: string | RegExp) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof text === 'string' ? node.textContent.includes(text) : text.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

describe('AttachmentPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an attachment pick button', () => {
    const { querySelector } = render();
    const btn = querySelector('.attach-btn');
    expect(btn).toBeTruthy();
    expect(btn!.querySelector('.app-icon')).toBeTruthy();
  });

  it('clicking the attachment button invokes onPick', () => {
    const onPick = vi.fn();
    const { querySelector } = render({ onPick });
    const btn = querySelector('.attach-btn') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onPick).toHaveBeenCalledOnce();
  });

  it('renders attachment chips with name and size, and removes on x', () => {
    const onAttachmentsChange = vi.fn();
    const { querySelector, querySelectorAll, getByText } = render({
      attachments: [IMG_ATT, FILE_ATT],
      onAttachmentsChange,
    });
    expect(querySelectorAll('.attach-chip').length).toBe(2);
    expect(getByText('shot-1.png')).not.toBeNull();
    expect(getByText('2.0 KB')).not.toBeNull();
    const remove = querySelector('.attach-chip-remove') as HTMLButtonElement;
    act(() => {
      remove.click();
    });
    expect(onAttachmentsChange).toHaveBeenCalledWith([FILE_ATT]);
  });

  it('shows no chip list when there are no attachments', () => {
    const { querySelectorAll } = render();
    expect(querySelectorAll('.attach-chip').length).toBe(0);
  });

  it('extracts dropped file paths via the path bridge and forwards them', () => {
    const onAddPaths = vi.fn();
    (window as unknown as { electronAPI: { dialog: { getPathForFile: (f: File) => string } } }).electronAPI = {
      dialog: { getPathForFile: (f: File) => `/tmp/${f.name}` },
    };
    const { querySelector } = render({ onAddPaths });
    const picker = querySelector('.attach-picker')!;
    const file = new File(['x'], 'design.png');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    act(() => {
      picker.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      picker.dispatchEvent(drop);
    });
    expect(onAddPaths).toHaveBeenCalledWith(['/tmp/design.png']);
  });

  it('ignores drop events without extractable file paths', () => {
    const onAddPaths = vi.fn();
    const { querySelector } = render({ onAddPaths });
    const picker = querySelector('.attach-picker')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [] } });
    act(() => {
      picker.dispatchEvent(drop);
    });
    expect(onAddPaths).not.toHaveBeenCalled();
  });

  it('disables the pick button when disabled', () => {
    const { querySelector } = render({ disabled: true });
    const btn = querySelector('.attach-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('does not forward dropped paths when disabled', () => {
    const onAddPaths = vi.fn();
    (window as unknown as { electronAPI: { dialog: { getPathForFile: (f: File) => string } } }).electronAPI = {
      dialog: { getPathForFile: (f: File) => `/tmp/${f.name}` },
    };
    const { querySelector } = render({ onAddPaths, disabled: true });
    const picker = querySelector('.attach-picker')!;
    const file = new File(['x'], 'design.png');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    act(() => {
      picker.dispatchEvent(drop);
    });
    expect(onAddPaths).not.toHaveBeenCalled();
  });
});
