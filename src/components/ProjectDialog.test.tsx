import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, ProjectSummary } from '../../shared/ipc';
import { ProjectDialog } from './ProjectDialog';

const PROJECT: ProjectSummary = {
  id: 'project-1',
  name: '桌面端产品',
  workDir: 'D:\\Stellara Work',
  entryFile: 'D:\\Stellara Work\\README.md',
  updatedAt: Date.now(),
  sessionCount: 2,
};

const FILE_PICK = { workDir: 'D:\\Stellara Work', entryFile: 'D:\\Stellara Work\\README.md' };
const DIR_PICK = { workDir: 'D:/workspace/folder-project', entryFile: 'D:/workspace/folder-project/README.md' };

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
  let root: Root;
  const onRename = props?.onRename ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props?.onClose ?? vi.fn();
  act(() => {
    root = createRoot(container);
    root.render(
      <ProjectDialog
        project={PROJECT}
        workDir={PROJECT.workDir}
        onRename={onRename}
        onClose={onClose}
        {...props}
      />,
    );
  });
  return { container, onRename, onClose, unmount: () => act(() => root!.unmount()) };
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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
});
