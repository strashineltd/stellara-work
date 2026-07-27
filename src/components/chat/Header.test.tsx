import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Header } from './Header';
import type { ModelConfig, ModelListItem } from '../../../shared/ipc';

const MODEL_CONFIG: ModelConfig = {
  id: 'deepseek-v4-pro',
  label: 'DeepSeek v4',
  model: 'deepseek-v4-pro',
  workDir: 'D:/test',
  apiKey: 'sk-test',
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
});
