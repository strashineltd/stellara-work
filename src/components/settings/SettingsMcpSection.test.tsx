import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '../../../shared/ipc';
import { SettingsMcpSection } from './SettingsMcpSection';

function installApi() {
  const mocks = {
    mcpList: vi.fn().mockResolvedValue([]),
    mcpAdd: vi.fn().mockResolvedValue(undefined),
    mcpUpdate: vi.fn().mockResolvedValue(undefined),
    mcpRemove: vi.fn().mockResolvedValue(undefined),
    mcpTest: vi.fn().mockResolvedValue({ ok: true, toolCount: 0 }),
  };
  Object.defineProperty(window, 'electronAPI', {
    value: {
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
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('SettingsMcpSection args 引号解析', () => {
  let mocks: ReturnType<typeof installApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    mocks = installApi();
  });

  it('保存时把双引号内的空格合并为一个参数', async () => {
    const { container } = await render(<SettingsMcpSection onChanged={vi.fn()} />);
    await fireClick(container.querySelector('.settings-mcp-add-trigger'));
    await fireInput(container.querySelector('#mcp-name'), '测试服务器');
    await fireInput(container.querySelector('#mcp-command'), 'npx');
    await fireInput(container.querySelector('#mcp-args'), 'npx -y "@scope/pkg with space"');
    await fireClick(container.querySelector('.settings-mcp-save'));
    expect(mocks.mcpAdd).toHaveBeenCalledWith(expect.objectContaining({
      name: '测试服务器',
      command: 'npx',
      args: ['npx', '-y', '@scope/pkg with space'],
    }));
  });

  it('支持单引号分组并忽略多余空格', async () => {
    const { container } = await render(<SettingsMcpSection onChanged={vi.fn()} />);
    await fireClick(container.querySelector('.settings-mcp-add-trigger'));
    await fireInput(container.querySelector('#mcp-name'), '单引号');
    await fireInput(container.querySelector('#mcp-command'), 'npx');
    await fireInput(container.querySelector('#mcp-args'), "-y   'two words'");
    await fireClick(container.querySelector('.settings-mcp-save'));
    expect(mocks.mcpAdd).toHaveBeenCalledWith(expect.objectContaining({
      args: ['-y', 'two words'],
    }));
  });
});
