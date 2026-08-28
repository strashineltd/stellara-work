import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, Project, ProjectSummary } from '../../shared/ipc';
import { ProjectDialog } from './ProjectDialog';

const PROJECT: ProjectSummary = {
  id: 'project-1',
  name: '桌面端产品',
  workDir: 'D:\\Stellara Work',
  entryFile: 'D:\\Stellara Work\\README.md',
  updatedAt: Date.now(),
  sessionCount: 2,
};

const SECOND_PROJECT: ProjectSummary = {
  id: 'project-2',
  name: '移动端产品',
  workDir: 'D:\\Mobile Work',
  entryFile: 'D:\\Mobile Work\\README.md',
  updatedAt: Date.now(),
  sessionCount: 1,
};

const FILE_PICK = { workDir: 'D:\\Stellara Work', entryFile: 'D:\\Stellara Work\\README.md' };
const DIR_PICK = { workDir: 'D:/workspace/folder-project', entryFile: 'D:/workspace/folder-project/README.md' };

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mountedViews = new Set<MountedView>();

function installApi(overrides?: Partial<ElectronAPI['dialog']>) {
  const selectProjectDir = vi.fn().mockResolvedValue(DIR_PICK);
  const createFile = vi.fn().mockResolvedValue({ path: 'D:\\Stellara Work\\notes.md' });
  const openPath = vi.fn().mockResolvedValue(true);
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      dialog: {
        openDirectory: vi.fn(),
        openFile: vi.fn(),
        openAttachmentFiles: vi.fn(),
        selectProjectDir,
        ...overrides,
      },
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn(),
        openPath,
        createFile,
      },
    } as unknown as ElectronAPI,
  });
  return { selectProjectDir, createFile, openPath };
}

