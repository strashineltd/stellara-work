import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memory, MemoryStats } from '../../../shared/ipc';
import { MemoryCenter } from './MemoryCenter';

const DAY = 24 * 60 * 60 * 1000;

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'm1',
    scope: 'personal',
    kind: 'fact',
    content: 'Agent 会自动沉淀任务要点',
    source: 'manual',
    importance: 0.5,
    confidence: 0.9,
    accessCount: 3,
    createdAt: Date.now() - DAY,
    updatedAt: Date.now() - DAY,
    ...overrides,
  };
}

const STATS: MemoryStats = {
  total: 2,
  byScope: { personal: 1, project: 1 },
  byKind: { fact: 2 },
  recentCount: 1,
};

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function stubElectronAPI() {
  const memory = {
    search: vi.fn().mockResolvedValue([] as Memory[]),
    list: vi.fn().mockResolvedValue([] as Memory[]),
    save: vi.fn().mockResolvedValue(makeMemory()),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn().mockResolvedValue(STATS),
    exportSingle: vi.fn().mockResolvedValue({ path: '/tmp/x.md' }),
    exportAll: vi.fn().mockResolvedValue({ path: '/tmp/all.md', count: 2 }),
    copyMd: vi.fn().mockResolvedValue('# md\n'),
    onExtracted: vi.fn().mockReturnValue(() => {}),
  };
  const projects = {
    list: vi
      .fn()
      .mockResolvedValue([{ id: 'p1', name: '桌面端', updatedAt: 0, sessionCount: 1 }]),
  };
  (window as any).electronAPI = { memory, projects };
  return { memory, projects };
}

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

async function renderCenter() {
  const view = render(<MemoryCenter />);
  await flushAsync();
  return view;
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

function fireChange(element: HTMLSelectElement | null, value: string) {
  if (!element) throw new Error('Element not found for change');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function fireTransitionEnd(element: Element | null) {
  if (!element) throw new Error('Element not found for transitionend');
  act(() => element.dispatchEvent(new Event('transitionend', { bubbles: true })));
}

function byLabel(container: HTMLElement, label: string) {
  return container.querySelector(`[aria-label="${label}"]`);
}

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
}

function exactButton(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text,
  );
}

