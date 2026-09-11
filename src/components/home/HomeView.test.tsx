import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ProjectSummary } from '../../../shared/ipc';
import { HomeView } from './HomeView';

const CONFIG: ConfiguredModel = {
  id: 'custom', label: '本地模型', model: 'local', baseUrl: 'http://127.0.0.1',
  hasKey: true, isCustom: true, contextWindow: 128000,
};

const PROJECTS: ProjectSummary[] = [
  { id: 'p1', name: 'Stellara Work', updatedAt: Date.now(), sessionCount: 2 },
];

const BASE_PROPS = {
  config: CONFIG,
  projects: PROJECTS,
  activeProjectId: 'p1' as string | undefined,
  branch: 'main' as string | null,
  input: '',
  busy: false,
  attachments: [],
  hasWorkDir: true,
  approvalMode: 'step' as const,
  onInputChange: vi.fn(),
  onAttachmentsChange: vi.fn(),
  onAddPaths: vi.fn(),
  onPickAttachments: vi.fn(),
  onSend: vi.fn(),
  onSelectProject: vi.fn(),
  onCreateProject: vi.fn(),
  onApprovalModeChange: vi.fn(),
  onSwitchModel: vi.fn(),
  onReconfigure: vi.fn(),
  modelControl: null,
};

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('HomeView', () => {
  beforeEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

  it('shows greeting, four capability cards and composer without account UI', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} />);
    expect(container.textContent).toContain('你想让我们在 Stellara Work 中构建什么?');
    expect(container.textContent).toContain('探索并理解代码');
    expect(container.textContent).toContain('构建新功能、应用或工具');
    expect(container.textContent).toContain('审查代码并提出修改建议');
    expect(container.textContent).toContain('修复问题和失败');
    expect(container.querySelector('textarea')?.getAttribute('placeholder')).toBe('随心输入');
    expect(container.textContent).not.toMatch(/登录|注册|账户|头像|Plus/);
    unmount();
  });

  it('fills the composer when a capability card is clicked', () => {
    const onInputChange = vi.fn();
    const { container, unmount } = render(<HomeView {...BASE_PROPS} onInputChange={onInputChange} />);
    const card = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('探索并理解代码')) ?? null;
    fireClick(card);
    expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining('探索'));
    unmount();
  });

  it('focuses the composer textarea when a capability card is clicked', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} />);
    const card = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('探索并理解代码')) ?? null;
    fireClick(card);
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    unmount();
  });

  it('shows project and branch chips and hides branch when null', () => {
    const first = render(<HomeView {...BASE_PROPS} />);
    expect(first.container.textContent).toContain('Stellara Work');
    expect(first.container.textContent).toContain('main');
    first.unmount();

    const second = render(<HomeView {...BASE_PROPS} branch={null} />);
    expect(second.container.querySelector('.home-composer__branch')).toBeNull();
    second.unmount();
  });

  it('shows the server name on the target chip and hides the project chip in server mode', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} serverTarget={{ name: '本地服务器' }} />);
    expect(container.querySelector('.home-composer__target')?.textContent).toContain('本地服务器');
    expect(container.querySelector('.home-composer__project')).toBeNull();
    unmount();
  });

  it('keeps the local target and project chips when no server target is set', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} serverTarget={null} />);
    expect(container.querySelector('.home-composer__target')?.textContent).toContain('本地');
    expect(container.querySelector('.home-composer__project')).not.toBeNull();
    unmount();
  });

  it('disables the attachment picker and shows the unsupported hint in server mode', () => {
    const { container, unmount } = render(
      <HomeView {...BASE_PROPS} hasWorkDir={false} serverTarget={{ name: '本地服务器' }} />,
    );
    expect(container.querySelector<HTMLButtonElement>('.attach-btn')?.disabled).toBe(true);
    expect(container.textContent).toContain('服务器会话暂不支持附件');
    unmount();
  });

  it('keeps the attachment picker disabled in server mode even with a local work dir', () => {
    const { container, unmount } = render(
      <HomeView {...BASE_PROPS} hasWorkDir serverTarget={{ name: '本地服务器' }} />,
    );
    expect(container.querySelector<HTMLButtonElement>('.attach-btn')?.disabled).toBe(true);
    expect(container.textContent).toContain('服务器会话暂不支持附件');
    unmount();
  });

  it('leaves the attachment picker and hint untouched for a local target', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} serverTarget={null} />);
    expect(container.querySelector<HTMLButtonElement>('.attach-btn')?.disabled).toBe(false);
    expect(container.textContent).not.toContain('服务器会话暂不支持附件');
    unmount();
  });

  it('explains why the attachment picker is disabled without a work dir', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} hasWorkDir={false} serverTarget={null} />);
    expect(container.querySelector<HTMLButtonElement>('.attach-btn')?.disabled).toBe(true);
    expect(container.textContent).toContain('请先选择或创建项目后再添加附件');
    unmount();
  });

  it('sends from the composer', () => {
    const onSend = vi.fn();
    const { container, unmount } = render(<HomeView {...BASE_PROPS} input="完成任务" onSend={onSend} />);
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送"]');
    fireClick(send);
    expect(onSend).toHaveBeenCalled();
    unmount();
  });

  it('opens the project menu listing every project and marking the active one', () => {
    const projects: ProjectSummary[] = [
      ...PROJECTS,
      { id: 'p2', name: '第二个项目', updatedAt: 2, sessionCount: 0 },
    ];
    const { container, unmount } = render(<HomeView {...BASE_PROPS} projects={projects} />);
    fireClick(container.querySelector('.home-composer__project'));
    const items = Array.from(container.querySelectorAll('.home-composer__project-item'));
    expect(items.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Stellara Work'), expect.stringContaining('第二个项目')]),
    );
    expect(container.querySelector('.home-composer__project-item.active')?.textContent).toContain('Stellara Work');
    expect(container.textContent).toContain('新建项目…');
    unmount();
  });

  it('selects a project from the menu', () => {
    const onSelectProject = vi.fn();
    const { container, unmount } = render(
      <HomeView
        {...BASE_PROPS}
        projects={[{ id: 'p2', name: '第二个项目', updatedAt: 2, sessionCount: 0 }]}
        onSelectProject={onSelectProject}
      />,
    );
    fireClick(container.querySelector('.home-composer__project'));
    const item = Array.from(container.querySelectorAll('.home-composer__project-item'))
      .find((el) => el.textContent?.includes('第二个项目')) ?? null;
    fireClick(item);
    expect(onSelectProject).toHaveBeenCalledWith('p2');
    unmount();
  });

  it('opens project creation from the menu with the chip as return focus', () => {
    const onCreateProject = vi.fn();
    const { container, unmount } = render(<HomeView {...BASE_PROPS} onCreateProject={onCreateProject} />);
    const chip = container.querySelector('.home-composer__project');
    fireClick(chip);
    const item = Array.from(container.querySelectorAll('.home-composer__project-item'))
      .find((el) => el.textContent?.includes('新建项目')) ?? null;
    fireClick(item);
    expect(onCreateProject).toHaveBeenCalledWith(chip);
    unmount();
  });

  it('shows only the create action when there are no projects', () => {
    const { container, unmount } = render(<HomeView {...BASE_PROPS} projects={[]} activeProjectId={undefined} />);
    fireClick(container.querySelector('.home-composer__project'));
    const items = container.querySelectorAll('.home-composer__project-item');
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toContain('新建项目…');
    expect(container.querySelector('.home-composer__project-separator')).toBeNull();
    unmount();
  });
});
