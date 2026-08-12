import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { ChatStream } from './ChatStream';
import type { DisplayEntry } from '../../lib/chat-utils';
import type { AttachmentMeta } from '../../../shared/ipc';

const IMG_ATT: AttachmentMeta = {
  id: 'shot-1.png', name: 'shot-1.png', size: 2048,
  mimeType: 'image/png', kind: 'image', relPath: 'sess-1/shot-1.png',
};

const FILE_ATT: AttachmentMeta = {
  id: 'notes.txt', name: 'notes.txt', size: 1024,
  mimeType: 'text/plain', kind: 'file', relPath: 'sess-1/notes.txt',
};

function installAttachmentsApi() {
  const readImage = vi.fn();
  const open = vi.fn();
  (window as unknown as { electronAPI: { attachments: { readImage: typeof readImage; open: typeof open } } }).electronAPI = {
    attachments: { readImage, open },
  };
  return { readImage, open };
}

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  const chatRef = { current: container };
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    chatRef,
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

const EMPTY_ENTRIES: DisplayEntry[] = [];

describe('ChatStream', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders without throwing (empty state)', () => {
    expect(() =>
      render(
        <ChatStream
          entries={EMPTY_ENTRIES}
          busy={false}
          streamId={null}
          chatRef={null as any}
          lastUserForRetry={null}
          modelMissing={false}
          onOpenSettings={vi.fn()}
          onRetry={vi.fn()}
          onAbort={vi.fn()}
          onApprove={vi.fn()}
          pendingApproval={null}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name main-chat', () => {
    const { querySelector } = render(
      <ChatStream
        entries={EMPTY_ENTRIES}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    const main = querySelector('.main-chat');
    expect(main).toBeTruthy();
  });

  it('does not use emoji glyphs in rendered HTML (empty state)', () => {
    const { container } = render(
      <ChatStream
        entries={EMPTY_ENTRIES}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('wraps report file paths in hoverable-path when workDir provided', () => {
    const { querySelectorAll } = render(
      <ChatStream
        entries={[{
          kind: 'report',
          summary: '完成',
          files: [{ path: 'src/a.ts', kind: 'edit' }],
          commands: [],
        }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        workDir="/w"
      />,
    );
    expect(querySelectorAll('.report-file-path .hoverable-path').length).toBe(1);
  });

  it('renders report file paths plain without workDir', () => {
    const { querySelectorAll } = render(
      <ChatStream
        entries={[{
          kind: 'report',
          summary: '完成',
          files: [{ path: 'src/a.ts', kind: 'edit' }],
          commands: [],
        }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    expect(querySelectorAll('.report-file-path').length).toBe(1);
    expect(querySelectorAll('.report-file-path .hoverable-path').length).toBe(0);
  });

  it('renders a plan entry with approve buttons when approval pending', () => {
    const onApprovePlan = vi.fn();
    const { getByText, querySelector } = render(
      <ChatStream
        entries={[{ kind: 'plan', steps: [{ description: '写 README', status: 'pending' }] }]}
        busy={true}
        streamId="s1"
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        pendingPlanApproval={{ id: 'plan-1', plan: ['写 README'] }}
        onApprovePlan={onApprovePlan}
        onRejectPlan={vi.fn()}
      />,
    );
    expect(getByText('执行计划')).not.toBeNull();
    expect(querySelector('.plan-actions')).not.toBeNull();
  });

  it('renders user image attachments as thumbnails via attachments:readImage', async () => {
    const { readImage } = installAttachmentsApi();
    readImage.mockResolvedValue({ dataUrl: 'data:image/png;base64,aGk=' });
    const { querySelector, unmount } = render(
      <ChatStream
        entries={[{ kind: 'user', content: '看图', attachments: [IMG_ATT] }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        sessionId="sess-1"
        workDir="/w"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(readImage).toHaveBeenCalledWith('sess-1', '/w', 'shot-1.png');
    const img = querySelector('.attach-thumb-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/png;base64,aGk=');
    unmount();
  });

  it('renders user file attachments as chips and opens via attachments:open', () => {
    const { open } = installAttachmentsApi();
    open.mockResolvedValue(true);
    const { querySelector, getByText, unmount } = render(
      <ChatStream
        entries={[{ kind: 'user', content: '看文件', attachments: [FILE_ATT] }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
        sessionId="sess-1"
        workDir="/w"
      />,
    );
    const chip = querySelector('.attach-chip') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(getByText('notes.txt')).not.toBeNull();
    act(() => {
      chip.click();
    });
    expect(open).toHaveBeenCalledWith('sess-1', '/w', 'notes.txt');
    unmount();
  });

  it('does not request thumbnails when sessionId or workDir is missing', () => {
    const { readImage } = installAttachmentsApi();
    const { unmount } = render(
      <ChatStream
        entries={[{ kind: 'user', content: '看图', attachments: [IMG_ATT] }]}
        busy={false}
        streamId={null}
        chatRef={null as any}
        lastUserForRetry={null}
        modelMissing={false}
        onOpenSettings={vi.fn()}
        onRetry={vi.fn()}
        onAbort={vi.fn()}
        onApprove={vi.fn()}
        pendingApproval={null}
      />,
    );
    expect(readImage).not.toHaveBeenCalled();
    unmount();
  });
});
