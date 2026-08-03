import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ProjectSummary, SessionSummary } from '../../shared/ipc';
import { HomeDashboard } from './HomeDashboard';

const CONFIG: ConfiguredModel = {
  id: 'custom', label: '本地模型', model: 'local-model', baseUrl: 'http://127.0.0.1',
  hasKey: true, isCustom: true, workDir: 'D:/Stellara Work', contextWindow: 128000,
};

const PROJECTS: ProjectSummary[] = [
  { id: 'p1', name: '桌面端产品', updatedAt: Date.now(), sessionCount: 2 },
];

const SESSIONS: SessionSummary[] = [
  { id: 's1', title: '重做桌面端界面', modelId: 'local', projectId: 'p1', updatedAt: Date.now(), messageCount: 4 },
];

const BASE_PROPS = {
  config: CONFIG,
  projects: PROJECTS,
  sessions: SESSIONS,
  input: '',
  busy: false,
  onInputChange: vi.fn(),
  onSend: vi.fn(),
  onSelectSession: vi.fn(),
  onOpenProject: vi.fn(),
  onCreateProject: vi.fn(),
  onOpenFiles: vi.fn(),
};

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
    getByText: (text: string) => Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => element.textContent === text) ?? null,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

describe('HomeDashboard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders a local workspace home without account or registration UI', () => {
    const { container } = render(<HomeDashboard section="home" {...BASE_PROPS} />);
    expect(container.textContent).toContain('你好，今天想推进什么？');
    expect(container.textContent).toContain('项目概览');
    expect(container.textContent).toContain('最近工作记录');
    expect(container.textContent).toContain('本地工作区');
    expect(container.textContent).not.toMatch(/登录|注册|账户|头像|个人中心|团队成员/);
  });

  it('fills the task composer from a quick action', () => {
    const onInputChange = vi.fn();
    const { getByText } = render(<HomeDashboard section="home" {...BASE_PROPS} onInputChange={onInputChange} />);
    fireClick(getByText('检查代码问题'));
    expect(onInputChange).toHaveBeenCalledWith(expect.stringContaining('错误、缺陷和潜在风险'));
  });

  it('opens a recent work record', () => {
    const onSelectSession = vi.fn();
    const { getByText } = render(<HomeDashboard section="home" {...BASE_PROPS} onSelectSession={onSelectSession} />);
    fireClick(getByText('重做桌面端界面'));
    expect(onSelectSession).toHaveBeenCalledWith('s1');
  });

  it('renders the project page and creates a project', () => {
    const onCreateProject = vi.fn();
    const { getByText } = render(<HomeDashboard section="projects" {...BASE_PROPS} onCreateProject={onCreateProject} />);
    expect(getByText('项目')).toBeTruthy();
    fireClick(getByText('新建项目'));
    expect(onCreateProject).toHaveBeenCalledOnce();
  });
});
