import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react';
import { Onboarding } from './Onboarding';
import type { ModelPreset, ConfiguredModel } from '../../shared/ipc';

const PRESETS: ModelPreset[] = [
  { id: 'glm-5.2', label: 'GLM-5.2 (智谱)', baseUrl: 'https://x', model: 'g', isCustom: false },
  { id: 'deepseek-v4-pro', label: 'DeepSeek-v4-Pro', baseUrl: 'https://x', model: 'd', isCustom: false },
  { id: 'kimi-k3', label: 'Kimi-K3', baseUrl: 'https://x', model: 'k', isCustom: false },
  { id: 'custom', label: '自定义', baseUrl: '', model: '', isCustom: true },
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
    queryByText: (text: string | RegExp) => {
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
    /** 只匹配真实按钮（正文中可能含相同关键词，如副标题的"先跳过"） */
    getButton: (text: string | RegExp) => {
      const buttons = container.querySelectorAll('button');
      for (const b of Array.from(buttons)) {
        const t = (b.textContent ?? '').trim();
        if (typeof text === 'string' ? t.includes(text) : text.test(t)) return b;
      }
      return null;
    },
  };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 首次配置：从欢迎页点「开始配置」进入选模型页 */
function renderFirstTime(
  onComplete: (config: ConfiguredModel | null) => void = vi.fn(),
) {
  const result = render(<Onboarding presets={PRESETS} initialConfig={null} onComplete={onComplete} />);
  fireClick(result.getByText(/开始配置/));
  return result;
}

/** React 受控 input：用原生 value setter 写入再派发 input 事件 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Onboarding', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Mock electronAPI for components that may call it
    (window as any).electronAPI = {
      dialog: {
        openDirectory: vi.fn().mockResolvedValue(null),
      },
      models: {
        configure: vi.fn().mockResolvedValue({ ok: true }),
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
  });

  // --- Page 0: Welcome ---

  it('shows the welcome page before the model pick for first-time setup', () => {
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={null} onComplete={vi.fn()} />);
    expect(getByText(/本地优先的 AI 任务工作台/)).toBeTruthy();
    expect(getByText(/开始配置/)).toBeTruthy();
    expect(getByText(/GLM-5\.2/)).toBeNull();
  });

  it('moves from welcome to the model pick when started', () => {
    const result = renderFirstTime();
    expect(result.getByText(/GLM-5\.2/)).toBeTruthy();
  });

  it('renders no emoji glyphs on the welcome page', () => {
    const { container } = render(<Onboarding presets={PRESETS} initialConfig={null} onComplete={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  // --- Page 1: Model Pick ---

  it('renders model cards on page 1', () => {
    const { getByText } = renderFirstTime();
    expect(getByText(/GLM-5\.2/)).toBeTruthy();
    expect(getByText(/DeepSeek/)).toBeTruthy();
  });

  it('renders all four preset cards on page 1', () => {
    const { getByText } = renderFirstTime();
    expect(getByText(/GLM-5\.2/)).toBeTruthy();
    expect(getByText(/DeepSeek-v4-Pro/)).toBeTruthy();
    expect(getByText(/Kimi-K3/)).toBeTruthy();
    expect(getByText(/自定义/)).toBeTruthy();
  });

  it('highlights the selected card with accent border and background', () => {
    const { querySelectorAll } = renderFirstTime();
    // First card (deepseek-v4-pro is default) should have selected class
    const cards = querySelectorAll('[data-model-id]');
    const selectedCard = Array.from(cards).find((c) => c.getAttribute('data-model-id') === 'deepseek-v4-pro');
    expect(selectedCard).toBeTruthy();
    expect(selectedCard!.className).toMatch(/selected/);
  });

  it('updates selection when a different card is clicked', () => {
    const { querySelector, querySelectorAll } = renderFirstTime();
    const glmCard = querySelector('[data-model-id="glm-5.2"]');
    expect(glmCard).toBeTruthy();
    fireClick(glmCard);
    // Now glm should be selected
    const cards = querySelectorAll('[data-model-id]');
    const updated = Array.from(cards).find((c) => c.getAttribute('data-model-id') === 'glm-5.2');
    expect(updated!.className).toMatch(/selected/);
  });

  it('does not show the welcome screen if initialConfig is provided', () => {
    const init: ConfiguredModel = { id: 'glm-5.2', label: 'GLM-5.2', baseUrl: 'x', model: 'g', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/test' };
    const { queryByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    // Should go straight to workdir step, not show pick page content
    expect(queryByText(/welcome|Welcome/i)).toBeNull();
    // Should NOT be on the pick page with model grid
    const nextBtn = queryByText(/next|下一步/i);
    expect(nextBtn).toBeNull();
  });

  it('renders no emoji glyphs', () => {
    const { container } = renderFirstTime();
    expect(container.innerHTML).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('has a skip button on page 1', () => {
    const result = renderFirstTime();
    expect(result.getButton(/skip|跳过/i)).toBeTruthy();
  });

  it('has a next button on page 1', () => {
    const { getByText } = renderFirstTime();
    expect(getByText(/next|下一步/i)).toBeTruthy();
  });

  it('navigates to page 2 when Next is clicked', () => {
    const { getByText } = renderFirstTime();
    const nextBtn = getByText(/next|下一步/i);
    fireClick(nextBtn);
    expect(getByText(/配置密钥/i)).toBeTruthy();
  });

  // --- Page 2: Connection details ---

  it('shows connection details when initialConfig is provided', () => {
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing' };
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    expect(getByText(/配置密钥/i)).toBeTruthy();
  });

  it('has a back button on page 2', () => {
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing' };
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    expect(getByText(/back|返回|上一步/i)).toBeTruthy();
  });

  it('has a skip button on page 2', () => {
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing' };
    const result = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    expect(result.getButton(/skip|跳过/i)).toBeTruthy();
  });

  it('has a complete button on page 2', () => {
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing' };
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    expect(getByText(/complete|完成/i)).toBeTruthy();
  });

  it('navigates back to page 1 when Back is clicked', () => {
    const { getByText } = renderFirstTime();
    // Go to page 2 first
    fireClick(getByText(/next|下一步/i));
    expect(getByText(/配置密钥/i)).toBeTruthy();
    // Go back
    fireClick(getByText(/back|返回|上一步/i));
    expect(getByText(/选择模型/i)).toBeTruthy();
  });

  it('skips from page 1 and completes with null', () => {
    const onComplete = vi.fn();
    const result = renderFirstTime(onComplete);
    // Click skip on page 1 - should complete immediately with null (no connection page)
    const skipBtn = result.getButton(/skip|跳过/i);
    fireClick(skipBtn);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toBeNull();
  });

  // --- Skippable flow: welcome / pick / connection ---

  it('skips onboarding from the welcome page via 先逛逛 and completes with null', () => {
    const onComplete = vi.fn();
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={null} onComplete={onComplete} />);
    fireClick(getByText(/先逛逛/));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toBeNull();
  });

  it('reconfigure: skip on connection page keeps the existing config (not null)', () => {
    const onComplete = vi.fn();
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing' };
    const result = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={onComplete} />);
    fireClick(result.getButton(/跳过/));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toEqual(init);
  });

  it('skips from the connection page without an api key and completes with null', () => {
    const onComplete = vi.fn();
    const result = renderFirstTime(onComplete);
    fireClick(result.getByText(/next|下一步/i));
    fireClick(result.getButton(/跳过/));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toBeNull();
    // 跳过不触发密钥校验
    expect(result.queryByText(/请输入 API 密钥/)).toBeNull();
  });

  it('completes with a ConfiguredModel when a key is entered and configure succeeds', async () => {
    const onComplete = vi.fn();
    (window as any).electronAPI.models.test = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI.models.configure = vi.fn().mockResolvedValue({ ok: true });
    const { getByText } = renderFirstTime(onComplete);
    fireClick(getByText(/next|下一步/i));
    const keyInput = getByText(/API 密钥/)!.parentElement!.querySelector('input') as HTMLInputElement;
    typeInto(keyInput, 'sk-test');
    fireClick(getByText(/完成配置/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // 首次配置完成直接结束（不再进入环境初始化步骤）
    expect(getByText(/选择工作目录/)).toBeNull();
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0]).toMatchObject({ id: 'deepseek-v4-pro', hasKey: true });
  });

  it('still validates when 完成配置 is clicked without an api key (complete is not skip)', async () => {
    const onComplete = vi.fn();
    const { getByText } = renderFirstTime(onComplete);
    fireClick(getByText(/next|下一步/i));
    fireClick(getByText(/完成配置/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getByText(/请输入 API 密钥/)).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not expose the legacy model workdir during reconfiguration', () => {
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/existing/path' };
    const { container } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={vi.fn()} />);
    expect(container.textContent).not.toContain('/existing/path');
    expect(container.textContent).not.toContain('工作目录');
  });

  it('calls onComplete after successful configure', async () => {
    const onComplete = vi.fn();
    (window as any).electronAPI.models.test = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI.models.configure = vi.fn().mockResolvedValue({ ok: true });
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/test' };
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={onComplete} />);
    const completeBtn = getByText(/complete|完成/i);
    fireClick(completeBtn);
    // Wait for async configure call to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('shows error when configure fails', async () => {
    const onComplete = vi.fn();
    (window as any).electronAPI.models.test = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI.models.configure = vi.fn().mockResolvedValue({ ok: false, error: 'Connection refused' });
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/test' };
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={onComplete} />);
    const completeBtn = getByText(/complete|完成/i);
    fireClick(completeBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(getByText(/Connection refused/)).toBeTruthy();
  });

  it('reconfigure with existing key: empty key input preserves the old key without receiving it', async () => {
    const onComplete = vi.fn();
    (window as any).electronAPI.models.test = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronAPI.models.configure = vi.fn().mockResolvedValue({ ok: true });
    // initialConfig from models:list must NOT contain apiKey, only hasKey
    const init: ConfiguredModel = { id: 'deepseek-v4-pro', label: 'DS', baseUrl: 'x', model: 'd', isCustom: false, hasKey: true, contextWindow: 256000, workDir: '/test' };
    expect('apiKey' in init).toBe(false);
    const { getByText } = render(<Onboarding presets={PRESETS} initialConfig={init} onComplete={onComplete} />);
    const completeBtn = getByText(/complete|完成/i);
    fireClick(completeBtn);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // No validation error: empty key is allowed when a key already exists
    expect((window as any).electronAPI.models.test).toHaveBeenCalled();
    const sent = (window as any).electronAPI.models.configure.mock.calls[0]?.[0];
    expect(sent?.apiKey).toBe('');
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
