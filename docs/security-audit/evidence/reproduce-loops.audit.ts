import { test, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runResponsesLoop } from '../../../electron/agent/responses-loop';
import { runAnthropicAgentLoop } from '../../../electron/agent/anthropic-loop';
import { ContextHub } from '../../../electron/context/context-hub';
import { McpManager } from '../../../electron/mcp/mcp-manager';
import { _setConfigDir, loadConfig, saveConfig } from '../../../electron/config/config-v2';
import { cloudAuth } from '../../../electron/auth/cloud-auth-manager';

const state = vi.hoisted(() => ({
  responseQueue: [] as any[],
  currentUser: 'local-A',
  tokens: new Map<string, string>(),
  links: new Map<string, any>(),
  resetCloud: vi.fn(),
}));

vi.mock('../../../electron/memory/memory-injector', () => ({
  retrieveMemoriesForInjection: async () => ({ memories: [], promptBlock: null }),
}));
vi.mock('../../../electron/llm/responses', () => ({
  ResponsesClient: class {
    async *createStream() { for (const event of state.responseQueue.shift() ?? []) yield event; }
    cancel() {}
  },
}));
vi.mock('../../../electron/cloud/cloudbase-client', () => ({
  describeCloudError: (e: any) => ({ code: 'test', message: String(e), hint: '' }),
  isCloudConfigured: () => true,
  resetCloudClient: state.resetCloud,
  getCloudAuth: () => ({ signOut: async () => {}, getUser: async () => ({ data: { user: { id: 'cloud-A' } } }) }),
}));
vi.mock('../../../electron/store/local-users', () => ({
  getCurrentLocalUser: () => ({ id: state.currentUser }),
}));
vi.mock('../../../electron/store/cloud-links', () => ({
  getLinkForLocalUser: (id: string) => state.links.get(id) ?? null,
  deleteLinkForLocalUser: (id: string) => state.links.delete(id),
  upsertCloudLink: (input: any) => state.links.set(input.localUserId, input),
}));
vi.mock('../../../electron/config/secrets', () => ({
  getCloudSecret: (name: string) => state.tokens.get(name) ?? null,
  setCloudSecret: async (name: string, value: string) => { state.tokens.set(name, value); },
  deleteCloudSecret: async (name: string) => { state.tokens.delete(name); },
  setKey: async () => {},
}));

let fixture: string;
const model = { id: 'audit', label: 'audit', model: 'audit', apiKey: 'SYNTHETIC_KEY', baseUrl: 'https://example.invalid', isCustom: true };
beforeEach(async () => {
  fixture = await fs.mkdtemp('/private/tmp/stellara-security-more-');
  _setConfigDir(fixture);
  state.responseQueue.length = 0;
});

test('Responses subagent options execute write_file with no approval callback', async () => {
  const item = { type: 'function_call', id: 'fc-audit', call_id: 'call-audit', name: 'write_file', arguments: JSON.stringify({ path: 'outside-declared-scope.txt', content: 'SYNTHETIC_WRITE' }) };
  state.responseQueue.push([
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: item.arguments },
    { type: 'response.completed', response: { id: 'response-audit', output: [item], status: 'completed' } },
  ]);
  const hub = new ContextHub('audit:build', fixture, 256000, 16384, { persist: false });
  const events = [];
  for await (const e of runResponsesLoop('synthetic build', {
    model, cwd: fixture, sessionId: 'audit', contextHub: hub, planMode: false,
    agentId: 'build', maxIterations: 1, maxToolCalls: 100, allowSubagents: false,
    rolePrompt: 'Only write permitted.txt', requireApprovalAfterLimit: true,
  })) events.push(e);
  expect(await fs.readFile(path.join(fixture, 'outside-declared-scope.txt'), 'utf8')).toBe('SYNTHETIC_WRITE');
  expect(events.some(e => e.type === 'tool_result')).toBe(true);
  hub.dispose();
});

test('Anthropic subagent options execute write_file with no approval callback', async () => {
  const hub = new ContextHub('audit:build', fixture, 256000, 16384, { persist: false });
  for await (const _ of runAnthropicAgentLoop('synthetic build', {
    model, cwd: fixture, sessionId: 'audit', contextHub: hub, planMode: false,
    agentId: 'build', maxIterations: 1, maxToolCalls: 100, allowSubagents: false,
    rolePrompt: 'Only write permitted.txt',
    client: { create: async () => ({ id: 'msg-audit', type: 'message', role: 'assistant', model: 'audit', content: [{ type: 'tool_use', id: 'tool-audit', name: 'write_file', input: { path: 'outside-declared-scope.txt', content: 'SYNTHETIC_WRITE' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }) },
  })) {}
  expect(await fs.readFile(path.join(fixture, 'outside-declared-scope.txt'), 'utf8')).toBe('SYNTHETIC_WRITE');
  hub.dispose();
});

test('MCP disabled server and excluded tool remain executable', async () => {
  const cfg = await loadConfig();
  cfg.mcpServers = [{ id: 'audit', name: 'audit', transport: 'stdio', command: 'synthetic', enabled: false, approval: 'never', tools: ['permitted'] }];
  await saveConfig(cfg);
  const manager = new McpManager();
  const called = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'SYNTHETIC_MCP_CALL' }] });
  (manager as any).cache.set('audit', { client: { callTool: called }, tools: [{ name: 'excluded' }] });
  expect(await manager.getEnabledTools()).toEqual([]);
  expect(await manager.requiresApproval('mcp__audit__excluded')).toBe(false);
  expect((await manager.callTool('mcp__audit__excluded', {})).ok).toBe(true);
  expect(called).toHaveBeenCalledWith({ name: 'excluded', arguments: {} });
});

test('cloud state remains signed in with A token after current local user changes to B', async () => {
  state.currentUser = 'local-A';
  state.tokens.set('ACCESS_TOKEN', 'SYNTHETIC_A_ACCESS');
  state.tokens.set('REFRESH_TOKEN', 'SYNTHETIC_A_REFRESH');
  state.links.set('local-A', { cloudUid: 'cloud-A' });
  state.links.set('local-B', { cloudUid: 'cloud-B' });
  expect(cloudAuth.getState().account?.uid).toBe('cloud-A');
  state.currentUser = 'local-B';
  expect(cloudAuth.getState()).toEqual({ configured: true, signedIn: true, account: { uid: 'cloud-B', email: undefined, username: undefined, displayName: undefined, phone: undefined } });
  expect(state.tokens.get('ACCESS_TOKEN')).toBe('SYNTHETIC_A_ACCESS');
  expect(state.resetCloud).not.toHaveBeenCalled();
});
