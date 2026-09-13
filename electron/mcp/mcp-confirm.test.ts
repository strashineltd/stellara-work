import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { McpServerConfig } from '../../shared/ipc';
import { confirmStdioMcpCommand, formatMcpCommand } from './mcp-confirm';

const { mockShowMessageBox } = vi.hoisted(() => ({ mockShowMessageBox: vi.fn() }));

vi.mock('electron', () => ({
  dialog: { showMessageBox: mockShowMessageBox },
}));

const stdioCfg: McpServerConfig = {
  id: 's1',
  name: 'GitHub',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  enabled: true,
};

const fakeWindow = {} as BrowserWindow;

beforeEach(() => {
  mockShowMessageBox.mockReset();
  mockShowMessageBox.mockResolvedValue({ response: 1 });
});

describe('confirmStdioMcpCommand', () => {
  it('shows a warning dialog on the window with the exact command and args', async () => {
    await confirmStdioMcpCommand(fakeWindow, stdioCfg);
    expect(mockShowMessageBox).toHaveBeenCalledTimes(1);
    const [target, options] = mockShowMessageBox.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(target).toBe(fakeWindow);
    expect(options.type).toBe('warning');
    expect(options.detail).toBe('npx -y @modelcontextprotocol/server-github');
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
    expect((options.buttons as string[])[0]).toBe('取消');
  });

  it('returns false when the user cancels', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    expect(await confirmStdioMcpCommand(fakeWindow, stdioCfg)).toBe(false);
  });

  it('returns true when the user confirms', async () => {
    expect(await confirmStdioMcpCommand(fakeWindow, stdioCfg)).toBe(true);
  });

  it('fails closed without a window and shows no dialog', async () => {
    expect(await confirmStdioMcpCommand(null, stdioCfg)).toBe(false);
    expect(mockShowMessageBox).not.toHaveBeenCalled();
  });
});

describe('formatMcpCommand', () => {
  it('joins command and args in one line', () => {
    expect(formatMcpCommand(stdioCfg)).toBe('npx -y @modelcontextprotocol/server-github');
  });

  it('handles a missing args list', () => {
    expect(formatMcpCommand({ ...stdioCfg, args: undefined })).toBe('npx');
  });
});
