import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ElectronAPI, SkillDef } from '../../../shared/ipc';
import { SettingsSkillsPanel } from './SettingsSkillsPanel';

const WORKDIR = '/Users/lhy/Stellara Work';

const SKILLS: SkillDef[] = [
  { name: 'code-review', description: '对当前变更做全面代码审查，输出发现清单', prompt: '请先读取当前 diff，然后逐文件审查…' },
  { name: 'macos-pack', description: '构建 arm64 dmg/zip 并验证产物', prompt: '运行 package:mac 并检查 release 目录…' },
];

const CONFIGURED: ConfiguredModel = {
  id: 'deepseek-v4-pro',
  label: 'DeepSeek-v4-Pro',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-pro',
  workDir: WORKDIR,
  hasKey: true,
  isCustom: false,
};

function installApi(configured: ConfiguredModel | null) {
  const mocks = {
    list: vi.fn().mockResolvedValue({ presets: [], configured }),
    skillsList: vi.fn().mockResolvedValue({ items: SKILLS, errors: [] }),
    openPath: vi.fn().mockResolvedValue(true),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      models: { list: mocks.list },
      skills: { list: mocks.skillsList, listDetailed: mocks.skillsList },
      fs: { openPath: mocks.openPath },
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

function byText(root: Element, text: string): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(text)) return node.parentElement;
  }
  return null;
}

describe('SettingsSkillsPanel', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    mocks = installApi(CONFIGURED);
  });

  it('loads skills for the configured workDir and renders icon, name and description', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.skillsList).toHaveBeenCalledWith(WORKDIR);

    const rows = container.querySelectorAll('.settings-skill-row');
    expect(rows.length).toBe(2);
    expect(byText(container, 'code-review')).toBeTruthy();
    expect(byText(container, '对当前变更做全面代码审查，输出发现清单')).toBeTruthy();
    expect(byText(container, 'macos-pack')).toBeTruthy();
    expect(container.querySelector('.settings-section__title')?.textContent).toContain('2');
    expect(container.querySelector('.settings-skill-row .settings-skill-row__icon')).toBeTruthy();
  });

  it('expands a skill row to reveal its prompt and collapses again', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    expect(byText(container, '请先读取当前 diff')).toBeNull();

    const row = container.querySelector('.settings-skill-row[data-skill="code-review"]');
    await fireClick(row);
    expect(byText(container, '请先读取当前 diff')).toBeTruthy();

    await fireClick(row);
    expect(byText(container, '请先读取当前 diff')).toBeNull();
  });

  it('shows the skills directory path', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    expect(byText(container, `${WORKDIR}/skills`)).toBeTruthy();
  });

  it('opens the skills directory via fs.openPath', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(byText(container, '打开目录'));

    expect(mocks.openPath).toHaveBeenCalledWith(WORKDIR, `${WORKDIR}/skills`);
  });

  it('shows a hint when no configured model has a workDir and skips loading', async () => {
    mocks = installApi(null);
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    expect(byText(container, '请先配置模型并选择项目')).toBeTruthy();
    expect(mocks.skillsList).not.toHaveBeenCalled();
  });
});
