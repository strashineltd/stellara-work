import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ElectronAPI, SkillDetailedItem } from '../../../shared/ipc';
import { SettingsSkillsPanel } from './SettingsSkillsPanel';

const WORKDIR = '/Users/lhy/Stellara Work';

const SKILLS: SkillDetailedItem[] = [
  { name: 'code-review', description: '对当前变更做全面代码审查，输出发现清单', prompt: '请先读取当前 diff，然后逐文件审查…', format: 'md', file: 'code-review.md' },
  { name: 'macos-pack', description: '构建 arm64 dmg/zip 并验证产物', prompt: '运行 package:mac 并检查 release 目录…', format: 'md', enabled: false, file: 'macos-pack.md' },
  { name: 'legacy-notes', description: '旧格式技能，仅可删除', prompt: 'JSON 格式内容', format: 'json', file: 'legacy-notes.json' },
  { name: 'subdir-review', description: '子目录代码审查', prompt: '子目录审查指令…', format: 'md', file: 'review/subdir-review.md' },
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
    skillsCreate: vi.fn().mockResolvedValue({ file: 'new-skill.md' }),
    skillsUpdate: vi.fn().mockResolvedValue(undefined),
    skillsDelete: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      models: { list: mocks.list },
      skills: {
        list: mocks.skillsList,
        listDetailed: mocks.skillsList,
        create: mocks.skillsCreate,
        update: mocks.skillsUpdate,
        delete: mocks.skillsDelete,
      },
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

async function fireInput(element: Element | null | undefined, value: string) {
  if (!element) throw new Error('Element not found for input');
  await act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
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
    expect(rows.length).toBe(4);
    expect(byText(container, 'code-review')).toBeTruthy();
    expect(byText(container, '对当前变更做全面代码审查，输出发现清单')).toBeTruthy();
    expect(byText(container, 'macos-pack')).toBeTruthy();
    expect(container.querySelector('.settings-section__title')?.textContent).toContain('4');
    expect(container.querySelector('.settings-skill-row .settings-skill-row__icon')).toBeTruthy();
  });

  it('expands a skill row to reveal its prompt and collapses again', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    expect(byText(container, '请先读取当前 diff')).toBeNull();

    const row = container.querySelector('.settings-skill-row[data-skill="code-review.md"]');
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

  it('keeps the create-skill button visible without a workDir and prompts to pick a project', async () => {
    mocks = installApi(null);
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    const createBtn = container.querySelector('.settings-skill-create');
    expect(createBtn).toBeTruthy();
    await fireClick(createBtn);
    expect(container.querySelector('.settings-skill-form')).toBeNull();
    expect(byText(container, '请先创建或选择项目，技能保存在项目的 skills/ 目录中')).toBeTruthy();
  });

  it('creates a skill via the form: calls skills.create with name/description/prompt, closes the form and refreshes the list', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-skill-create'));
    expect(container.querySelector('.settings-skill-form')).toBeTruthy();

    await fireInput(container.querySelector('.settings-skill-field-name input'), 'my-skill');
    await fireInput(container.querySelector('.settings-skill-field-desc input'), '我的技能描述');
    await fireInput(container.querySelector('.settings-skill-field-prompt textarea'), '执行指令');
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsCreate).toHaveBeenCalledWith(WORKDIR, {
      name: 'my-skill',
      description: '我的技能描述',
      prompt: '执行指令',
    });
    expect(container.querySelector('.settings-skill-form')).toBeNull();
    expect(mocks.skillsList).toHaveBeenCalledTimes(2);
  });

  it('does not submit the form when name/description/prompt are empty', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-skill-create'));
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsCreate).not.toHaveBeenCalled();
    expect(byText(container, '不能为空')).toBeTruthy();

    await fireInput(container.querySelector('.settings-skill-field-name input'), 'only-name');
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsCreate).not.toHaveBeenCalled();
  });

  it('shows the create error (e.g. file exists) inside the form', async () => {
    mocks.skillsCreate.mockRejectedValueOnce(new Error('技能已存在：my-skill.md'));
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(container.querySelector('.settings-skill-create'));
    await fireInput(container.querySelector('.settings-skill-field-name input'), 'my-skill');
    await fireInput(container.querySelector('.settings-skill-field-desc input'), '描述');
    await fireInput(container.querySelector('.settings-skill-field-prompt textarea'), '内容');
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsCreate).toHaveBeenCalledTimes(1);
    expect(byText(container, '技能已存在：my-skill.md')).toBeTruthy();
    expect(container.querySelector('.settings-skill-form')).toBeTruthy();
  });

  it('prefills the form when editing and saves via skills.update', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(
      container.querySelector('.settings-skill-row[data-skill="code-review.md"] .settings-skill-edit'),
    );

    expect(container.querySelector('.settings-skill-form')).toBeTruthy();
    expect(byText(container, '编辑技能')).toBeTruthy();
    const nameInput = container.querySelector('.settings-skill-field-name input') as HTMLInputElement;
    const descInput = container.querySelector('.settings-skill-field-desc input') as HTMLInputElement;
    const promptArea = container.querySelector('.settings-skill-field-prompt textarea') as HTMLTextAreaElement;
    expect(nameInput.value).toBe('code-review');
    expect(descInput.value).toBe('对当前变更做全面代码审查，输出发现清单');
    expect(promptArea.value).toBe('请先读取当前 diff，然后逐文件审查…');

    await fireInput(nameInput, 'code-review-v2');
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsUpdate).toHaveBeenCalledWith(WORKDIR, 'code-review.md', {
      name: 'code-review-v2',
      description: '对当前变更做全面代码审查，输出发现清单',
      prompt: '请先读取当前 diff，然后逐文件审查…',
    });
    expect(container.querySelector('.settings-skill-form')).toBeNull();
  });

  it('toggles the enabled switch via skills.update({ enabled }) and grays the disabled row', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    const row = container.querySelector('.settings-skill-row[data-skill="code-review.md"]');
    const toggle = row?.querySelector('.settings-switch');
    expect(toggle?.getAttribute('role')).toBe('switch');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(row?.classList.contains('settings-skill-row--disabled')).toBe(false);

    await fireClick(toggle);

    expect(mocks.skillsUpdate).toHaveBeenCalledWith(WORKDIR, 'code-review.md', { enabled: false });
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    expect(row?.classList.contains('settings-skill-row--disabled')).toBe(true);
  });

  it('renders a disabled skill with the gray class and the switch off', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    const row = container.querySelector('.settings-skill-row[data-skill="macos-pack.md"]');
    expect(row?.classList.contains('settings-skill-row--disabled')).toBe(true);
    expect(row?.querySelector('.settings-switch')?.getAttribute('aria-checked')).toBe('false');
  });

  it('deletes a skill only after confirmation', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    await fireClick(
      container.querySelector('.settings-skill-row[data-skill="code-review.md"] .settings-skill-delete'),
    );
    expect(mocks.skillsDelete).not.toHaveBeenCalled();
    expect(byText(container, '确认删除')).toBeTruthy();

    await fireClick(byText(container, '确认删除'));

    expect(mocks.skillsDelete).toHaveBeenCalledWith(WORKDIR, 'code-review.md');
    expect(container.querySelector('.settings-skill-row[data-skill="code-review.md"]')).toBeNull();
  });

  it('renders json skills without an edit button or toggle (delete only)', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    const row = container.querySelector('.settings-skill-row[data-skill="legacy-notes.json"]');
    expect(row?.querySelector('.settings-skill-edit')).toBeNull();
    expect(row?.querySelector('.settings-switch')).toBeNull();
    expect(row?.querySelector('.settings-skill-expand')).toBeTruthy();
    expect(row?.querySelector('.settings-skill-delete')).toBeTruthy();
    expect(row?.querySelector('.settings-skill-badge--json')).toBeTruthy();
  });

  it('uses the file field for subdirectory skills in edit and delete (no name-derived path)', async () => {
    const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

    const subdirRow = container.querySelector('.settings-skill-row[data-skill="review/subdir-review.md"]');
    expect(subdirRow).toBeTruthy();
    expect(byText(container, '子目录代码审查')).toBeTruthy();

    await fireClick(subdirRow?.querySelector('.settings-skill-edit'));
    const nameInput = container.querySelector('.settings-skill-field-name input') as HTMLInputElement;
    expect(nameInput.value).toBe('subdir-review');
    await fireClick(container.querySelector('.settings-skill-save'));

    expect(mocks.skillsUpdate).toHaveBeenCalledWith(WORKDIR, 'review/subdir-review.md', {
      name: 'subdir-review',
      description: '子目录代码审查',
      prompt: '子目录审查指令…',
    });

    await fireClick(subdirRow?.querySelector('.settings-skill-delete'));
    expect(mocks.skillsDelete).not.toHaveBeenCalled();
    await fireClick(byText(container, '确认删除'));

    expect(mocks.skillsDelete).toHaveBeenCalledWith(WORKDIR, 'review/subdir-review.md');
    expect(mocks.skillsDelete).not.toHaveBeenCalledWith(WORKDIR, 'subdir-review.md');
    expect(container.querySelector('.settings-skill-row[data-skill="review/subdir-review.md"]')).toBeNull();
    expect(container.querySelector('.settings-skill-row[data-skill="code-review.md"]')).toBeTruthy();
  });
});
