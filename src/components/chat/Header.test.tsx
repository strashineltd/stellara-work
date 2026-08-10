import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Header } from './Header';
import type { ConfiguredModel, ModelListItem } from '../../../shared/ipc';

const MODEL_CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro',
  label: 'DeepSeek v4',
  model: 'deepseek-v4-pro',
  workDir: 'D:/test',
  hasKey: true,
  isCustom: false,
  baseUrl: 'https://api.deepseek.com',
  contextWindow: 128000,
};

const MODEL_LIST: ModelListItem[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek v4', model: 'deepseek-v4-pro', hasKey: true, baseUrl: 'https://api.deepseek.com', isActive: true, createdAt: '2026-01-01' },
  { id: 'glm-5.2', label: 'GLM-5', model: 'glm-5.2', hasKey: false, baseUrl: 'https://open.bigmodel.cn', isActive: false, createdAt: '2026-01-01' },
];

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

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('Header', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders without throwing', () => {
    expect(() =>
      render(
        <Header
          config={MODEL_CONFIG}
          sidebarOpen={true}
          workspaceOpen={false}
          modelList={MODEL_LIST}
          switchingModel={false}
          busy={false}
          hasEntries={true}
          onToggleSidebar={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onChangeWorkDir={vi.fn()}
          onOpenFileTree={vi.fn()}
          onOpenSettings={vi.fn()}
          onReconfigure={vi.fn()}
          onNewSession={vi.fn()}
          onNewTask={vi.fn()}
          onSwitchModel={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name main-header', () => {
    const { querySelector } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const header = querySelector('.main-header');
    expect(header).toBeTruthy();
  });

  it('removes product branding from the header', () => {
    const { querySelector, getByText } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    expect(querySelector('.header-product')).toBeNull();
    expect(querySelector('.header-product-mark')).toBeNull();
    expect(getByText('Stellara Work')).toBeNull();
  });

  it('does not use emoji glyphs in rendered HTML', () => {
    const { container } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('does not duplicate the persistent sidebar settings control in the header', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={onOpenSettings}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const settingsButtons = container.querySelectorAll('button[aria-label="打开设置"]');
    expect(settingsButtons.length).toBe(0);
    fireClick(container.querySelector('.main-model'));
    fireClick(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('添加 / 管理模型')) ?? null);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledWith();
  });

  it('toggles the workspace with synchronized disclosure semantics', () => {
    const onToggleWorkspace = vi.fn();
    const { container } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={onToggleWorkspace}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );

    const button = container.querySelector('button[aria-controls="workspace-panel"]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    fireClick(button);
    expect(onToggleWorkspace).toHaveBeenCalledOnce();
  });

  it('shows a "未配置模型" warning badge and opens settings when config is null', () => {
    const onOpenSettings = vi.fn();
    const { querySelector, getByText, container } = render(
      <Header
        config={null}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={onOpenSettings}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const badge = querySelector('.model-pill--missing');
    expect(badge).toBeTruthy();
    expect(getByText('未配置模型')).toBeTruthy();
    // 无模型时不渲染模型切换下拉
    expect(querySelector('.model-switcher-menu')).toBeNull();
    expect(querySelector('.main-model')).toBeNull();
    fireClick(badge);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledWith();
    expect(container.innerHTML).not.toContain('aria-haspopup="listbox"');
  });
});
