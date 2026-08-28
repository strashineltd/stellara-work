import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory } from '../../../shared/ipc';
import { MemoryCard } from './MemoryCard';
import { MemoryDeleteDialog } from './MemoryDeleteDialog';
import { MemoryEditDialog } from './MemoryEditDialog';

const DAY = 24 * 60 * 60 * 1000;

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    scope: 'personal',
    kind: 'fact',
    content: 'Agent 工具白名单（POSIX）：npm/node/git。',
    source: 'manual',
    importance: 0.5,
    confidence: 0.9,
    accessCount: 3,
    createdAt: Date.now() - DAY,
    updatedAt: Date.now() - DAY,
    ...overrides,
  };
}

const LONG_CONTENT = '这是一条很长的记忆内容，'.repeat(9);

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

function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function fireInput(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error('Element not found for input');
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function exactButton(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text,
  );
}

function byLabel(container: HTMLElement, label: string) {
  return container.querySelector(`[aria-label="${label}"]`);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  mountedViews.forEach(({ container, root }) => {
    act(() => root.unmount());
    container.remove();
  });
  mountedViews.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('MemoryCard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps long content and expands to reveal meta row', () => {
    const { container } = render(
      <MemoryCard
        memory={makeMemory({
          content: LONG_CONTENT,
          source: 'session:abc123',
          accessCount: 12,
          updatedAt: Date.now() - DAY + 1000,
        })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    const content = container.querySelector('.memory-card__content');
    expect(content).toBeTruthy();
    expect(content?.className).toContain('memory-card__content--clamped');
    const expand = container.querySelector('.memory-card__expand');
    expect(expand).toBeTruthy();
    expect(expand?.getAttribute('aria-label')).toBe('展开完整内容');
    expect(content?.contains(expand)).toBe(false);
    expect(container.querySelector('.memory-card__meta')).toBeNull();

    fireClick(expand);

    expect(content?.className).not.toContain('memory-card__content--clamped');
    expect(container.querySelector('.memory-card__expand')).toBeNull();
    const meta = container.querySelector('.memory-card__meta');
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toContain('Agent 自动提取');
    expect(meta?.textContent).toContain('使用 12 次');
    expect(meta?.textContent).toContain('创建');
    expect(meta?.textContent).toContain('更新');
  });

  it('keeps short content unclamped without an expand link', () => {
    const { container } = render(
      <MemoryCard memory={makeMemory()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card__content--clamped')).toBeNull();
    expect(container.querySelector('.memory-card__expand')).toBeNull();
    expect(container.querySelector('.memory-card__meta')).toBeNull();
  });

  it('renders the five action buttons with aria-labels', () => {
    const { container } = render(
      <MemoryCard
        memory={makeMemory()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    for (const label of ['置顶', '编辑', '导出 MD', '复制 MD', '删除']) {
      expect(byLabel(container, label)).toBeTruthy();
    }
  });

  it('shows the pin action in its on state for pinned memories', () => {
    const { container } = render(
      <MemoryCard memory={makeMemory({ importance: 0.9 })} onTogglePin={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card')?.className).toContain('memory-card--pinned');
    const star = byLabel(container, '取消置顶');
    expect(star).toBeTruthy();
    expect(star?.className).toContain('on');
  });

  it('fires pin/export/copy/delete handlers with the memory', () => {
    const memory = makeMemory();
    const onTogglePin = vi.fn();
    const onExport = vi.fn();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <MemoryCard
        memory={memory}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onExport={onExport}
        onCopy={onCopy}
        onTogglePin={onTogglePin}
      />,
    );

    fireClick(byLabel(container, '置顶'));
    expect(onTogglePin).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '导出 MD'));
    expect(onExport).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '复制 MD'));
    expect(onCopy).toHaveBeenCalledWith(memory);

    fireClick(byLabel(container, '删除'));
    expect(onDelete).toHaveBeenCalledWith(memory);
  });

  it('shows a copied hint for 1.5s after copy', () => {
    vi.useFakeTimers();
    const { container } = render(
      <MemoryCard
        memory={makeMemory()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
        onCopy={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );
    fireClick(byLabel(container, '复制 MD'));
    expect(byLabel(container, '复制 MD')?.textContent).toContain('已复制');
    act(() => vi.advanceTimersByTime(1600));
    expect(byLabel(container, '复制 MD')?.textContent).not.toContain('已复制');
  });

  it('shows relative time on the card head', () => {
    const threeDaysAgo = Date.now() - 3 * DAY;
    const { container } = render(
      <MemoryCard memory={makeMemory({ updatedAt: threeDaysAgo })} onEdit={vi.fn()} />,
    );
    expect(container.querySelector('.memory-card__time')?.textContent).toContain('3 天前');
  });
});

describe('MemoryEditDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('prefills stars from importance and maps a star click to importance on save', () => {
    const onSave = vi.fn();
    const memory = makeMemory({ content: '已有的记忆内容', importance: 0.6, tags: ['a', 'b'] });
    const { container } = render(
      <MemoryEditDialog memory={memory} onSave={onSave} onClose={vi.fn()} />,
    );
    const stars = Array.from(container.querySelectorAll('.memory-star'));
    expect(stars.length).toBe(5);
    expect(stars.filter((s) => s.classList.contains('on')).length).toBe(3);

    fireClick(stars[3]);

    const saveBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存',
    );
    expect(saveBtn).toBeTruthy();
    fireClick(saveBtn);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: '已有的记忆内容', importance: 0.8, kind: 'fact', scope: 'personal', tags: ['a', 'b'] }),
    );
  });

  it('renders create mode with empty form and 创建 button', () => {
    const onSave = vi.fn();
    const { container } = render(
      <MemoryEditDialog onSave={onSave} onClose={vi.fn()} />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea?.textContent).toBe('');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '创建',
    );
    expect(submit).toBeTruthy();
  });

  it('uses exact dialog semantics and safely focuses a fresh editor', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(
      <MemoryEditDialog onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = container.querySelector('.memory-dialog') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const textarea = dialog.querySelector('textarea');

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('新建记忆');
    expect(backdrop.dataset.motionState).toBe('open');
    expect(dialog.hasAttribute('data-motion-state')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(textarea);
  });

  it('focuses safely when reduced motion mounts directly in the open state', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(
      <MemoryEditDialog
        onSave={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'open', completeExit: vi.fn() }}
      />,
    );

    expect(document.activeElement).toBe(container.querySelector('textarea'));
  });

  it('applies closing Presence props only to the editor backdrop', () => {
    const completeExit = vi.fn();
    const { container } = render(
      <MemoryEditDialog
        memory={makeMemory()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    const dialog = container.querySelector('.memory-dialog') as HTMLElement;

    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.hasAttribute('data-motion-state')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'Escape', 'backdrop', 'close button'] as const)(
    'handles %s once and guards every editor command after closing starts',
    (initialClose) => {
      const onClose = vi.fn();
      const onSave = vi.fn();
      const completeExit = vi.fn();
      const memory = makeMemory({ content: '可保存的内容' });
      const view = render(
        <MemoryEditDialog
          memory={memory}
          onSave={onSave}
          onClose={onClose}
          presence={{ state: 'open', completeExit }}
        />,
      );
      const backdrop = view.container.querySelector('.modal-backdrop') as HTMLElement;

      if (initialClose === 'cancel') {
        fireClick(exactButton(view.container, '取消'));
      } else if (initialClose === 'Escape') {
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      } else if (initialClose === 'backdrop') {
        fireClick(backdrop);
      } else {
        fireClick(byLabel(view.container, '关闭'));
      }
      expect(onClose).toHaveBeenCalledOnce();

      view.rerender(
        <MemoryEditDialog
          memory={memory}
          onSave={onSave}
          onClose={onClose}
          presence={{ state: 'closing', completeExit }}
        />,
      );
      fireClick(exactButton(view.container, '取消'));
      fireClick(byLabel(view.container, '关闭'));
      fireClick(backdrop);
      fireClick(exactButton(view.container, '保存'));
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

      expect(onClose).toHaveBeenCalledOnce();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it('resets from a new memory ID even when the editor remains open', () => {
    const completeExit = vi.fn();
    const first = makeMemory({ id: 'first', content: '第一条', kind: 'preference', tags: ['one'] });
    const second = makeMemory({ id: 'second', content: '第二条', kind: 'meeting', scope: 'workspace', tags: ['two'] });
    const view = render(
      <MemoryEditDialog
        memory={first}
        onSave={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'open', completeExit }}
      />,
    );
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    fireInput(textarea, '本地草稿');

    view.rerender(
      <MemoryEditDialog
        memory={second}
        onSave={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'open', completeExit }}
      />,
    );

    const selects = view.container.querySelectorAll<HTMLSelectElement>('select');
    expect(textarea.value).toBe('第二条');
    expect(selects[0]?.value).toBe('meeting');
    expect(selects[1]?.value).toBe('workspace');
    expect((view.container.querySelector('.memory-dialog__input') as HTMLInputElement).value).toBe('two');
    expect(document.activeElement).toBe(textarea);
  });

  it('generation-guards stale save errors and finally writes across forced close and re-entry', async () => {
    const completeExit = vi.fn();
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    void firstSave.promise.catch(() => {});
    void secondSave.promise.catch(() => {});
    const firstOnSave = vi.fn(() => firstSave.promise);
    const secondOnSave = vi.fn(() => secondSave.promise);
    const first = makeMemory({ id: 'same', content: '旧服务器内容', kind: 'preference' });
    const current = makeMemory({ id: 'same', content: '当前服务器内容', kind: 'decision', scope: 'workspace', tags: ['current'] });
    const view = render(
      <MemoryEditDialog
        memory={first}
        onSave={firstOnSave}
        onClose={vi.fn()}
        presence={{ state: 'entering', completeExit }}
      />,
    );
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement;
    fireClick(exactButton(view.container, '保存'));
    expect(firstOnSave).toHaveBeenCalledOnce();

    view.rerender(
      <MemoryEditDialog
        memory={first}
        onSave={firstOnSave}
        onClose={vi.fn()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    view.rerender(
      <MemoryEditDialog
        memory={current}
        onSave={secondOnSave}
        onClose={vi.fn()}
        presence={{ state: 'entering', completeExit }}
      />,
    );

    const selects = view.container.querySelectorAll<HTMLSelectElement>('select');
    const tags = view.container.querySelector('.memory-dialog__input') as HTMLInputElement;
    expect(textarea.value).toBe('当前服务器内容');
    expect(selects[0]?.value).toBe('decision');
    expect(selects[1]?.value).toBe('workspace');
    expect(tags.value).toBe('current');
    expect(document.activeElement).toBe(textarea);

    fireClick(exactButton(view.container, '保存'));
    const submit = exactButton(view.container, '保存') as HTMLButtonElement;
    expect(secondOnSave).toHaveBeenCalledOnce();
    expect(submit.disabled).toBe(true);

    await act(async () => {
      firstSave.reject(new Error('过期保存失败'));
      await firstSave.promise.catch(() => {});
    });

    expect(view.container.textContent).not.toContain('过期保存失败');
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(textarea.value).toBe('当前服务器内容');
    expect(submit.disabled).toBe(true);

    await act(async () => {
      secondSave.reject(new Error('当前保存失败'));
      await secondSave.promise.catch(() => {});
    });

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('保存失败');
    expect(submit.disabled).toBe(false);
  });
});

describe('MemoryDeleteDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('confirms deletion with a content preview', () => {
    const longContent = '被删除记忆的内容'.repeat(20);
    const memory = makeMemory({ content: longContent });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <MemoryDeleteDialog memory={memory} onConfirm={onConfirm} onClose={onClose} />,
    );
    expect(container.textContent).toContain('删除这条记忆？');
    expect(container.textContent).toContain(longContent.slice(0, 80));

    const del = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '删除',
    );
    fireClick(del);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses exact alertdialog semantics and initially focuses Cancel', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(
      <MemoryDeleteDialog memory={makeMemory()} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(dialog, '取消');

    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('删除记忆');
    expect(backdrop.dataset.motionState).toBe('open');
    expect(dialog.hasAttribute('data-motion-state')).toBe(false);
    expect(document.activeElement).toBe(cancel);
  });

  it('focuses Cancel when reduced motion mounts directly in the open state', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = render(
      <MemoryDeleteDialog
        memory={makeMemory()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'open', completeExit: vi.fn() }}
      />,
    );

    expect(document.activeElement).toBe(exactButton(container, '取消'));
  });

  it('applies closing Presence props only to the delete backdrop', () => {
    const completeExit = vi.fn();
    const { container } = render(
      <MemoryDeleteDialog
        memory={makeMemory()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    const backdrop = container.querySelector('.modal-backdrop') as HTMLElement;
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;

    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.hasAttribute('data-motion-state')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it('refocuses the same Cancel button whenever a retained delete dialog re-enters', () => {
    const completeExit = vi.fn();
    const memory = makeMemory();
    const view = render(
      <MemoryDeleteDialog
        memory={memory}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'entering', completeExit }}
      />,
    );
    const cancel = exactButton(view.container, '取消');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    view.rerender(
      <MemoryDeleteDialog
        memory={memory}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    view.rerender(
      <MemoryDeleteDialog
        memory={memory}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        presence={{ state: 'entering', completeExit }}
      />,
    );

    expect(exactButton(view.container, '取消')).toBe(cancel);
    expect(document.activeElement).toBe(cancel);
  });

  it.each(['cancel', 'Escape', 'backdrop'] as const)(
    'handles %s once and guards every delete command after closing starts',
    (initialClose) => {
      const onClose = vi.fn();
      const onConfirm = vi.fn();
      const completeExit = vi.fn();
      const memory = makeMemory();
      const view = render(
        <MemoryDeleteDialog
          memory={memory}
          onConfirm={onConfirm}
          onClose={onClose}
          presence={{ state: 'open', completeExit }}
        />,
      );
      const backdrop = view.container.querySelector('.modal-backdrop') as HTMLElement;

      if (initialClose === 'cancel') {
        fireClick(exactButton(view.container, '取消'));
      } else if (initialClose === 'Escape') {
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      } else {
        fireClick(backdrop);
      }
      expect(onClose).toHaveBeenCalledOnce();

      view.rerender(
        <MemoryDeleteDialog
          memory={memory}
          onConfirm={onConfirm}
          onClose={onClose}
          presence={{ state: 'closing', completeExit }}
        />,
      );
      fireClick(exactButton(view.container, '取消'));
      fireClick(exactButton(view.container, '删除'));
      fireClick(backdrop);
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

      expect(onClose).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('invokes an in-flight confirmation exactly once before closing', async () => {
    const confirmation = deferred<void>();
    const onConfirm = vi.fn(() => confirmation.promise);
    const completeExit = vi.fn();
    const memory = makeMemory();
    const view = render(
      <MemoryDeleteDialog
        memory={memory}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        presence={{ state: 'open', completeExit }}
      />,
    );
    const confirm = exactButton(view.container, '删除');

    fireClick(confirm);
    fireClick(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();

    view.rerender(
      <MemoryDeleteDialog
        memory={memory}
        onConfirm={onConfirm}
        onClose={vi.fn()}
        presence={{ state: 'closing', completeExit }}
      />,
    );
    fireClick(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();

    await act(async () => {
      confirmation.resolve(undefined);
      await confirmation.promise;
    });
  });

  it('blocks every close path while confirming and permits one retry after rejection', async () => {
    const firstConfirmation = deferred<void>();
    const retryConfirmation = deferred<void>();
    void firstConfirmation.promise.catch(() => {});
    const onConfirm = vi.fn()
      .mockImplementationOnce(() => firstConfirmation.promise)
      .mockImplementationOnce(() => retryConfirmation.promise);
    const onClose = vi.fn();
    const view = render(
      <MemoryDeleteDialog
        memory={makeMemory()}
        onConfirm={onConfirm}
        onClose={onClose}
        presence={{ state: 'open', completeExit: vi.fn() }}
      />,
    );
    const backdrop = view.container.querySelector('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(view.container, '取消') as HTMLButtonElement;
    const confirm = exactButton(view.container, '删除') as HTMLButtonElement;

    fireClick(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(cancel.disabled).toBe(true);
    expect(view.container.querySelector('.confirm-modal')?.getAttribute('aria-busy')).toBe('true');

    cancel.disabled = false;
    confirm.disabled = false;
    fireClick(cancel);
    fireClick(backdrop);
    fireClick(confirm);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledOnce();

    await act(async () => {
      firstConfirmation.reject(new Error('删除失败'));
      await firstConfirmation.promise.catch(() => {});
    });

    expect(view.container.querySelector('.confirm-modal')?.getAttribute('aria-busy')).toBeNull();
    expect(cancel.disabled).toBe(false);
    expect(confirm.disabled).toBe(false);

    fireClick(confirm);
    confirm.disabled = false;
    fireClick(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(2);

    await act(async () => {
      retryConfirmation.resolve(undefined);
      await retryConfirmation.promise;
    });
  });
});
