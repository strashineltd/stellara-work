import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ModelListItem } from '../../../shared/ipc';
import { ModelSwitcher } from './ModelSwitcher';

const CONFIG: ConfiguredModel = {
  id: 'custom', label: '测试模型', model: 'test-model', baseUrl: 'http://127.0.0.1',
  hasKey: true, isCustom: true, contextWindow: 128000,
};

const LIST: ModelListItem[] = [
  { id: 'm1', label: '测试模型', baseUrl: 'http://127.0.0.1', model: 'test-model', hasKey: true, isActive: true, createdAt: '2026-01-01' },
  { id: 'm2', label: '备用模型', baseUrl: 'http://127.0.0.1', model: 'backup-model', hasKey: true, isActive: false, createdAt: '2026-01-01' },
];

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

describe('ModelSwitcher', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the active model label', () => {
    const { container, unmount } = render(
      <ModelSwitcher config={CONFIG} modelList={LIST} switchingModel={false} onSwitchModel={vi.fn()} onReconfigure={vi.fn()} />,
    );
    expect(container.textContent).toContain('测试模型');
    unmount();
  });

  it('opens the menu and switches model', () => {
    const onSwitchModel = vi.fn();
    const { container, unmount } = render(
      <ModelSwitcher config={CONFIG} modelList={LIST} switchingModel={false} onSwitchModel={onSwitchModel} onReconfigure={vi.fn()} />,
    );
    fireClick(container.querySelector('.model-switcher button'));
    fireClick(Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('备用模型')) ?? null);
    expect(onSwitchModel).toHaveBeenCalledWith('m2');
    unmount();
  });

  it('reconfigures from the menu footer with the trigger as return focus', () => {
    const onReconfigure = vi.fn();
    const { container, unmount } = render(
      <ModelSwitcher config={CONFIG} modelList={LIST} switchingModel={false} onSwitchModel={vi.fn()} onReconfigure={onReconfigure} />,
    );
    const trigger = container.querySelector('.main-model');
    fireClick(trigger);
    fireClick(container.querySelector('.model-switcher-add'));
    expect(onReconfigure).toHaveBeenCalledWith(trigger);
    unmount();
  });
});