describe('MemoryCenter', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    stubElectronAPI();
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.replaceChildren();
  });

  it('renders the page header with title, create and export-all actions', async () => {
    stubElectronAPI();
    const { container } = await renderCenter();
    expect(container.querySelector('h1')?.textContent).toBe('记忆');
    expect(findButton(container, '新建记忆')).toBeTruthy();
    expect(findButton(container, '导出全部')).toBeTruthy();
  });

  it('groups pinned memories (importance >= 0.8) into 重要记忆 and the rest into 最近记忆', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'p', importance: 0.9, content: '重要内容' }),
      makeMemory({ id: 'n', importance: 0.5, content: '普通内容' }),
    ]);
    const { container } = await renderCenter();
    const sections = Array.from(container.querySelectorAll('.memory-section'));
    expect(sections.length).toBe(2);
    expect(sections[0]?.textContent).toContain('重要记忆');
    expect(sections[0]?.textContent).toContain('重要内容');
    expect(sections[1]?.textContent).toContain('最近记忆');
    expect(sections[1]?.textContent).toContain('普通内容');
  });

  it('filters by scope when a chip is clicked', async () => {
    const stub = stubElectronAPI();
    const { container } = await renderCenter();
    const chip = Array.from(container.querySelectorAll('.memory-chip')).find((c) =>
      c.textContent?.includes('个人'),
    );
    fireClick(chip);
    await flushAsync();
    expect(stub.memory.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: 'personal' }),
    );
    expect(chip?.className).toContain('memory-chip--active');
  });

  it('shows the empty state with a create button when there are no memories', async () => {
    const { container } = await renderCenter();
    const empty = container.querySelector('.memory-empty');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('还没有记忆');
    expect(container.querySelector('.memory-section')).toBeNull();
    const createBtn = Array.from(empty!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('新建记忆'),
    );
    fireClick(createBtn);
    expect(container.querySelector('[role="dialog"][aria-label="新建记忆"]')).toBeTruthy();
  });

  it('calls memory.exportAll when the header export-all button is clicked', async () => {
    const stub = stubElectronAPI();
    const { container } = await renderCenter();
    fireClick(findButton(container, '导出全部'));
    expect(stub.memory.exportAll).toHaveBeenCalledOnce();
  });

  it('deletes exactly once, retains the removed memory through exit, and focuses search', async () => {
    const stub = stubElectronAPI();
    const memory = makeMemory({ content: '删除后仍用于离场预览的记忆' });
    const deletion = deferred<void>();
    stub.memory.list.mockResolvedValueOnce([memory]).mockResolvedValue([]);
    stub.memory.delete.mockImplementation(() => deletion.promise);
    const { container } = await renderCenter();
    const trigger = byLabel(container, '删除') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const confirm = exactButton(dialog, '删除');
    const search = container.querySelector('.memory-center__search-input');

    expect(dialog.textContent).toContain('删除后仍用于离场预览的记忆');
    expect(stub.memory.delete).not.toHaveBeenCalled();

    fireClick(confirm);
    fireClick(confirm);
    expect(stub.memory.delete).toHaveBeenCalledWith('m1');
    expect(stub.memory.delete).toHaveBeenCalledOnce();

    await act(async () => {
      deletion.resolve(undefined);
      await deletion.promise;
    });
    await flushAsync();

    expect(container.querySelector('[aria-label="删除"]')).toBeNull();
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(dialog.textContent).toContain('删除后仍用于离场预览的记忆');
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(search);

    fireClick(confirm);
    fireClick(exactButton(dialog, '取消'));
    fireClick(backdrop);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(stub.memory.delete).toHaveBeenCalledOnce();

    fireTransitionEnd(dialog);
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    fireTransitionEnd(backdrop);
    expect(container.querySelector('.confirm-modal')).toBeNull();
  });

  it('locks deletion through IPC and slow reconciliation before deterministic exit', async () => {
    const stub = stubElectronAPI();
    const memory = makeMemory({ content: '慢速协调期间保留的删除内容' });
    const deletion = deferred<void>();
    const listReload = deferred<Memory[]>();
    const statsReload = deferred<MemoryStats>();
    stub.memory.list
      .mockResolvedValueOnce([memory])
      .mockImplementation(() => listReload.promise);
    stub.memory.stats
      .mockResolvedValueOnce(STATS)
      .mockImplementation(() => statsReload.promise);
    stub.memory.delete.mockImplementation(() => deletion.promise);
    const { container } = await renderCenter();
    const deleteTrigger = byLabel(container, '删除') as HTMLButtonElement;
    const editTrigger = byLabel(container, '编辑') as HTMLButtonElement;
    const createTrigger = findButton(container, '新建记忆') as HTMLButtonElement;
    deleteTrigger.focus();
    fireClick(deleteTrigger);

    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(dialog, '取消') as HTMLButtonElement;
    const confirm = exactButton(dialog, '删除') as HTMLButtonElement;
    const search = container.querySelector('.memory-center__search-input');
    fireClick(confirm);

    cancel.disabled = false;
    confirm.disabled = false;
    fireClick(cancel);
    fireClick(backdrop);
    fireClick(confirm);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    fireClick(editTrigger);
    fireClick(createTrigger);

    expect(stub.memory.delete).toHaveBeenCalledOnce();
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(container.querySelector('.memory-dialog')).toBeNull();
    expect(backdrop.dataset.motionState).not.toBe('closing');

    await act(async () => {
      deletion.resolve(undefined);
      await deletion.promise;
      await Promise.resolve();
    });

    expect(byLabel(container, '删除')).toBeNull();
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(backdrop.dataset.motionState).not.toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(false);
    expect(stub.memory.list).toHaveBeenCalledTimes(2);
    expect(stub.memory.stats).toHaveBeenCalledTimes(2);

    cancel.disabled = false;
    confirm.disabled = false;
    fireClick(cancel);
    fireClick(backdrop);
    fireClick(confirm);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(stub.memory.delete).toHaveBeenCalledOnce();
    expect(backdrop.dataset.motionState).not.toBe('closing');

    await act(async () => {
      listReload.resolve([memory]);
      statsReload.resolve(STATS);
      await Promise.all([listReload.promise, statsReload.promise]);
    });
    await flushAsync();

    expect(byLabel(container, '删除')).toBeNull();
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(search);
  });

  it('keeps one deletion entry open after rejection and permits exactly one retry', async () => {
    const stub = stubElectronAPI();
    const memory = makeMemory({ content: '失败后重试的删除内容' });
    const firstDeletion = deferred<void>();
    const retryDeletion = deferred<void>();
    void firstDeletion.promise.catch(() => {});
    stub.memory.list.mockResolvedValue([memory]);
    stub.memory.delete
      .mockImplementationOnce(() => firstDeletion.promise)
      .mockImplementationOnce(() => retryDeletion.promise);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '删除'));
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(dialog, '取消') as HTMLButtonElement;
    const confirm = exactButton(dialog, '删除') as HTMLButtonElement;
    fireClick(confirm);

    cancel.disabled = false;
    fireClick(cancel);
    fireClick(backdrop);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    await act(async () => {
      firstDeletion.reject(new Error('IPC 删除失败'));
      await firstDeletion.promise.catch(() => {});
    });
    await flushAsync();

    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(dialog.textContent).toContain('失败后重试的删除内容');
    expect(backdrop.dataset.motionState).not.toBe('closing');
    expect(dialog.getAttribute('aria-busy')).toBeNull();
    expect(cancel.disabled).toBe(false);
    expect(confirm.disabled).toBe(false);
    expect(byLabel(container, '删除')).not.toBeNull();
    expect(stub.memory.delete).toHaveBeenCalledOnce();

    fireClick(confirm);
    confirm.disabled = false;
    fireClick(confirm);
    expect(stub.memory.delete).toHaveBeenCalledTimes(2);

    await act(async () => {
      retryDeletion.resolve(undefined);
      await retryDeletion.promise;
    });
    await flushAsync();

    expect(byLabel(container, '删除')).toBeNull();
    expect(backdrop.dataset.motionState).toBe('closing');
  });

  it('keeps the deleted card absent when list and stats reconciliation fail', async () => {
    const stub = stubElectronAPI();
    const memory = makeMemory({ content: '协调失败后仍删除的内容' });
    const listReload = deferred<Memory[]>();
    const statsReload = deferred<MemoryStats>();
    void listReload.promise.catch(() => {});
    void statsReload.promise.catch(() => {});
    stub.memory.list
      .mockResolvedValueOnce([memory])
      .mockImplementation(() => listReload.promise);
    stub.memory.stats
      .mockResolvedValueOnce(STATS)
      .mockImplementation(() => statsReload.promise);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '删除'));
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const search = container.querySelector('.memory-center__search-input');
    fireClick(exactButton(dialog, '删除'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(byLabel(container, '删除')).toBeNull();
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(backdrop.dataset.motionState).not.toBe('closing');

    await act(async () => {
      listReload.reject(new Error('列表刷新失败'));
      statsReload.reject(new Error('统计刷新失败'));
      await Promise.allSettled([listReload.promise, statsReload.promise]);
    });
    await flushAsync();

    expect(byLabel(container, '删除')).toBeNull();
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(stub.memory.delete).toHaveBeenCalledOnce();
  });

  it('cancels deletion through root-only exit and restores the durable card trigger', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ content: '取消时保留的删除载荷' })]);
    const { container } = await renderCenter();
    const trigger = byLabel(container, '删除') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    const dialog = container.querySelector('.confirm-modal') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(dialog, '取消') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);

    fireClick(cancel);

    expect(stub.memory.delete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    expect(dialog.textContent).toContain('取消时保留的删除载荷');
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);

    fireTransitionEnd(dialog);
    expect(container.querySelector('.confirm-modal')).toBe(dialog);
    fireTransitionEnd(backdrop);
    expect(container.querySelector('.confirm-modal')).toBeNull();
  });

  it('restores the create opener on Escape while retaining the editor until root exit', async () => {
    const { container } = await renderCenter();
    const trigger = findButton(container, '新建记忆') as HTMLButtonElement;
    trigger.focus();
    fireClick(trigger);
    const dialog = container.querySelector('.memory-dialog') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('.memory-dialog')).toBe(dialog);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    fireTransitionEnd(dialog);
    expect(container.querySelector('.memory-dialog')).toBe(dialog);
    fireTransitionEnd(backdrop);
    expect(container.querySelector('.memory-dialog')).toBeNull();
  });

  it('blocks editor opens while deletion is logical and permits one editor after delete exit starts', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory()]);
    const { container } = await renderCenter();
    const deleteTrigger = byLabel(container, '删除') as HTMLButtonElement;
    const editTrigger = byLabel(container, '编辑') as HTMLButtonElement;
    deleteTrigger.focus();
    fireClick(deleteTrigger);
    const deleteDialog = container.querySelector('.confirm-modal') as HTMLElement;
    const deleteBackdrop = deleteDialog.closest('.modal-backdrop') as HTMLElement;
    const cancel = exactButton(deleteDialog, '取消');
    expect(document.activeElement).toBe(cancel);

    fireClick(editTrigger);

    expect(container.querySelector('.memory-dialog')).toBeNull();
    expect(container.querySelectorAll('[role="dialog"], [role="alertdialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(cancel);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(deleteTrigger);
    expect(deleteBackdrop.dataset.motionState).toBe('closing');

    editTrigger.focus();
    fireClick(editTrigger);
    const editor = container.querySelector('.memory-dialog') as HTMLElement;
    const editorBackdrop = editor.closest('.modal-backdrop') as HTMLElement;
    expect(container.querySelector('.confirm-modal')).toBe(deleteDialog);
    expect(deleteBackdrop.hasAttribute('inert')).toBe(true);
    expect(editorBackdrop.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(editor.querySelector('textarea'));

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(editTrigger);
    expect(editorBackdrop.dataset.motionState).toBe('closing');
  });

  it('blocks deletion opens while editor is logical and permits one deletion after editor exit starts', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory()]);
    const { container } = await renderCenter();
    const editTrigger = byLabel(container, '编辑') as HTMLButtonElement;
    const deleteTrigger = byLabel(container, '删除') as HTMLButtonElement;
    editTrigger.focus();
    fireClick(editTrigger);
    const editor = container.querySelector('.memory-dialog') as HTMLElement;
    const editorBackdrop = editor.closest('.modal-backdrop') as HTMLElement;
    const textarea = editor.querySelector('textarea');
    expect(document.activeElement).toBe(textarea);

    fireClick(deleteTrigger);

    expect(container.querySelector('.confirm-modal')).toBeNull();
    expect(container.querySelectorAll('[role="dialog"], [role="alertdialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(textarea);

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(editTrigger);
    expect(editorBackdrop.dataset.motionState).toBe('closing');

    deleteTrigger.focus();
    fireClick(deleteTrigger);
    const deleteDialog = container.querySelector('.confirm-modal') as HTMLElement;
    const deleteBackdrop = deleteDialog.closest('.modal-backdrop') as HTMLElement;
    expect(container.querySelector('.memory-dialog')).toBe(editor);
    expect(editorBackdrop.hasAttribute('inert')).toBe(true);
    expect(deleteBackdrop.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(exactButton(deleteDialog, '取消'));

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(deleteTrigger);
    expect(deleteBackdrop.dataset.motionState).toBe('closing');
  });

  it('resets edit-close-create fields on retained reopen and ignores the stale edit save', async () => {
    const stub = stubElectronAPI();
    const memory = makeMemory({
      content: '编辑来源内容',
      kind: 'preference',
      scope: 'workspace',
      importance: 0.8,
      tags: ['old'],
    });
    const update = deferred<void>();
    const create = deferred<Memory>();
    stub.memory.list.mockResolvedValue([memory]);
    stub.memory.update.mockImplementation(() => update.promise);
    stub.memory.save.mockImplementation(() => create.promise);
    const { container } = await renderCenter();
    const editTrigger = byLabel(container, '编辑') as HTMLButtonElement;
    editTrigger.focus();
    fireClick(editTrigger);

    const dialog = container.querySelector('.memory-dialog') as HTMLElement;
    const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
    const textarea = dialog.querySelector('textarea') as HTMLTextAreaElement;
    const selects = dialog.querySelectorAll<HTMLSelectElement>('select');
    const tags = dialog.querySelector('.memory-dialog__input') as HTMLInputElement;
    expect(document.activeElement).toBe(textarea);

    fireInput(textarea, '未完成的编辑保存');
    fireChange(selects[0] ?? null, 'meeting');
    fireChange(selects[1] ?? null, 'project');
    fireClick(dialog.querySelectorAll('.memory-star')[4]);
    fireInput(tags, 'draft, retained');
    fireClick(exactButton(dialog, '保存'));
    expect(stub.memory.update).toHaveBeenCalledWith('m1', {
      content: '未完成的编辑保存',
      importance: 1,
      tags: ['draft', 'retained'],
    });

    fireClick(byLabel(dialog, '关闭'));
    expect(document.activeElement).toBe(editTrigger);
    expect(backdrop.dataset.motionState).toBe('closing');
    expect(textarea.value).toBe('未完成的编辑保存');

    const createTrigger = findButton(container, '新建记忆') as HTMLButtonElement;
    createTrigger.focus();
    fireClick(createTrigger);

    expect(container.querySelector('.memory-dialog')).toBe(dialog);
    expect(dialog.closest('.modal-backdrop')).toBe(backdrop);
    expect(backdrop.dataset.motionState).toBe('entering');
    expect(textarea.value).toBe('');
    expect(selects[0]?.value).toBe('fact');
    expect(selects[1]?.value).toBe('personal');
    expect(Array.from(dialog.querySelectorAll('.memory-star.on'))).toHaveLength(3);
    expect(tags.value).toBe('');
    expect(document.activeElement).toBe(textarea);

    fireTransitionEnd(backdrop);
    expect(container.querySelector('.memory-dialog')).toBe(dialog);

    fireInput(textarea, '新的创建内容');
    const createButton = exactButton(dialog, '创建') as HTMLButtonElement;
    fireClick(createButton);
    expect(stub.memory.save).toHaveBeenCalledOnce();
    expect(createButton.disabled).toBe(true);

    await act(async () => {
      update.resolve(undefined);
      await update.promise;
    });
    await flushAsync();

    expect(container.querySelector('.memory-dialog')).toBe(dialog);
    expect(dialog.getAttribute('aria-label')).toBe('新建记忆');
    expect(textarea.value).toBe('新的创建内容');
    expect(createButton.disabled).toBe(true);

    await act(async () => {
      create.resolve(makeMemory({ id: 'created', content: '新的创建内容' }));
      await create.promise;
    });
    await flushAsync();

    expect(document.activeElement).toBe(createTrigger);
    expect(backdrop.dataset.motionState).toBe('closing');
    fireTransitionEnd(backdrop);
    expect(container.querySelector('.memory-dialog')).toBeNull();
  });

  it.each(['update', 'save'] as const)(
    'keeps the active editor actionable with silent owner semantics after rejected memory.%s',
    async (operation) => {
      const stub = stubElectronAPI();
      const memory = makeMemory({ content: '原始载荷', tags: ['original'] });
      const mutation = deferred<Memory | void>();
      void mutation.promise.catch(() => {});
      stub.memory.list.mockResolvedValue(operation === 'update' ? [memory] : []);
      if (operation === 'update') {
        stub.memory.update.mockImplementation(() => mutation.promise as Promise<void>);
      } else {
        stub.memory.save.mockImplementation(() => mutation.promise as Promise<Memory>);
      }
      const { container } = await renderCenter();
      if (operation === 'update') {
        fireClick(byLabel(container, '编辑'));
      } else {
        fireClick(findButton(container, '新建记忆'));
      }
      const dialog = container.querySelector('.memory-dialog') as HTMLElement;
      const backdrop = dialog.closest('.modal-backdrop') as HTMLElement;
      const textarea = dialog.querySelector('textarea') as HTMLTextAreaElement;
      const tags = dialog.querySelector('.memory-dialog__input') as HTMLInputElement;
      const action = exactButton(dialog, operation === 'update' ? '保存' : '创建') as HTMLButtonElement;
      fireInput(textarea, `${operation} 拒绝后保留的草稿`);
      fireInput(tags, 'draft, retry');
      fireClick(action);
      expect(action.disabled).toBe(true);

      await act(async () => {
        mutation.reject(new Error('持久化失败'));
        await mutation.promise.catch(() => {});
      });
      await flushAsync();

      expect(container.querySelector('.memory-dialog')).toBe(dialog);
      expect(backdrop.dataset.motionState).not.toBe('closing');
      expect(textarea.value).toBe(`${operation} 拒绝后保留的草稿`);
      expect(tags.value).toBe('draft, retry');
      expect(action.disabled).toBe(false);
      expect(dialog.querySelector('[role="alert"]')).toBeNull();
      expect(operation === 'update' ? stub.memory.update : stub.memory.save).toHaveBeenCalledOnce();
    },
  );

  it('opens the create dialog from the header create button', async () => {
    const { container } = await renderCenter();
    fireClick(findButton(container, '新建记忆'));
    expect(container.querySelector('[role="dialog"][aria-label="新建记忆"]')).toBeTruthy();
  });

  it('unpins a pinned memory via updateMemory and reloads', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'p', importance: 0.9 })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '取消置顶'));
    await flushAsync();
    expect(stub.memory.update).toHaveBeenCalledWith('p', { importance: 0.5 });
    expect(stub.memory.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('pins a normal memory via updateMemory to 0.9', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'n', importance: 0.5 })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '置顶'));
    await flushAsync();
    expect(stub.memory.update).toHaveBeenCalledWith('n', { importance: 0.9 });
  });

  it('exports a single memory via exportSingle', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'x' })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '导出 MD'));
    expect(stub.memory.exportSingle).toHaveBeenCalledWith('x');
  });

  it('copies markdown to the clipboard via copyMd', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([makeMemory({ id: 'x' })]);
    const { container } = await renderCenter();
    fireClick(byLabel(container, '复制 MD'));
    await flushAsync();
    expect(stub.memory.copyMd).toHaveBeenCalledWith('x');
    expect((navigator as any).clipboard.writeText).toHaveBeenCalledWith('# md\n');
  });

  it('resolves project names for the card scope label', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'x', scope: 'project', scopeId: 'p1' }),
    ]);
    const { container } = await renderCenter();
    expect(container.querySelector('.memory-card__scope')?.textContent).toContain(
      '项目 · 桌面端',
    );
  });

  it('falls back to 项目 when the project name cannot be resolved', async () => {
    const stub = stubElectronAPI();
    stub.memory.list.mockResolvedValue([
      makeMemory({ id: 'x', scope: 'project', scopeId: 'missing' }),
    ]);
    const { container } = await renderCenter();
    expect(container.querySelector('.memory-card__scope')?.textContent).toBe('项目');
  });

  it('shows scope counts on the chips from stats', async () => {
    const { container } = await renderCenter();
    const allChip = Array.from(container.querySelectorAll('.memory-chip')).find((c) =>
      c.textContent?.startsWith('全部'),
    );
    expect(allChip?.textContent).toContain('2');
  });

  it('marks the memory root with page-enter and page identity', async () => {
    const { container } = await renderCenter();
    const root = container.querySelector('.memory-center') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.dataset.motion).toBe('page-enter');
    expect(root.dataset.page).toBe('memory');
  });

  it('keeps the memory root stable during local updates', async () => {
    const { container } = await renderCenter();
    const root = container.querySelector('.memory-center')!;
    fireInput(container.querySelector('.memory-center__search-input'), '要点');
    await flushAsync();
    expect(container.querySelector('.memory-center')).toBe(root);
  });

  it('offers the 网页 kind filter option', async () => {
    const { container } = await renderCenter();
    const opt = container.querySelector('select') as HTMLSelectElement | null;
    const hasWeb = Array.from(opt?.options ?? []).some((o) => o.value === 'web' && o.textContent === '网页');
    expect(hasWeb).toBe(true);
  });
});
