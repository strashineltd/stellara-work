import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, McpToolInfo, ToolResult } from '../../shared/ipc';

const CONNECT_TIMEOUT_MS = 10_000;
const CLIENT_IDENTITY = { name: 'stellara-work', version: '0.9.0' };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`MCP 操作超时（${ms}ms）`)), ms);
    }),
  ]);
}

export async function connectMcpServer(
  cfg: McpServerConfig,
): Promise<{ client: Client; tools: McpToolInfo[] }> {
  const client = new Client(CLIENT_IDENTITY);
  let transport;
  if (cfg.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(cfg.url!), {
      requestInit: { headers: cfg.headers ?? {} },
    });
  } else {
    transport = new StdioClientTransport({ command: cfg.command!, args: cfg.args });
  }
  await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);
  const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS);
  return {
    client,
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  };
}

type CallToolResponse = { content?: unknown[]; isError?: boolean };

function extractText(res: CallToolResponse): string {
  const parts: string[] = [];
  for (const item of res.content ?? []) {
    const rec = item as { type?: string; text?: string };
    if (rec.type === 'text' && typeof rec.text === 'string') parts.push(rec.text);
  }
  return parts.join('\n');
}

export async function callMcpTool(client: Client, name: string, args: unknown): Promise<ToolResult> {
  try {
    const res = (await client.callTool({
      name,
      arguments: args as Record<string, unknown> | undefined,
    })) as unknown as CallToolResponse;
    const output = extractText(res);
    if (res.isError) {
      const error = output ? `MCP 工具执行错误: ${output}` : 'MCP 工具执行错误';
      return { ok: false, output, error };
    }
    return { ok: true, output };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, output: '', error: message };
  }
}
