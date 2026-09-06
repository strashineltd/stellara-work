import { describe, it, expect } from 'vitest';
import { validateActArgs, browserOpenAITools, browserPlanTools } from './browser-tools';
describe('validateActArgs', () => {
  it('rejects click without known targetId', () => {
    expect(validateActArgs({ tabId: 't', action: 'click', targetId: 'r99' }, new Set(['r1']))).toMatchObject({ ok: false });
  });
  it('plan tools exclude act/navigate/exec', () => {
    const names = browserPlanTools.map(t => t.function.name);
    expect(names).toContain('browser_snapshot');
    expect(names).not.toContain('browser_act');
    expect(names).not.toContain('browser_navigate');
    expect(names).not.toContain('browser_exec_js');
  });
  it('exposes 8 browser tools', () => expect(browserOpenAITools.map(t => t.function.name)).toContain('web_search'));
});
