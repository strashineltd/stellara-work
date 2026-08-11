import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguredModel, ElectronAPI, McpServerConfig, SkillDef } from '../../../shared/ipc';
import { SettingsSkillsPanel } from './SettingsSkillsPanel';

const WORKDIR = '/Users/lhy/Stellara Work';

const SKILLS: SkillDef[] = [
  {
    name: 'code-review',
    description: '对当前变更做全面代码审查，输出发现清单',
    prompt: '请先读取当前 diff，然后逐文件审查…',
    format: 'md',
  },
  {
    name: 'mcp-setup',
    description: '配置 MCP 服务器的 JSON 模板',
    prompt: 'JSON 格式技能内容',
    format: 'json',
  },
  { name: 'macos-pack', description: '构建 arm64 dmg/zip 并验证产物', prompt: '运行 package:mac 并检查 release 目录…' },
];

const SERVERS: McpServerConfig[] = [
  {
    id: 'filesystem',
    name: '本地文件系统',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    enabled: true,
  },
  {
    id: 'github',
    name: 'GitHub API',
    transport: 'http',
    url: 'https://mcp.example.com/github',
    enabled: false,
  },
];

const TOOLS = [
  { name: 'read', description: 'Read files', inputSchema: { type: 'object', properties: {} } },
  { name: 'write', description: 'Write files', inputSchema: { type: 'object', properties: {} } },
  { name: 'list', description: 'List files', inputSchema: { type: 'object', properties: {} } },
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
    skillsList: vi.fn().mockResolvedValue(SKILLS),
    skillsListDetailed: vi.fn().mockResolvedValue({ items: SKILLS, errors: [] }),
    openPath: vi.fn().mockResolvedValue(true),
    mcpList: vi.fn().mockResolvedValue(SERVERS),
    mcpAdd: vi.fn().mockResolvedValue(undefined),
    mcpUpdate: vi.fn().mockResolvedValue(undefined),
    mcpRemove: vi.fn().mockResolvedValue(undefined),
    mcpTest: vi.fn().mockResolvedValue({ ok: true, toolCount: 3 }),
    clipboardWrite: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
      models: { list: mocks.list },
      skills: { list: mocks.skillsList, listDetailed: mocks.skillsListDetailed },
      fs: { openPath: mocks.openPath },
      mcp: {
        list: mocks.mcpList,
        add: mocks.mcpAdd,
        update: mocks.mcpUpdate,
        remove: mocks.mcpRemove,
        test: mocks.mcpTest,
      },
    } as unknown as ElectronAPI,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.clipboardWrite },
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
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fireChange(element: Element | null | undefined, value: string) {
  if (!element) throw new Error('Element not found for change');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function fireCheckboxToggle(element: Element | null | undefined) {
  if (!element) throw new Error('Element not found for checkbox');
  await act(async () => {
    (element as HTMLInputElement).click();
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

describe('SettingsSkillsMcp（技能与 MCP 面板）', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    mocks = installApi(CONFIGURED);
  });

  describe('技能搜索 / 模板 / 格式徽章', () => {
    it('renders the 技能与 MCP header', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      expect(container.querySelector('.settings-panel-head h2')?.textContent).toBe('技能与 MCP');
      expect(byText(container, '项目技能与 MCP 服务器')).toBeTruthy();
    });

    it('filters skill rows by name via the search input', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      expect(container.querySelectorAll('.settings-skill-row').length).toBe(3);

      await fireInput(container.querySelector('.settings-skill-search input'), 'macos');

      const rows = container.querySelectorAll('.settings-skill-row');
      expect(rows.length).toBe(1);
      expect(byText(container, 'macos-pack')).toBeTruthy();
      expect(byText(container, 'code-review')).toBeNull();
    });

    it('filters skill rows by description', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireInput(container.querySelector('.settings-skill-search input'), 'JSON 模板');

      const rows = container.querySelectorAll('.settings-skill-row');
      expect(rows.length).toBe(1);
      expect(byText(container, 'mcp-setup')).toBeTruthy();
    });

    it('clears the filter and shows all rows when the query is empty', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireInput(container.querySelector('.settings-skill-search input'), 'macos');
      await fireInput(container.querySelector('.settings-skill-search input'), '');

      expect(container.querySelectorAll('.settings-skill-row').length).toBe(3);
    });

    it('renders format badges for md/json skills', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      const badges = container.querySelectorAll('.settings-skill-badge');
      expect(badges.length).toBe(2);
      expect(badges[0]?.textContent).toBe('md');
      expect(badges[1]?.textContent).toBe('json');
    });

    it('copies the skill template via clipboard on 复制模板 click', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-skill-template-copy'));

      expect(mocks.clipboardWrite).toHaveBeenCalledTimes(1);
      const written = mocks.clipboardWrite.mock.calls[0]![0] as string;
      expect(written).toContain('---');
      expect(written).toContain('name: my-skill');
      expect(written).toContain('description:');
      expect(written).toContain('---');
      expect(byText(container, '已复制')).toBeTruthy();
    });

    it('renders format error warnings for invalid skill files', async () => {
      mocks.skillsListDetailed.mockResolvedValue({
        items: SKILLS,
        errors: [
          { file: 'bad.json', reason: '缺少 name' },
          { file: 'broken.md', reason: '格式解析失败' },
        ],
      });
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      const banner = container.querySelector('.settings-skill-errors');
      expect(banner).toBeTruthy();
      expect(byText(container, '2 个文件格式错误')).toBeTruthy();
      expect(byText(container, 'bad.json')).toBeTruthy();
      expect(byText(container, '缺少 name')).toBeTruthy();
      expect(byText(container, 'broken.md')).toBeTruthy();
      expect(byText(container, '格式解析失败')).toBeTruthy();
      expect(banner?.getAttribute('role')).toBe('alert');
    });
  });

  describe('MCP 服务器列表', () => {
    it('renders server rows with name, transport badge, switch and delete button', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      expect(mocks.mcpList).toHaveBeenCalledTimes(1);
      const rows = container.querySelectorAll('.settings-mcp-row');
      expect(rows.length).toBe(2);

      expect(byText(container, '本地文件系统')).toBeTruthy();
      expect(byText(container, 'GitHub API')).toBeTruthy();
      expect(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-badge')?.textContent).toBe('stdio');
      expect(container.querySelector('.settings-mcp-row[data-server="github"] .settings-mcp-badge')?.textContent).toBe('http');

      const fsSwitch = container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-switch');
      expect(fsSwitch?.getAttribute('role')).toBe('switch');
      expect(fsSwitch?.getAttribute('aria-checked')).toBe('true');
      const ghSwitch = container.querySelector('.settings-mcp-row[data-server="github"] .settings-switch');
      expect(ghSwitch?.getAttribute('aria-checked')).toBe('false');

      expect(container.querySelectorAll('.settings-mcp-row .settings-mcp-delete').length).toBe(2);
    });

    it('shows a hint when no MCP servers are configured', async () => {
      mocks.mcpList.mockResolvedValue([]);
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      expect(byText(container, '添加 MCP 服务器')).toBeTruthy();
    });

    it('toggles the enabled switch via mcp.update', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-switch'));

      expect(mocks.mcpUpdate).toHaveBeenCalledWith('filesystem', { enabled: false });
      expect(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-switch')?.getAttribute('aria-checked')).toBe('false');
    });

    it('deletes a server only after confirmation', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-mcp-row[data-server="github"] .settings-mcp-delete'));
      expect(mocks.mcpRemove).not.toHaveBeenCalled();
      expect(byText(container, '确认删除')).toBeTruthy();

      await fireClick(byText(container, '确认删除'));

      expect(mocks.mcpRemove).toHaveBeenCalledWith('github');
      expect(container.querySelector('.settings-mcp-row[data-server="github"]')).toBeNull();
    });

    it('expands a server row and shows tool count from mcp.test', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-expand'));

      expect(mocks.mcpTest).toHaveBeenCalledWith(SERVERS[0]);
      expect(byText(container, '可用工具 3 个')).toBeTruthy();
      expect(byText(container, '默认启用全部工具')).toBeTruthy();
    });

    it('expanded row lists tools as checkboxes, all checked by default (empty whitelist)', async () => {
      mocks.mcpTest.mockResolvedValue({ ok: true, toolCount: 3, tools: TOOLS });
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-expand'));

      const boxes = container.querySelectorAll<HTMLInputElement>('.settings-mcp-tool__checkbox');
      expect(boxes.length).toBe(3);
      expect([...boxes].map((b) => b.checked)).toEqual([true, true, true]);
      expect(byText(container, 'read')).toBeTruthy();
      expect(byText(container, 'write')).toBeTruthy();
      expect(byText(container, 'list')).toBeTruthy();
    });

    it('unchecking a tool persists the whitelist via mcp.update', async () => {
      mocks.mcpTest.mockResolvedValue({ ok: true, toolCount: 3, tools: TOOLS });
      const onChanged = vi.fn();
      const { container } = await render(<SettingsSkillsPanel onChanged={onChanged} />);
      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-expand'));

      await fireCheckboxToggle(
        container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-tool__checkbox'),
      );

      expect(mocks.mcpUpdate).toHaveBeenCalledWith('filesystem', { tools: ['write', 'list'] });
      expect(onChanged).toHaveBeenCalled();
      const boxes = container.querySelectorAll<HTMLInputElement>('.settings-mcp-tool__checkbox');
      expect(boxes[0]!.checked).toBe(false);
      expect(boxes[1]!.checked).toBe(true);
      expect(boxes[2]!.checked).toBe(true);
    });

    it('re-checking every tool stores an empty whitelist (default enable all)', async () => {
      mocks.mcpTest.mockResolvedValue({ ok: true, toolCount: 3, tools: TOOLS });
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-expand'));

      await fireCheckboxToggle(
        container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-tool__checkbox'),
      );
      await fireCheckboxToggle(
        container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-tool__checkbox'),
      );

      expect(mocks.mcpUpdate).toHaveBeenLastCalledWith('filesystem', { tools: [] });
    });

    it('re-shows an existing whitelist when expanding a server with tools set', async () => {
      mocks.mcpTest.mockResolvedValue({ ok: true, toolCount: 3, tools: TOOLS });
      mocks.mcpList.mockResolvedValue([
        { ...SERVERS[0]!, tools: ['read'] },
        SERVERS[1],
      ]);
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-row[data-server="filesystem"] .settings-mcp-expand'));

      const boxes = container.querySelectorAll<HTMLInputElement>('.settings-mcp-tool__checkbox');
      expect([...boxes].map((b) => b.checked)).toEqual([true, false, false]);
    });
  });

  describe('MCP 添加表单', () => {
    it('opens the add form and switches between stdio and http fields', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);

      await fireClick(container.querySelector('.settings-mcp-add-trigger'));

      expect(container.querySelector('.settings-mcp-form')).toBeTruthy();
      expect(container.querySelector('.settings-mcp-field-command')).toBeTruthy();
      expect(container.querySelector('.settings-mcp-field-args')).toBeTruthy();
      expect(container.querySelector('.settings-mcp-field-url')).toBeNull();

      await fireChange(container.querySelector('.settings-mcp-transport'), 'http');

      expect(container.querySelector('.settings-mcp-field-command')).toBeNull();
      expect(container.querySelector('.settings-mcp-field-args')).toBeNull();
      expect(container.querySelector('.settings-mcp-field-url')).toBeTruthy();

      await fireChange(container.querySelector('.settings-mcp-transport'), 'stdio');
      expect(container.querySelector('.settings-mcp-field-command')).toBeTruthy();
      expect(container.querySelector('.settings-mcp-field-url')).toBeNull();
    });

    it('tests the connection and shows ok with toolCount', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-add-trigger'));

      await fireInput(container.querySelector('.settings-mcp-field-name input'), '文件系统');
      await fireInput(container.querySelector('.settings-mcp-field-command input'), 'npx');
      await fireInput(container.querySelector('.settings-mcp-field-args input'), '-y @modelcontextprotocol/server-filesystem');

      await fireClick(container.querySelector('.settings-mcp-test'));

      expect(mocks.mcpTest).toHaveBeenCalledTimes(1);
      const cfg = mocks.mcpTest.mock.calls[0]![0] as McpServerConfig;
      expect(cfg.name).toBe('文件系统');
      expect(cfg.transport).toBe('stdio');
      expect(cfg.command).toBe('npx');
      expect(byText(container, '连接成功')).toBeTruthy();
      expect(byText(container, '可用工具 3 个')).toBeTruthy();
    });

    it('shows the error from a failed test connection', async () => {
      mocks.mcpTest.mockResolvedValue({ ok: false, error: '连接被拒绝' });
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-add-trigger'));
      await fireChange(container.querySelector('.settings-mcp-transport'), 'http');
      await fireInput(container.querySelector('.settings-mcp-field-name input'), '失败服务器');
      await fireInput(container.querySelector('.settings-mcp-field-url input'), 'http://127.0.0.1:9999/mcp');

      await fireClick(container.querySelector('.settings-mcp-test'));

      expect(byText(container, '连接失败')).toBeTruthy();
      expect(byText(container, '连接被拒绝')).toBeTruthy();
    });

    it('clears the stale test result when form fields change', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-add-trigger'));
      await fireInput(container.querySelector('.settings-mcp-field-name input'), '文件系统');
      await fireInput(container.querySelector('.settings-mcp-field-command input'), 'npx');

      await fireClick(container.querySelector('.settings-mcp-test'));
      expect(byText(container, '连接成功')).toBeTruthy();

      await fireInput(container.querySelector('.settings-mcp-field-command input'), 'node');
      expect(byText(container, '连接成功')).toBeNull();

      await fireClick(container.querySelector('.settings-mcp-test'));
      expect(byText(container, '连接成功')).toBeTruthy();

      await fireChange(container.querySelector('.settings-mcp-transport'), 'http');
      expect(byText(container, '连接成功')).toBeNull();
    });

    it('saves a stdio server via mcp.add with id, name, command and args', async () => {
      const onChanged = vi.fn();
      const { container } = await render(<SettingsSkillsPanel onChanged={onChanged} />);
      await fireClick(container.querySelector('.settings-mcp-add-trigger'));

      await fireInput(container.querySelector('.settings-mcp-field-name input'), '文件系统');
      await fireInput(container.querySelector('.settings-mcp-field-command input'), 'npx');
      await fireInput(container.querySelector('.settings-mcp-field-args input'), '-y @modelcontextprotocol/server-filesystem');

      await fireClick(container.querySelector('.settings-mcp-save'));

      expect(mocks.mcpAdd).toHaveBeenCalledTimes(1);
      const cfg = mocks.mcpAdd.mock.calls[0]![0] as McpServerConfig;
      expect(cfg.name).toBe('文件系统');
      expect(cfg.transport).toBe('stdio');
      expect(cfg.command).toBe('npx');
      expect(cfg.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem']);
      expect(cfg.enabled).toBe(true);
      expect(cfg.id.length).toBeGreaterThan(0);
      expect(onChanged).toHaveBeenCalled();
    });

    it('saves an http server via mcp.add with url', async () => {
      const { container } = await render(<SettingsSkillsPanel onChanged={vi.fn()} />);
      await fireClick(container.querySelector('.settings-mcp-add-trigger'));
      await fireChange(container.querySelector('.settings-mcp-transport'), 'http');

      await fireInput(container.querySelector('.settings-mcp-field-name input'), 'GitHub API');
      await fireInput(container.querySelector('.settings-mcp-field-url input'), 'https://mcp.example.com/github');

      await fireClick(container.querySelector('.settings-mcp-save'));

      const cfg = mocks.mcpAdd.mock.calls[0]![0] as McpServerConfig;
      expect(cfg.transport).toBe('http');
      expect(cfg.url).toBe('https://mcp.example.com/github');
      expect(cfg.command).toBeUndefined();
    });
  });
});
