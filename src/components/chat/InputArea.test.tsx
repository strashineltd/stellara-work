import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { InputArea } from './InputArea';
import type { SlashState } from './InputArea';
import type { AttachmentMeta } from '../../../shared/ipc';

const EMPTY_SLASH: SlashState = {
  slashOpen: false,
  slashItems: [],
  slashIdx: 0,
  skillsLoaded: false,
};

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
  onPickAttachments?: () => void;
  onAddAttachmentPaths?: (paths: string[]) => void;
  onSlashOpen?: () => void;
  onLazyLoadSkills?: () => void;
}

function render(overrides: RenderProps = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <InputArea
        input=""
        busy={false}
        planMode={false}
        slash={EMPTY_SLASH}
        hasWorkDir={true}
        onInputChange={vi.fn()}
        onPlanToggle={vi.fn()}
        onSend={vi.fn()}
        onSlashApply={vi.fn()}
        onSlashOpen={overrides.onSlashOpen ?? vi.fn()}
        onSlashClose={vi.fn()}
        onSlashIdxChange={vi.fn()}
        onLazyLoadSkills={overrides.onLazyLoadSkills ?? vi.fn()}
        attachments={overrides.attachments ?? []}
        onAttachmentsChange={overrides.onAttachmentsChange ?? vi.fn()}
        onPickAttachments={overrides.onPickAttachments ?? vi.fn()}
        onAddAttachmentPaths={overrides.onAddAttachmentPaths ?? vi.fn()}
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
      const pattern = typeof text === 'string' ? text : text;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof pattern === 'string' ? node.textContent.includes(pattern) : pattern.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

describe('InputArea', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders without throwing', () => {
    expect(() => render()).not.toThrow();
  });

  it('uses token-driven class name main-input', () => {
    const { querySelector } = render();
    const footer = querySelector('.main-input');
    expect(footer).toBeTruthy();
  });

  it('does not use emoji glyphs in rendered HTML', () => {
    const { container } = render();
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('opens skill suggestions when the user types a slash command', () => {
    const onSlashOpen = vi.fn();
    const onLazyLoadSkills = vi.fn();
    const { querySelector } = render({ onSlashOpen, onLazyLoadSkills });
    const textarea = querySelector('.input-chat') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, '/');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onSlashOpen).toHaveBeenCalledOnce();
    expect(onLazyLoadSkills).toHaveBeenCalledOnce();
  });

  it('renders an attachment pick button', () => {
    const { querySelector } = render();
    const btn = querySelector('.attach-btn');
    expect(btn).toBeTruthy();
    expect(btn!.querySelector('.app-icon')).toBeTruthy();
  });

  it('clicking the attachment button invokes onPickAttachments', () => {
    const onPickAttachments = vi.fn();
    const { querySelector } = render({ onPickAttachments });
    const btn = querySelector('.attach-btn') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onPickAttachments).toHaveBeenCalledOnce();
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
    const onAddAttachmentPaths = vi.fn();
    (window as unknown as { electronAPI: { dialog: { getPathForFile: (f: File) => string } } }).electronAPI = {
      dialog: { getPathForFile: (f: File) => `/tmp/${f.name}` },
    };
    const { querySelector } = render({ onAddAttachmentPaths });
    const footer = querySelector('.main-input')!;
    const file = new File(['x'], 'design.png');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    act(() => {
      footer.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
      footer.dispatchEvent(drop);
    });
    expect(onAddAttachmentPaths).toHaveBeenCalledWith(['/tmp/design.png']);
  });

  it('ignores drop events without extractable file paths', () => {
    const onAddAttachmentPaths = vi.fn();
    const { querySelector } = render({ onAddAttachmentPaths });
    const footer = querySelector('.main-input')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [] } });
    act(() => {
      footer.dispatchEvent(drop);
    });
    expect(onAddAttachmentPaths).not.toHaveBeenCalled();
  });
});
