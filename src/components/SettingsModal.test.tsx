import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { SettingsModal } from './SettingsModal';

// Mock window.electronAPI to prevent SettingsModal from crashing on mount
const mockElectronAPI = {
  models: {
    getAll: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ presets: [], configured: null }),
  },
  sessions: { list: vi.fn().mockResolvedValue([]) },
  settings: {
    get: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue(undefined),
  },
  dialog: { openDirectory: vi.fn() },
  fs: { openPath: vi.fn() },
  skills: { list: vi.fn().mockResolvedValue([]) },
};
Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

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

describe('SettingsModal workspace mode toggle', () => {
  const props = {
    onClose: vi.fn(),
    onModelChanged: vi.fn(),
    theme: 'dark' as const,
    onThemeChanged: vi.fn(),
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a workspace mode radio group on App tab', () => {
    const { getByText, querySelectorAll } = render(<SettingsModal {...props} initialTab="app" />);
    // The label text for the workspace mode row
    expect(getByText(/工作区模式|workspace/i)).toBeTruthy();
    // Should have two radio inputs: sidebar and tabs
    const radios = querySelectorAll('input[name="workspaceMode"]');
    expect(radios.length).toBe(2);
  });

  it('renders theme selector on App tab', () => {
    const { getByText, querySelector } = render(<SettingsModal {...props} initialTab="app" />);
    expect(getByText(/主题|theme/i)).toBeTruthy();
    const themeSelect = querySelector('select.theme-select, select.input');
    expect(themeSelect).toBeTruthy();
  });

  it('renders sidebar radio as checked by default when no workspaceMode in settings', () => {
    const { querySelector } = render(<SettingsModal {...props} initialTab="app" />);
    const sidebarRadio = querySelector('input[name="workspaceMode"][value="sidebar"]') as HTMLInputElement;
    expect(sidebarRadio).toBeTruthy();
    expect(sidebarRadio.checked).toBe(true);
    const tabsRadio = querySelector('input[name="workspaceMode"][value="tabs"]') as HTMLInputElement;
    expect(tabsRadio).toBeTruthy();
    expect(tabsRadio.checked).toBe(false);
  });

  it('keeps a stable modal shell while switching animated tab panels', () => {
    const { getByText, querySelector } = render(<SettingsModal {...props} initialTab="providers" />);
    const modal = querySelector('.settings-modal');
    expect(modal).toBeTruthy();
    expect(querySelector('#settings-panel-providers.settings-panel')).toBeTruthy();

    fireClick(getByText('应用'));

    expect(querySelector('.settings-modal')).toBe(modal);
    expect(querySelector('#settings-panel-app.settings-panel')).toBeTruthy();
    expect(querySelector('#settings-panel-providers')).toBeNull();
  });

  it('marks the selected setting category with tab semantics', () => {
    const { querySelector } = render(<SettingsModal {...props} initialTab="skills" />);
    const selected = querySelector('#settings-tab-skills') as HTMLButtonElement;
    expect(selected.getAttribute('role')).toBe('tab');
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.tabIndex).toBe(0);
    expect(querySelector('#settings-panel-skills[role="tabpanel"]')).toBeTruthy();
  });

  it('exposes the settings surface as a labelled modal dialog', () => {
    const { querySelector } = render(<SettingsModal {...props} initialTab="app" />);
    const dialog = querySelector('.settings-modal');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('settings-title');
  });
});
