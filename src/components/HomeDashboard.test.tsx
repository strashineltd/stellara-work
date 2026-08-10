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
    expect(container.textContent).toContain('把任务交给 Agent');
    expect(container.textContent).toContain('继续工作');
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

  it('labels the send action as handing the task to the Agent', () => {
    const { container } = render(<HomeDashboard section="home" {...BASE_PROPS} />);
    const btn = container.querySelector('.dashboard-send-button');
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute('aria-label')).toBe('交给 Agent');
    // 视觉为纯箭头图标按钮，无文字
    expect(btn?.querySelector('.app-icon')).toBeTruthy();
    expect(btn?.textContent?.trim()).toBe('');
  });

  it('falls back to recent projects when there are no sessions', () => {
    const onOpenProject = vi.fn();
    const { getByText } = render(
      <HomeDashboard section="home" {...BASE_PROPS} sessions={[]} onOpenProject={onOpenProject} />,
    );
    fireClick(getByText('桌面端产品'));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('shows a hint when there is nothing to continue', () => {
    const { container } = render(
      <HomeDashboard section="home" {...BASE_PROPS} sessions={[]} projects={[]} />,
    );
    expect(container.textContent).toContain('创建项目或发送第一个任务后，可从这里继续。');
  });

  it('renders the project page and creates a project', () => {
    const onCreateProject = vi.fn();
    const { getByText } = render(<HomeDashboard section="projects" {...BASE_PROPS} onCreateProject={onCreateProject} />);
    expect(getByText('项目')).toBeTruthy();
    fireClick(getByText('新建项目'));
    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it('shows the no-model banner with settings and snooze actions', () => {
    const onOpenSettings = vi.fn();
    const { container, getByText } = render(
      <HomeDashboard section="home" {...BASE_PROPS} modelMissing onOpenSettings={onOpenSettings} />,
    );
    expect(container.textContent).toContain('尚未配置模型，Agent 暂时无法执行任务');
    expect(getByText('去设置')).toBeTruthy();
    expect(getByText('稍后提醒')).toBeTruthy();
    fireClick(getByText('去设置'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('snoozes the no-model banner and brings it back after 5 minutes', () => {
    vi.useFakeTimers();
    try {
      const { container, getByText } = render(
        <HomeDashboard section="home" {...BASE_PROPS} modelMissing />,
      );
      expect(container.textContent).toContain('尚未配置模型');
      fireClick(getByText('稍后提醒'));
      expect(container.textContent).not.toContain('尚未配置模型');
      act(() => {
        vi.advanceTimersByTime(300_000);
      });
      expect(container.textContent).toContain('尚未配置模型');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the snooze timer when unmounting', () => {
    vi.useFakeTimers();
    try {
      const setSpy = vi.spyOn(globalThis, 'setTimeout');
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const { getByText, unmount } = render(
        <HomeDashboard section="home" {...BASE_PROPS} modelMissing />,
      );
      fireClick(getByText('稍后提醒'));
      const snoozeIdx = setSpy.mock.calls.findIndex((call) => call[1] === 300_000);
      expect(snoozeIdx).toBeGreaterThanOrEqual(0);
      const timerId = setSpy.mock.results[snoozeIdx].value;
      unmount();
      expect(clearSpy).toHaveBeenCalledWith(timerId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the banner when modelMissing is false', () => {
    const { container } = render(<HomeDashboard section="home" {...BASE_PROPS} modelMissing={false} />);
    expect(container.textContent).not.toContain('尚未配置模型');
  });
});
