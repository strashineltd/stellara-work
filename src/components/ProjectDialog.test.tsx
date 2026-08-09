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

function installApi(overrides?: Partial<ElectronAPI['dialog']>) {
  const openFile = vi.fn().mockResolvedValue('D:\\Stellara Work\\README.md');
  const selectProjectFile = vi.fn().mockResolvedValue({ path: 'D:\\Stellara Work\\README.md', workDir: 'D:\\Stellara Work' });
  const createProjectFile = vi.fn().mockResolvedValue({ path: 'D:\\Stellara Work\\notes.md', workDir: 'D:\\Stellara Work' });
  const selectProjectDir = vi.fn().mockResolvedValue({ workDir: 'D:/workspace/folder-project', entryFile: 'D:/workspace/folder-project/README.md' });
  const createFile = vi.fn().mockResolvedValue({ path: 'D:\\Stellara Work\\notes.md' });
  const openPath = vi.fn().mockResolvedValue(true);
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      dialog: { openFile, openDirectory: vi.fn(), selectProjectFile, createProjectFile, selectProjectDir, ...overrides },
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn(),
        openPath,
        createFile,
      },
    } as unknown as ElectronAPI,
  });
  return { openFile, selectProjectFile, createProjectFile, selectProjectDir, createFile, openPath };
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

  it('renders a compact accessible project window with the name field first', () => {
    installApi();
    const { container } = renderDialog();
    const dialog = container.querySelector('[role="dialog"]');
    const name = container.querySelector('#project-dialog-name') as HTMLInputElement;
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(name.value).toBe('桌面端产品');
    expect(buttonByText(container, '选择文件')).toBeTruthy();
    expect(buttonByText(container, '新建文件')).toBeTruthy();
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
    const api = installApi();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    fireInput(container.querySelector('#project-dialog-name'), '桌面工具');
    await act(async () => {
      fireClick(buttonByText(container, '选择文件'));
      await Promise.resolve();
    });
    expect(api.selectProjectFile).toHaveBeenCalledOnce();
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
      fireClick(buttonByText(container, '选择文件'));
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

  it('selects and explicitly opens an existing file', async () => {
    const api = installApi();
    const { container } = renderDialog();
    await act(async () => {
      fireClick(buttonByText(container, '选择文件'));
      await Promise.resolve();
    });
    expect(api.selectProjectFile).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Stellara Work');
    await act(async () => {
      fireClick(buttonByText(container, '打开文件夹'));
      await Promise.resolve();
    });
    expect(api.openPath).toHaveBeenCalledWith('D:\\Stellara Work', 'D:\\Stellara Work');
  });

  it('creates a new file through the native save flow', async () => {
    const api = installApi();
    const { container } = renderDialog();
    await act(async () => {
      fireClick(buttonByText(container, '新建文件'));
      await Promise.resolve();
    });
    expect(api.createProjectFile).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('已新建 notes.md');
  });

  it('announces file errors and closes with Escape', async () => {
    installApi({ createProjectFile: vi.fn().mockRejectedValue(new Error('文件已存在')) });
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });
    await act(async () => {
      fireClick(buttonByText(container, '新建文件'));
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('文件已存在');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('selects a folder as the project workspace and auto-fills README', async () => {
    const api = installApi();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = renderDialog({ mode: 'create', project: undefined, onCreate });
    fireInput(container.querySelector('#project-dialog-name'), '文件夹项目');
    expect(buttonByText(container, '选择文件夹')).toBeTruthy();
    await act(async () => {
      fireClick(buttonByText(container, '选择文件夹'));
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
      fireClick(buttonByText(container, '选择文件夹'));
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
});
