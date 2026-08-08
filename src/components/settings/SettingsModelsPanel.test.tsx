import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI, ModelListItem, ModelPreset } from '../../../shared/ipc';
import { SettingsModelsPanel } from './SettingsModelsPanel';

const PRESETS: ModelPreset[] = [
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek-v4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    isCustom: false,
    contextWindow: 256_000,
  },
  {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    isCustom: false,
    contextWindow: 128_000,
  },
];

const MODELS: ModelListItem[] = [
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek-v4-Pro',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    hasKey: true,
    isActive: true,
    createdAt: '2026-08-01T00:00:00Z',
    contextWindow: 256_000,
  },
  {
    id: 'glm-5.2',
    label: 'GLM-5.2',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    hasKey: false,
    isActive: false,
    createdAt: '2026-08-02T00:00:00Z',
    contextWindow: 128_000,
  },
];

function installApi(models: ModelListItem[] = MODELS) {
  const mocks = {
    list: vi.fn().mockResolvedValue({ presets: PRESETS, configured: null }),
    getAll: vi.fn().mockResolvedValue(models),
    configure: vi.fn().mockResolvedValue({ ok: true }),
    test: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined),
    updateKey: vi.fn().mockResolvedValue(undefined),
    updateWorkDir: vi.fn().mockResolvedValue(undefined),
    updateContextWindow: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      app: {
        getInfo: vi.fn().mockResolvedValue({ version: '0.9.0-test', platform: 'darwin', appDataPath: '/tmp', envPath: '/tmp' }),
        openSettingsWindow: vi.fn().mockResolvedValue(undefined),
        onSettingsChanged: vi.fn().mockReturnValue(() => {}),
      },
      models: mocks,
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  return mocks;
}

async function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root!.unmount());
      document.body.removeChild(container);
    },
  };
}

async function fireClick(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function fireChange(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('No value setter for input');
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function byText(root: Element, text: string): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(text)) return node.parentElement;
  }
  return null;
}

describe('SettingsModelsPanel', () => {
  let mocks: ReturnType<typeof installApi>;
  let confirmMock: ReturnType<typeof vi.fn<(message?: string) => boolean>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmMock = vi.fn<(message?: string) => boolean>().mockReturnValue(true);
    window.confirm = confirmMock;
    mocks = installApi();
  });

  it('renders the model list with active/connection badges and base line', async () => {
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);

    const rows = container.querySelectorAll('.provider-row');
    expect(rows.length).toBe(2);

    const row0 = rows[0]!;
    expect(row0.textContent).toContain('DeepSeek-v4-Pro');
    expect(row0.textContent).toContain('活跃');
    expect(row0.textContent).toContain('已连接');
    expect(row0.textContent).toContain('model: deepseek-v4-pro');
    expect(row0.querySelector('.settings-badge--active')).toBeTruthy();
    expect(row0.querySelector('.settings-badge--ok')).toBeTruthy();

    const row1 = rows[1]!;
    expect(row1.textContent).toContain('GLM-5.2');
    expect(row1.textContent).toContain('无 Key');
    expect(row1.querySelector('.settings-badge--warn')).toBeTruthy();

    const card = container.querySelector('.active-model');
    expect(card?.textContent).toContain('DeepSeek-v4-Pro');
    expect(card?.textContent).toContain('256K 上下文');
    expect(card?.textContent).toContain('key 已配置');
  });

  it('opens the add form, auto-fills preset baseUrl, and saves via configure', async () => {
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-add-trigger button'));
    expect(container.querySelector('.settings-add-form')).toBeTruthy();

    const cards = container.querySelectorAll('.model-card');
    expect(cards.length).toBe(2);

    await fireClick(cards[1]);
    const baseCode = container.querySelector('.settings-readonly-field code');
    expect(baseCode?.textContent).toContain('https://open.bigmodel.cn/api/paas/v4');

    const keyInput = container.querySelector('#add-model-api-key') as HTMLInputElement;
    fireChange(keyInput, 'sk-test');
    await fireClick(byText(container, '保存'));

    expect(mocks.configure).toHaveBeenCalledTimes(1);
    expect(mocks.configure).toHaveBeenCalledWith({
      id: 'glm-5.2',
      label: 'GLM-5.2',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.2',
      apiKey: 'sk-test',
      isCustom: false,
    });
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.settings-add-form')).toBeNull();
  });

  it('edits a model key inline and saves via updateKey', async () => {
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);

    const rows = container.querySelectorAll('.provider-row');
    await fireClick(rows[1]!.querySelector('.icon-btn[title="编辑 Key"]'));

    const input = rows[1]!.querySelector('.settings-item__ops input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireChange(input, 'new-key');
    await fireClick(byText(rows[1]!, '保存'));

    expect(mocks.updateKey).toHaveBeenCalledWith('glm-5.2', 'new-key');
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.settings-item__ops input')).toBeNull();
  });

  it('switches the active model via the switch list', async () => {
    const { container } = await render(<SettingsModelsPanel onChanged={vi.fn()} />);

    await fireClick(byText(container, '切换'));
    const rows = container.querySelectorAll('.switch-row');
    expect(rows.length).toBe(2);
    await fireClick(rows[1]);

    expect(mocks.setActive).toHaveBeenCalledWith('glm-5.2');
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
  });

  it('deletes a model after confirm and skips when cancelled', async () => {
    const onChanged = vi.fn();
    const { container } = await render(<SettingsModelsPanel onChanged={onChanged} />);

    const rows = container.querySelectorAll('.provider-row');
    await fireClick(rows[0]!.querySelector('.icon-btn[title="删除"]'));
    expect(mocks.remove).toHaveBeenCalledWith('deepseek-v4-pro');
    expect(onChanged).toHaveBeenCalledTimes(1);

    confirmMock.mockReturnValue(false);
    const dangerDelete = container.querySelectorAll('.settings-danger-zone .btn-danger')[0];
    await fireClick(dangerDelete);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
