import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _setConfigDir, saveConfig } from '../config/config-v2';
import type { McpServerConfig, McpToolInfo } from '../../shared/ipc';
import { connectMcpServer, callMcpTool } from './mcp-client';
import { mcpManager } from './mcp-manager';
import { mcpToolToOpenAITool, parseMcpToolName } from './mcp-tools';

const { mockClient, mockStdioTransport, mockHttpTransport } = vi.hoisted(() => ({
  mockClient: vi.fn(),
  mockStdioTransport: vi.fn(),
  mockHttpTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mockClient,
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockStdioTransport,
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mockHttpTransport,
}));

const READ_TOOL = { name: 'read', description: 'Read files', inputSchema: { type: 'object', properties: {} } };
const WRITE_TOOL = { name: 'write', description: 'Write files', inputSchema: { type: 'object', properties: {} } };

function makeClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [READ_TOOL, WRITE_TOOL] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const stdioCfg: McpServerConfig = {
  id: 's1',
  name: 'GitHub',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  enabled: true,
};

const httpCfg: McpServerConfig = {
  id: 'h1',
  name: 'Remote',
  transport: 'http',
  url: 'http://localhost:3000/mcp',
  headers: { Authorization: 'Bearer xyz' },
  enabled: true,
};

function setupClientMocks(): void {
  mockClient.mockClear();
  mockStdioTransport.mockClear();
  mockHttpTransport.mockClear();
  mockClient.mockImplementation(function () {
    return makeClient();
  });
  mockStdioTransport.mockImplementation(function (opts: unknown) {
    return { kind: 'stdio', opts };
  });
  mockHttpTransport.mockImplementation(function (url: URL, opts: unknown) {
    return { kind: 'http', url, opts };
  });
}

describe('connectMcpServer', () => {
  beforeEach(setupClientMocks);

  it('creates a Client with app identity', async () => {
    await connectMcpServer(stdioCfg);
    expect(mockClient).toHaveBeenCalledWith({ name: 'stellara-work', version: '0.9.0' });
  });

  it('stdio config creates StdioClientTransport and connects', async () => {
    const { client } = await connectMcpServer(stdioCfg);
    expect(mockStdioTransport).toHaveBeenCalledWith({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] });
    expect(mockHttpTransport).not.toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalledWith({ kind: 'stdio', opts: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] } });
    expect(client.listTools).toHaveBeenCalled();
  });

  it('stdio config works without args', async () => {
    await connectMcpServer({ id: 's2', name: 'Plain', transport: 'stdio', command: 'node', enabled: true });
    expect(mockStdioTransport).toHaveBeenCalledWith({ command: 'node', args: undefined });
  });

  it('http config creates StreamableHTTPClientTransport with url and headers', async () => {
    const { client } = await connectMcpServer(httpCfg);
    expect(mockStdioTransport).not.toHaveBeenCalled();
    expect(mockHttpTransport).toHaveBeenCalledTimes(1);
    const [urlArg, optsArg] = mockHttpTransport.mock.calls[0] as [URL, unknown];
    expect(urlArg.href).toBe('http://localhost:3000/mcp');
    expect(optsArg).toEqual({ requestInit: { headers: { Authorization: 'Bearer xyz' } } });
    expect(client.connect).toHaveBeenCalledWith({ kind: 'http', url: urlArg, opts: optsArg });
  });

  it('returns tools mapped to McpToolInfo', async () => {
    const { tools } = await connectMcpServer(stdioCfg);
    expect(tools).toEqual([
      { name: 'read', description: 'Read files', inputSchema: { type: 'object', properties: {} } },
      { name: 'write', description: 'Write files', inputSchema: { type: 'object', properties: {} } },
    ] as McpToolInfo[]);
  });
});

