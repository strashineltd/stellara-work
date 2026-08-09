import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, saveConfig } from '../config/config-v2';
import type { McpServerConfig, McpToolInfo, OpenAITool, ToolResult } from '../../shared/ipc';
import { connectMcpServer, callMcpTool } from './mcp-client';
import { mcpToolToOpenAITool, parseMcpToolName } from './mcp-tools';

interface CachedConnection {
  client: Client;
  tools: McpToolInfo[];
}

function validationError(cfg: McpServerConfig): string | null {
  if (!cfg.id) return 'id 必填';
  if (!cfg.name) return 'name 必填';
  if (cfg.transport === 'http') {
    if (!cfg.url || !/^https?:\/\//.test(cfg.url)) {
      return 'http 服务器需提供以 http:// 或 https:// 开头的 url';
    }
  } else if (cfg.transport === 'stdio') {
    if (!cfg.command) return 'stdio 服务器需提供 command';
  } else {
    return `不支持的 transport: ${cfg.transport}`;
  }
  return null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class McpManager {
  private cache = new Map<string, CachedConnection>();

  async listServers(): Promise<McpServerConfig[]> {
    const cfg = await loadConfig();
    return cfg.mcpServers;
  }

  async addServer(cfg: McpServerConfig): Promise<void> {
    const err = validationError(cfg);
    if (err) throw new Error(err);
    const current = await loadConfig();
    if (current.mcpServers.some((s) => s.id === cfg.id)) {
      throw new Error(`MCP 服务器 id 已存在: ${cfg.id}`);
    }
    current.mcpServers.push(cfg);
    await saveConfig(current);
    this.invalidateCache();
  }

  async removeServer(id: string): Promise<void> {
    const current = await loadConfig();
    current.mcpServers = current.mcpServers.filter((s) => s.id !== id);
    await saveConfig(current);
    this.invalidateCache();
  }

  async updateServer(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    const current = await loadConfig();
    const idx = current.mcpServers.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`MCP 服务器不存在: ${id}`);
    const merged = { ...current.mcpServers[idx]!, ...patch };
    const err = validationError(merged);
    if (err) throw new Error(err);
    current.mcpServers[idx] = merged;
    await saveConfig(current);
    this.invalidateCache();
  }

  async testConnection(cfg: McpServerConfig): Promise<{ ok: boolean; toolCount?: number; error?: string }> {
    try {
      const { client, tools } = await connectMcpServer(cfg);
      await client.close();
      return { ok: true, toolCount: tools.length };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }

  private async getEntry(serverId: string): Promise<CachedConnection> {
    const hit = this.cache.get(serverId);
    if (hit) return hit;
    const server = (await this.listServers()).find((s) => s.id === serverId);
    if (!server) throw new Error(`MCP 服务器不存在: ${serverId}`);
    const entry = await connectMcpServer(server);
    this.cache.set(serverId, entry);
    return entry;
  }

  private invalidateFor(serverId: string): void {
    const entry = this.cache.get(serverId);
    if (!entry) return;
    void Promise.resolve(entry.client.close()).catch(() => {});
    this.cache.delete(serverId);
  }

  async getEnabledTools(): Promise<OpenAITool[]> {
    const servers = await this.listServers();
    const out: OpenAITool[] = [];
    for (const s of servers) {
      if (!s.enabled) continue;
      try {
        const { tools } = await this.getEntry(s.id);
        const allowed =
          s.tools && s.tools.length > 0 ? tools.filter((t) => s.tools!.includes(t.name)) : tools;
        for (const t of allowed) out.push(mcpToolToOpenAITool(s.id, t));
      } catch {
        // 连接失败跳过该服务器
      }
    }
    return out;
  }

  async callTool(fullName: string, args: unknown): Promise<ToolResult> {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) return { ok: false, output: '', error: `无效的 MCP 工具名: ${fullName}` };
    const { serverId, toolName } = parsed;
    const server = (await this.listServers()).find((s) => s.id === serverId);
    if (!server) return { ok: false, output: '', error: `MCP 服务器不存在: ${serverId}` };
    let entry: CachedConnection;
    try {
      entry = await this.getEntry(serverId);
    } catch (e) {
      return { ok: false, output: '', error: errorMessage(e) };
    }
    const result = await callMcpTool(entry.client, toolName, args);
    if (result.ok || result.error?.startsWith('MCP 工具执行错误')) return result;
    this.invalidateFor(serverId);
    try {
      return await callMcpTool((await this.getEntry(serverId)).client, toolName, args);
    } catch (e) {
      return { ok: false, output: '', error: errorMessage(e) };
    }
  }

  invalidateCache(): void {
    for (const entry of this.cache.values()) {
      void Promise.resolve(entry.client.close()).catch(() => {});
    }
    this.cache.clear();
  }
}

export const mcpManager = new McpManager();
