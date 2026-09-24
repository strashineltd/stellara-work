import { describe, expect, it } from 'vitest';
import { confirmDangerousTool, formatToolArgs, requiresNativeConfirm } from './tool-confirm';

describe('tool-confirm (S4)', () => {
  it('requires native confirm for high-risk tools only', () => {
    for (const name of ['write_file', 'edit_file', 'run_command', 'browser_exec_js', 'dispatch_subagents']) {
      expect(requiresNativeConfirm(name), name).toBe(true);
    }
    for (const name of ['read_file', 'web_fetch', 'memory_save', 'browser_screenshot', 'mcp__s__t']) {
      expect(requiresNativeConfirm(name), name).toBe(false);
    }
  });

  it('formats and truncates long args', () => {
    expect(formatToolArgs('{"a":1}')).toBe('{"a":1}');
    const long = 'x'.repeat(50);
    const out = formatToolArgs(long, 10);
    expect(out.startsWith('xxxxxxxxxx')).toBe(true);
    expect(out).toContain('已截断');
  });

  it('fails closed without a window', async () => {
    await expect(confirmDangerousTool(null, 'run_command', 'ls')).resolves.toBe(false);
  });

  it('fails closed when the window is destroyed', async () => {
    const win = { isDestroyed: () => true } as never;
    await expect(confirmDangerousTool(win, 'run_command', 'ls')).resolves.toBe(false);
  });
});