function renderDialog(props?: Partial<React.ComponentProps<typeof ProjectDialog>>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const onRename = props?.onRename ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props?.onClose ?? vi.fn();
  let currentProps: React.ComponentProps<typeof ProjectDialog> = {
    project: PROJECT,
    workDir: PROJECT.workDir,
    onRename,
    onClose,
    ...props,
  };
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);

  function render(nextProps: React.ComponentProps<typeof ProjectDialog>) {
    act(() => {
      root.render(<ProjectDialog {...nextProps} />);
    });
  }

  render(currentProps);
  return {
    container,
    onRename,
    onClose,
    rerender: (nextProps: Partial<React.ComponentProps<typeof ProjectDialog>>) => {
      currentProps = { ...currentProps, ...nextProps };
      render(currentProps);
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

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function fireInput(element: HTMLInputElement | null, value: string) {
  if (!element) throw new Error('Input not found');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button'));
  const exact = buttons.find((button) => button.querySelector('strong')?.textContent === text);
  if (exact) return exact;
  return buttons.find((button) => button.textContent?.includes(text)) ?? null;
}

describe('ProjectDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    document.body.replaceChildren();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
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
    Reflect.deleteProperty(window, 'electronAPI');
    document.body.replaceChildren();
  });

  it('renders a compact accessible project window with a single entry picker', () => {
    installApi();
    const { container } = renderDialog();
    const dialog = container.querySelector('[role="dialog"]');
    const name = container.querySelector('#project-dialog-name') as HTMLInputElement;
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(name.value).toBe('桌面端产品');
    expect(buttonByText(container, '选择文件夹或文件')).toBeTruthy();
    expect(buttonByText(container, '新建文件')).toBeNull();
    expect(container.textContent).toContain('可同时选择文件夹或文件');
  });

  it('renders creation setup before a project exists', () => {
    installApi();
    const onCreate = vi.fn();
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    const name = container.querySelector('#project-dialog-name') as HTMLInputElement;
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe('project-dialog-title');
    expect(container.textContent).toContain('创建项目');
    expect(container.textContent).toContain('项目入口文件（可选）');
    expect(name.value).toBe('');
    expect(name.required).toBe(true);
    expect(container.textContent).toContain('必填');
    expect(buttonByText(container, '创建项目')?.disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('cancels creation without creating a placeholder project', () => {
    installApi();
    const onCreate = vi.fn();
    const onClose = vi.fn();
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate, onClose });
    fireInput(container.querySelector('#project-dialog-name'), '尚未创建');
    fireClick(buttonByText(container, '取消'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates the project only after the final create action', async () => {
    const selectProjectDir = vi.fn().mockResolvedValue(FILE_PICK);
    installApi({ selectProjectDir });
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    fireInput(container.querySelector('#project-dialog-name'), '桌面工具');
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(selectProjectDir).toHaveBeenCalledOnce();
    expect(onCreate).not.toHaveBeenCalled();
    await act(async () => {
      fireClick(buttonByText(container, '创建项目'));
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith('桌面工具', {
      workDir: 'D:\\Stellara Work',
      entryFile: 'D:\\Stellara Work\\README.md',
    });
  });

  it('keeps the entered name visible when project creation fails', async () => {
    installApi();
    const onCreate = vi.fn().mockRejectedValue(new Error('数据库被占用'));
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    const name = container.querySelector('#project-dialog-name') as HTMLInputElement;
    fireInput(name, '桌面工具');
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    await act(async () => {
      fireClick(buttonByText(container, '创建项目'));
      await Promise.resolve();
    });
    expect(name.value).toBe('桌面工具');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('项目创建失败：数据库被占用');
  });

  it('saves the edited project name without closing the window', async () => {
    installApi();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ onRename });
    fireInput(container.querySelector('#project-dialog-name'), '桌面工具');
    await act(async () => {
      fireClick(buttonByText(container, '保存名称'));
      await Promise.resolve();
    });
    expect(onRename).toHaveBeenCalledWith('project-1', '桌面工具');
    expect(container.textContent).toContain('项目名称已保存');
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('ignores an earlier rename completion and keeps the current project rename busy', async () => {
    installApi();
    const firstRename = deferred<void>();
    const secondRename = deferred<void>();
    const onRename = vi.fn((id: string) => id === PROJECT.id ? firstRename.promise : secondRename.promise);
    const completeExit = vi.fn();
    const view = renderDialog({
      onRename,
      presence: { state: 'entering', completeExit },
    });
    const name = view.container.querySelector('#project-dialog-name') as HTMLInputElement;

    fireInput(name, '桌面端重命名');
    fireClick(buttonByText(view.container, '保存名称'));
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: SECOND_PROJECT,
      workDir: SECOND_PROJECT.workDir,
      presence: { state: 'entering', completeExit },
    });
    fireInput(name, '移动端重命名');
    fireClick(buttonByText(view.container, '保存名称'));

    await act(async () => {
      firstRename.resolve(undefined);
      await firstRename.promise;
    });

    expect(name.value).toBe('移动端重命名');
    expect(buttonByText(view.container, '保存中…')?.disabled).toBe(true);
    expect(view.container.textContent).not.toContain('项目名称已保存');

    await act(async () => {
      secondRename.resolve(undefined);
      await secondRename.promise;
    });
    expect(view.container.textContent).toContain('项目名称已保存');
  });

  it('ignores a rename error from a project entry that has already closed', async () => {
    installApi();
    const rename = deferred<void>();
    const completeExit = vi.fn();
    const view = renderDialog({
      onRename: vi.fn(() => rename.promise),
      presence: { state: 'entering', completeExit },
    });

    fireInput(view.container.querySelector('#project-dialog-name'), '旧项目名称');
    fireClick(buttonByText(view.container, '保存名称'));
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: SECOND_PROJECT,
      workDir: SECOND_PROJECT.workDir,
      presence: { state: 'entering', completeExit },
    });

    await act(async () => {
      rename.reject(new Error('旧项目失败'));
      await Promise.resolve();
    });

    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).not.toContain('旧项目失败');
  });

  it('selects a file through the unified picker and opens its folder', async () => {
    const selectProjectDir = vi.fn().mockResolvedValue(FILE_PICK);
    const api = installApi({ selectProjectDir });
    const { container } = renderDialog();
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(selectProjectDir).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Stellara Work');
    await act(async () => {
      fireClick(buttonByText(container, '打开文件夹'));
      await Promise.resolve();
    });
    expect(api.openPath).toHaveBeenCalledWith('D:\\Stellara Work', 'D:\\Stellara Work');
  });

  it('persists a picked entry file for existing projects', async () => {
    installApi({ selectProjectDir: vi.fn().mockResolvedValue(FILE_PICK) });
    const onUpdateFile = vi.fn().mockResolvedValue(PROJECT);
    const { container } = renderDialog({ onUpdateFile });
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(onUpdateFile).toHaveBeenCalledOnce();
    expect(onUpdateFile).toHaveBeenCalledWith('project-1', {
      path: 'D:\\Stellara Work\\README.md',
      workDir: 'D:\\Stellara Work',
    });
  });

  it('lets an already-started file update finish without writing into the next project entry', async () => {
    const picked = { workDir: 'D:/old-project', entryFile: 'D:/old-project/index.ts' };
    installApi({ selectProjectDir: vi.fn().mockResolvedValue(picked) });
    const update = deferred<Project>();
    const onUpdateFile = vi.fn(() => update.promise);
    const completeExit = vi.fn();
    const view = renderDialog({
      onUpdateFile,
      presence: { state: 'entering', completeExit },
    });

    await act(async () => {
      fireClick(buttonByText(view.container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(onUpdateFile).toHaveBeenCalledWith(PROJECT.id, {
      path: picked.entryFile,
      workDir: picked.workDir,
    });

    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: SECOND_PROJECT,
      workDir: SECOND_PROJECT.workDir,
      presence: { state: 'entering', completeExit },
    });
    await act(async () => {
      update.resolve({
        id: PROJECT.id,
        name: PROJECT.name,
        workDir: picked.workDir,
        entryFile: picked.entryFile,
        createdAt: PROJECT.updatedAt,
        updatedAt: PROJECT.updatedAt,
      });
      await update.promise;
    });

    expect(view.container.querySelector('.project-dialog-section-heading code')?.getAttribute('title')).toBe(SECOND_PROJECT.workDir);
    expect(view.container.textContent).not.toContain('已选择 index.ts');
  });

  it('ignores an old open-folder completion without clearing the current picker busy state', async () => {
    const picker = deferred<typeof DIR_PICK>();
    const api = installApi({ selectProjectDir: vi.fn(() => picker.promise) });
    const open = deferred<boolean>();
    api.openPath.mockImplementation(() => open.promise);
    const completeExit = vi.fn();
    const view = renderDialog({ presence: { state: 'entering', completeExit } });

    fireClick(buttonByText(view.container, '打开文件夹'));
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: SECOND_PROJECT,
      workDir: SECOND_PROJECT.workDir,
      presence: { state: 'entering', completeExit },
    });
    fireClick(buttonByText(view.container, '选择文件夹或文件'));

    await act(async () => {
      open.resolve(true);
      await open.promise;
    });

    expect(buttonByText(view.container, '正在选择…')?.disabled).toBe(true);
    expect(view.container.textContent).not.toContain('已打开项目文件夹');

    await act(async () => {
      picker.resolve(DIR_PICK);
      await picker.promise;
    });
  });

  it('announces picker errors and closes with Escape', async () => {
    installApi({ selectProjectDir: vi.fn().mockRejectedValue(new Error('无法访问')) });
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('无法访问');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('selects a folder through the unified picker and auto-fills README', async () => {
    const api = installApi();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    fireInput(container.querySelector('#project-dialog-name'), '文件夹项目');
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(api.selectProjectDir).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('folder-project');
    await act(async () => {
      fireClick(buttonByText(container, '创建项目'));
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith('文件夹项目', {
      workDir: 'D:/workspace/folder-project',
      entryFile: 'D:/workspace/folder-project/README.md',
    });
  });

  it('allows creating a project without an entry file', async () => {
    const selectProjectDir = vi.fn().mockResolvedValue({ workDir: 'D:/workspace/folder-project' });
    installApi({ selectProjectDir });
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    fireInput(container.querySelector('#project-dialog-name'), '纯文件夹');
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(selectProjectDir).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('README.md');
    expect(buttonByText(container, '创建项目')?.disabled).toBe(false);
    await act(async () => {
      fireClick(buttonByText(container, '创建项目'));
      await Promise.resolve();
    });
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith('纯文件夹', {
      workDir: 'D:/workspace/folder-project',
      entryFile: undefined,
    });
  });

  it('shows the open-folder button next to the entry picker, disabled until a folder is chosen', async () => {
    const api = installApi();
    const { container } = renderDialog({ mode: 'create', project: undefined, workDir: '' });
    const openBtn = buttonByText(container, '打开文件夹') as HTMLButtonElement | null;
    expect(openBtn).toBeTruthy();
    expect(openBtn?.disabled).toBe(true);

    api.selectProjectDir.mockResolvedValue({ workDir: 'D:/workspace/folder-project', entryFile: 'README.md' });
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    const openBtn2 = buttonByText(container, '打开文件夹') as HTMLButtonElement | null;
    expect(openBtn2?.disabled).toBe(false);
    await act(async () => {
      fireClick(openBtn2!);
      await Promise.resolve();
    });
    expect(api.openPath).toHaveBeenCalledWith('D:/workspace/folder-project', 'D:/workspace/folder-project');
  });

  it('applies closing presence only to the backdrop root', () => {
    installApi();
    const completeExit = vi.fn();
    const { container } = renderDialog({
      presence: { state: 'closing', completeExit },
    });
    const backdrop = container.querySelector('.project-dialog-backdrop') as HTMLElement;
    const dialog = container.querySelector('.project-dialog') as HTMLElement;

    expect(backdrop.dataset.motionState).toBe('closing');
    expect(backdrop.hasAttribute('inert')).toBe(true);
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.hasAttribute('data-motion-state')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);

    act(() => backdrop.dispatchEvent(new Event('transitionend', { bubbles: true })));
    expect(completeExit).toHaveBeenCalledOnce();
  });

  it.each(['Escape', 'backdrop', 'close button'] as const)(
    'handles %s once and ignores every close path after closing starts',
    (initialClose) => {
      installApi();
      const onClose = vi.fn();
      const completeExit = vi.fn();
      const view = renderDialog({
        onClose,
        presence: { state: 'open', completeExit },
      });
      const backdrop = view.container.querySelector('.project-dialog-backdrop') as HTMLElement;
      const closeButton = view.container.querySelector('[aria-label="关闭项目窗口"]') as HTMLButtonElement;

      if (initialClose === 'Escape') {
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      } else if (initialClose === 'backdrop') {
        fireClick(backdrop);
      } else {
        fireClick(closeButton);
      }
      expect(onClose).toHaveBeenCalledOnce();

      view.rerender({ presence: { state: 'closing', completeExit } });
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      fireClick(backdrop);
      fireClick(closeButton);
      fireClick(buttonByText(view.container, '完成'));

      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores every close path while a project mutation is busy', async () => {
    installApi();
    const rename = deferred<void>();
    const onClose = vi.fn();
    const view = renderDialog({
      onRename: vi.fn(() => rename.promise),
      onClose,
      presence: { state: 'open', completeExit: vi.fn() },
    });
    const backdrop = view.container.querySelector('.project-dialog-backdrop') as HTMLElement;

    fireInput(view.container.querySelector('#project-dialog-name'), '处理中名称');
    fireClick(buttonByText(view.container, '保存名称'));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    fireClick(backdrop);
    fireClick(view.container.querySelector('[aria-label="关闭项目窗口"]'));
    fireClick(buttonByText(view.container, '完成'));

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      rename.resolve(undefined);
      await rename.promise;
    });
  });

  it('waits for entry reset to enable the retained name input before focusing it', async () => {
    installApi();
    const rename = deferred<void>();
    const completeExit = vi.fn();
    const view = renderDialog({
      onRename: vi.fn(() => rename.promise),
      presence: { state: 'entering', completeExit },
    });
    const name = view.container.querySelector('#project-dialog-name') as HTMLInputElement;
    fireInput(name, '处理中名称');
    fireClick(buttonByText(view.container, '保存名称'));
    expect(name.disabled).toBe(true);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: SECOND_PROJECT,
      workDir: SECOND_PROJECT.workDir,
      presence: { state: 'entering', completeExit },
    });

    expect(name.disabled).toBe(false);
    expect(document.activeElement).toBe(name);

    await act(async () => {
      rename.resolve(undefined);
      await rename.promise;
    });
  });

  it('does not refocus when an unchanged entry settles from entering to open', () => {
    installApi();
    const completeExit = vi.fn();
    const view = renderDialog({ presence: { state: 'entering', completeExit } });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    view.rerender({ presence: { state: 'open', completeExit } });

    expect(document.activeElement).toBe(outside);
  });

  it('does not schedule stale error focus after unmount', async () => {
    installApi();
    const rename = deferred<void>();
    const view = renderDialog({ onRename: vi.fn(() => rename.promise) });
    fireInput(view.container.querySelector('#project-dialog-name'), '卸载中的名称');
    fireClick(buttonByText(view.container, '保存名称'));
    view.unmount();

    await act(async () => {
      rename.reject(new Error('卸载后失败'));
      await Promise.resolve();
    });

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('resets every create default and refocuses the retained name field on rapid reopen', async () => {
    installApi();
    const completeExit = vi.fn();
    const view = renderDialog({
      mode: 'create',
      project: undefined,
      workDir: 'D:/create-default',
      presence: { state: 'entering', completeExit },
    });
    const name = view.container.querySelector('#project-dialog-name') as HTMLInputElement;

    fireInput(name, '未提交名称');
    await act(async () => {
      fireClick(buttonByText(view.container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(view.container.textContent).toContain('已选择 README.md');
    expect(view.container.querySelector('code[title="D:/workspace/folder-project"]')).toBeTruthy();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({ presence: { state: 'entering', completeExit } });

    expect(view.container.querySelector('#project-dialog-name')).toBe(name);
    expect(name.value).toBe('');
    expect(view.container.querySelector('code[title="D:/create-default"]')).toBeTruthy();
    expect(view.container.textContent).not.toContain('已选择 README.md');
    expect(document.activeElement).toBe(name);
  });

  it('resets edit state from current project props and refocuses on rapid reopen', async () => {
    installApi();
    const completeExit = vi.fn();
    const onUpdateFile = vi.fn().mockResolvedValue(PROJECT);
    const view = renderDialog({
      onUpdateFile,
      presence: { state: 'entering', completeExit },
    });
    const name = view.container.querySelector('#project-dialog-name') as HTMLInputElement;

    fireInput(name, '本地未保存名称');
    await act(async () => {
      fireClick(buttonByText(view.container, '选择文件夹或文件'));
      await Promise.resolve();
    });
    expect(view.container.textContent).toContain('已选择 README.md');
    expect(view.container.querySelector('code[title="D:/workspace/folder-project"]')).toBeTruthy();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    view.rerender({ presence: { state: 'closing', completeExit } });
    view.rerender({
      project: { ...PROJECT, name: '服务器同步名称' },
      presence: { state: 'entering', completeExit },
    });

    expect(view.container.querySelector('#project-dialog-name')).toBe(name);
    expect(name.value).toBe('服务器同步名称');
    expect(view.container.querySelector('.project-dialog-section-heading code')?.getAttribute('title')).toBe(PROJECT.workDir);
    expect(view.container.textContent).not.toContain('已选择 README.md');
    expect(document.activeElement).toBe(name);
  });

  it('focuses the name field when reduced motion mounts directly in the open state', () => {
    installApi();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { container } = renderDialog({
      presence: { state: 'open', completeExit: vi.fn() },
    });

    expect(document.activeElement).toBe(container.querySelector('#project-dialog-name'));
  });
});
