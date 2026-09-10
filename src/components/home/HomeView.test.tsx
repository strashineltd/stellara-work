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

  it('sends from the composer', () => {
    const onSend = vi.fn();
    const { container, unmount } = render(<HomeView {...BASE_PROPS} input="完成任务" onSend={onSend} />);
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送"]');
    fireClick(send);
    expect(onSend).toHaveBeenCalled();
    unmount();
  });
});