describe('callMcpTool', () => {
  beforeEach(setupClientMocks);

  it('calls the tool and concatenates text content', async () => {
    const client = makeClient();
    client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], isError: false });
    const res = await callMcpTool(client as never, 'read', { path: '/a' });
    expect(client.callTool).toHaveBeenCalledWith({ name: 'read', arguments: { path: '/a' } });
    expect(res).toEqual({ ok: true, output: 'a\nb' });
  });

  it('isError returns ok:false with error text', async () => {
    const client = makeClient();
    client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'permission denied' }], isError: true });
    const res = await callMcpTool(client as never, 'write', {});
    expect(res).toEqual({ ok: false, output: 'permission denied', error: 'permission denied' });
  });

  it('swallows rejected calls into ok:false', async () => {
    const client = makeClient();
    client.callTool.mockRejectedValue(new Error('boom'));
    const res = await callMcpTool(client as never, 'read', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
  });
});

describe('mcp-tools', () => {
  it('mcpToolToOpenAITool converts name and parameters', () => {
    const tool = mcpToolToOpenAITool('github', {
      name: 'search_code',
      description: 'Search code',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(tool).toEqual({
      type: 'function',
      function: {
        name: 'mcp__github__search_code',
        description: 'Search code',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    });
  });

  it('mcpToolToOpenAITool handles missing description and schema', () => {
    const tool = mcpToolToOpenAITool('srv', { name: 'ping' });
    expect(tool.function.name).toBe('mcp__srv__ping');
    expect(tool.function.description).toBe('');
    expect(tool.function.parameters).toEqual({ type: 'object' });
  });

  it('parseMcpToolName parses valid names', () => {
    expect(parseMcpToolName('mcp__github__search_code')).toEqual({ serverId: 'github', toolName: 'search_code' });
  });

  it('parseMcpToolName keeps __ inside tool name', () => {
    expect(parseMcpToolName('mcp__srv__read__file')).toEqual({ serverId: 'srv', toolName: 'read__file' });
  });

  it('parseMcpToolName returns null for invalid names', () => {
    expect(parseMcpToolName('read_file')).toBeNull();
    expect(parseMcpToolName('mcp__srv')).toBeNull();
    expect(parseMcpToolName('mcp____tool')).toBeNull();
    expect(parseMcpToolName('')).toBeNull();
  });
});

describe('McpManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stellara-mcp-'));
    _setConfigDir(tmpDir);
    mcpManager.invalidateCache();
    setupClientMocks();
  });

  afterEach(async () => {
    mcpManager.invalidateCache();
    _setConfigDir(null);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function seed(...servers: McpServerConfig[]): Promise<void> {
    await saveConfig({ activeModelId: null, models: [], app: {}, mcpServers: servers, schemaVersion: 1 });
  }

  it('listServers reads from config', async () => {
    await seed(stdioCfg, httpCfg);
    expect(await mcpManager.listServers()).toEqual([stdioCfg, httpCfg]);
  });

  describe('addServer validation', () => {
    it('adds a valid stdio server', async () => {
      await mcpManager.addServer(stdioCfg);
      expect(await mcpManager.listServers()).toEqual([stdioCfg]);
    });

    it('adds a valid http server', async () => {
      await mcpManager.addServer(httpCfg);
      expect((await mcpManager.listServers()).map((s) => s.transport)).toEqual(['http']);
    });

    it('rejects duplicate id', async () => {
      await mcpManager.addServer(stdioCfg);
      await expect(mcpManager.addServer({ ...stdioCfg })).rejects.toThrow(/已存在|重复/);
      expect(await mcpManager.listServers()).toHaveLength(1);
    });

    it('rejects missing name', async () => {
      await expect(mcpManager.addServer({ ...stdioCfg, name: '' })).rejects.toThrow(/name|名称/);
    });

    it('rejects stdio without command', async () => {
      await expect(mcpManager.addServer({ ...stdioCfg, command: undefined })).rejects.toThrow(/command/);
    });

    it('rejects http without url', async () => {
      await expect(mcpManager.addServer({ ...httpCfg, url: undefined })).rejects.toThrow(/url/);
    });

    it('rejects http url without scheme', async () => {
      await expect(mcpManager.addServer({ ...httpCfg, url: 'localhost:3000/mcp' })).rejects.toThrow(/http/);
    });

    it('rejects http url with ftp scheme', async () => {
      await expect(mcpManager.addServer({ ...httpCfg, url: 'ftp://localhost/mcp' })).rejects.toThrow(/http/);
    });
  });

  it('removeServer removes by id and tolerates missing id', async () => {
    await seed(stdioCfg);
    await mcpManager.removeServer('s1');
    expect(await mcpManager.listServers()).toEqual([]);
    await expect(mcpManager.removeServer('nope')).resolves.toBeUndefined();
  });

  describe('updateServer', () => {
    it('updates enabled and tools', async () => {
      await seed({ ...stdioCfg, enabled: false, tools: [] });
      await mcpManager.updateServer('s1', { enabled: true, tools: ['read'] });
      expect(await mcpManager.listServers()).toEqual([{ ...stdioCfg, enabled: true, tools: ['read'] }]);
    });

    it('rejects invalid merged config', async () => {
      await seed(stdioCfg);
      await expect(mcpManager.updateServer('s1', { command: '' })).rejects.toThrow(/command/);
      expect((await mcpManager.listServers())[0]?.command).toBe('npx');
    });

    it('rejects unknown id', async () => {
      await seed(stdioCfg);
      await expect(mcpManager.updateServer('nope', { enabled: true })).rejects.toThrow(/不存在/);
    });
  });

  describe('testConnection', () => {
    it('returns ok with toolCount on success and closes client', async () => {
      const res = await mcpManager.testConnection(stdioCfg);
      expect(res).toEqual({ ok: true, toolCount: 2 });
      const client = mockClient.mock.results[0]?.value;
      expect(client.close).toHaveBeenCalled();
    });

    it('returns error when connect fails', async () => {
      const bad = makeClient();
      bad.connect.mockRejectedValue(new Error('spawn ENOENT'));
      mockClient.mockImplementation(function () {
        return bad;
      });
      const res = await mcpManager.testConnection(stdioCfg);
      expect(res).toEqual({ ok: false, error: 'spawn ENOENT' });
    });

    it('returns error when listTools fails', async () => {
      const bad = makeClient();
      bad.listTools.mockRejectedValue(new Error('boom'));
      mockClient.mockImplementation(function () {
        return bad;
      });
      const res = await mcpManager.testConnection(stdioCfg);
      expect(res).toEqual({ ok: false, error: 'boom' });
    });
  });

  describe('getEnabledTools', () => {
    it('only connects enabled servers', async () => {
      await seed({ ...stdioCfg, enabled: true }, { ...httpCfg, enabled: false });
      const tools = await mcpManager.getEnabledTools();
      expect(mockClient).toHaveBeenCalledTimes(1);
      expect(tools.map((t) => t.function.name)).toEqual(['mcp__s1__read', 'mcp__s1__write']);
    });

    it('skips servers whose connection fails', async () => {
      await seed({ ...stdioCfg, id: 'bad' }, { ...stdioCfg, id: 'good' });
      const bad = makeClient();
      bad.connect.mockRejectedValue(new Error('spawn ENOENT'));
      let first = true;
      mockClient.mockImplementation(function () {
        if (first) {
          first = false;
          return bad;
        }
        return makeClient();
      });
      const tools = await mcpManager.getEnabledTools();
      expect(tools.map((t) => t.function.name)).toEqual(['mcp__good__read', 'mcp__good__write']);
    });

    it('respects server tool allowlist (empty = all)', async () => {
      await seed({ ...stdioCfg, tools: ['read'] });
      const tools = await mcpManager.getEnabledTools();
      expect(tools.map((t) => t.function.name)).toEqual(['mcp__s1__read']);
    });

    it('caches connections across calls', async () => {
      await seed(stdioCfg);
      await mcpManager.getEnabledTools();
      await mcpManager.getEnabledTools();
      expect(mockClient).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces reconnect', async () => {
      await seed(stdioCfg);
      await mcpManager.getEnabledTools();
      mcpManager.invalidateCache();
      await mcpManager.getEnabledTools();
      expect(mockClient).toHaveBeenCalledTimes(2);
    });

    it('updateServer invalidates cache and refresh reflects change', async () => {
      await seed({ ...stdioCfg, tools: ['read'] });
      expect((await mcpManager.getEnabledTools()).map((t) => t.function.name)).toEqual(['mcp__s1__read']);
      await mcpManager.updateServer('s1', { tools: ['write'] });
      expect((await mcpManager.getEnabledTools()).map((t) => t.function.name)).toEqual(['mcp__s1__write']);
      expect(mockClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('callTool', () => {
    it('invokes cached client with parsed server and tool name', async () => {
      await seed(stdioCfg);
      await mcpManager.getEnabledTools();
      const res = await mcpManager.callTool('mcp__s1__read', { path: '/a' });
      expect(res).toEqual({ ok: true, output: 'ok' });
      const client = mockClient.mock.results[0]?.value;
      expect(client.callTool).toHaveBeenCalledWith({ name: 'read', arguments: { path: '/a' } });
      expect(mockClient).toHaveBeenCalledTimes(1);
    });

    it('reconnects when cache was invalidated', async () => {
      await seed(stdioCfg);
      await mcpManager.getEnabledTools();
      mcpManager.invalidateCache();
      const res = await mcpManager.callTool('mcp__s1__read', {});
      expect(res.ok).toBe(true);
      expect(mockClient).toHaveBeenCalledTimes(2);
    });

    it('returns ok:false for malformed name', async () => {
      await seed(stdioCfg);
      const res = await mcpManager.callTool('read_file', {});
      expect(res.ok).toBe(false);
      expect(res.error).toContain('无效');
    });

    it('returns ok:false for unknown server', async () => {
      await seed(stdioCfg);
      const res = await mcpManager.callTool('mcp__nope__read', {});
      expect(res.ok).toBe(false);
      expect(res.error).toContain('nope');
    });

    it('returns ok:false when connection fails', async () => {
      await seed(stdioCfg);
      const bad = makeClient();
      bad.connect.mockRejectedValue(new Error('spawn ENOENT'));
      mockClient.mockImplementation(function () {
        return bad;
      });
      const res = await mcpManager.callTool('mcp__s1__read', {});
      expect(res.ok).toBe(false);
      expect(res.error).toBe('spawn ENOENT');
    });

    it('reconnects once when a cached client call fails', async () => {
      await seed(stdioCfg);
      const stale = makeClient();
      stale.callTool.mockRejectedValue(new Error('connection closed'));
      let calls = 0;
      mockClient.mockImplementation(function () {
        calls += 1;
        if (calls === 1) return stale;
        return makeClient();
      });
      await mcpManager.getEnabledTools();
      const res = await mcpManager.callTool('mcp__s1__read', { path: '/a' });
      expect(res).toEqual({ ok: true, output: 'ok' });
      expect(mockClient).toHaveBeenCalledTimes(2);
    });

    it('returns error when retry after stale client also fails', async () => {
      await seed(stdioCfg);
      const bad = makeClient();
      bad.callTool.mockRejectedValue(new Error('connection closed'));
      mockClient.mockImplementation(function () {
        return bad;
      });
      await mcpManager.getEnabledTools();
      const res = await mcpManager.callTool('mcp__s1__read', {});
      expect(res).toEqual({ ok: false, output: '', error: 'connection closed' });
      expect(mockClient).toHaveBeenCalledTimes(2);
    });

    it('surfaces tool errors from the server', async () => {
      await seed(stdioCfg);
      const client = makeClient();
      client.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'permission denied' }], isError: true });
      mockClient.mockImplementation(function () {
        return client;
      });
      const res = await mcpManager.callTool('mcp__s1__write', {});
      expect(res).toEqual({ ok: false, output: 'permission denied', error: 'permission denied' });
      expect(mockClient).toHaveBeenCalledTimes(1);
    });
  });
});
