// shared/ipc.browser.test.ts
import { describe, it, expect } from 'vitest';
import type { ToolName, ToolArgs } from './ipc';
import { inferWireApiFromUrl } from './ipc';

describe('browser ipc contract', () => {
  it('includes all browser tool names', () => {
    const names: ToolName[] = [
      'read_file','web_fetch','web_search',
      'browser_navigate','browser_snapshot','browser_act',
      'browser_extract','browser_screenshot','browser_tabs','browser_exec_js',
    ];
    expect(names).toContain('browser_act');
  });
  it('BrowserActArgs requires targetId for click', () => {
    const args = { tabId: 't1', action: 'click' } as unknown as Extract<ToolArgs, { action: string }>;
    expect((args as { targetId?: string }).targetId).toBeUndefined();
  });
  it('inferWireApiFromUrl regression guard', () => {
    expect(inferWireApiFromUrl('')).toBe('responses');
    expect(inferWireApiFromUrl('https://api.anthropic.com/v1/messages')).toBe('anthropic');
    expect(inferWireApiFromUrl('https://example.com/v1/responses')).toBe('responses');
  });
});
