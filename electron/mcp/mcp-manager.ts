import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, saveConfig } from '../config/config-v2';
import type { McpServerConfig, McpTestResult, McpToolInfo, OpenAITool, ToolResult } from '../../shared/ipc';
import { connectMcpServer, callMcpTool } from './mcp-client';
import { mcpToolToOpenAITool, parseMcpToolName } from './mcp-tools';
import { checkMcpHttpUrl } from '../security/net-policy';
import {
  deleteMcpAuthHeaders,
  getMcpAuthHeaders,
  setMcpAuthHeaders,
} from '../config/secrets';

interface CachedConnection {
  client: Client;
  tools: McpToolInfo[];
}

/** C3：用户未确认本地 MCP 命令时的统一错误文案 */
export const MCP_COMMAND_CANCELED = '已取消：未确认 MCP 命令';

/** C3：stdio 命令确认回调（由 main.ts 接入原生 dialog，测试注入 mock） */
export type StdioCommandConfirmer = (cfg: McpServerConfig) => Promise<boolean>;

/** S9：任意 MCP（含 HTTP）增改确认；缺省 fail-closed */
export type McpServerConfirmer = (cfg: McpServerConfig) => Promise<boolean>;

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * C3+：http 传输不得携带 spawn 字段。
 * 防止“先以 http 存下 command/args（无需确认），再翻转 transport=stdio”绕过确认。
 */
function withoutSpawnFields(cfg: McpServerConfig): McpServerConfig {
  if (cfg.transport === 'stdio') return cfg;
  const sanitized = { ...cfg };
  delete sanitized.command;
  delete sanitized.args;
  return sanitized;
}

/** S8：config.json / IPC 列表只保留 header 名，明文值进密钥库 */
function stripHeaderSecrets(cfg: McpServerConfig, stored: Record<string, string> | null): McpServerConfig {
  const { headers: _headers, hasAuth: _hasAuth, headerNames: _headerNames, ...rest } = cfg;
  const names = stored ? Object.keys(stored).filter((k) => k.trim()) : [];
  const out: McpServerConfig = { ...rest };
  if (names.length > 0) {
    out.hasAuth = true;
    out.headerNames = names;
  }
  return out;
}

function headerNamesOf(headers: Record<string, string> | undefined): string[] | undefined {
  if (!headers) return undefined;
  const names = Object.keys(headers).filter((k) => k.trim());
  return names.length > 0 ? names : undefined;
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

/**
 * 请求确定未送达的建连错误：重连重试是安全的。
 * 其余失败（超时、连接已关闭等）可能发生在工具已执行之后，重试有重复副作用风险。
 */
const PRE_DELIVERY_CONNECTION_ERROR_RE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i;

function isPreDeliveryConnectionError(message: string): boolean {
  return PRE_DELIVERY_CONNECTION_ERROR_RE.test(message);
}

export class McpManager {
  private cache = new Map<string, CachedConnection>();

  // fail-closed：未接入确认器（如主进程漏接线）时一律拒绝 stdio 命令
  private confirmStdioCommand: StdioCommandConfirmer = async () => false;
  // S9：HTTP / 通用增改确认（fail-closed）
  private confirmServerChange: McpServerConfirmer = async () => false;

  setStdioCommandConfirmer(confirmer: StdioCommandConfirmer): void {
    this.confirmStdioCommand = confirmer;
  }

  setServerConfirmer(confirmer: McpServerConfirmer): void {
    this.confirmServerChange = confirmer;
  }

  private async assertStdioCommandConfirmed(cfg: McpServerConfig): Promise<void> {
    if (cfg.transport !== 'stdio') return;
    if (!(await this.confirmStdioCommand(cfg))) throw new Error(MCP_COMMAND_CANCELED);
  }

  /** S9：任意服务器增改（含 HTTP）都要原生确认 */
  private async assertServerChangeConfirmed(cfg: McpServerConfig): Promise<void> {
    if (!(await this.confirmServerChange(cfg))) throw new Error(MCP_COMMAND_CANCELED);
  }

  async listServers(): Promise<McpServerConfig[]> {
    await this.migratePlaintextHeaders();
    const cfg = await loadConfig();
    return cfg.mcpServers.map((s) => stripHeaderSecrets(s, getMcpAuthHeaders(s.id)));
  }

  /** 启动期：把历史 config.json 里的明文 headers 迁入密钥库并从配置剥离（S8） */
  private async migratePlaintextHeaders(): Promise<void> {
    const cfg = await loadConfig();
    let dirty = false;
    for (const s of cfg.mcpServers) {
      if (s.headers && Object.keys(s.headers).length > 0) {
        await setMcpAuthHeaders(s.id, s.headers);
        const cleaned = { ...s };
        delete cleaned.headers;
        cleaned.hasAuth = true;
        cleaned.headerNames = headerNamesOf(s.headers);
        cfg.mcpServers[cfg.mcpServers.indexOf(s)] = cleaned;
        dirty = true;
      }
    }
    if (dirty) await saveConfig(cfg);
  }

  async addServer(cfg: McpServerConfig): Promise<void> {
    const sanitized = withoutSpawnFields(cfg);
    const err = validationError(sanitized);
    if (err) throw new Error(err);
    if (sanitized.transport === 'http' && sanitized.url) {
      const netCheck = checkMcpHttpUrl(sanitized.url);
      if (!netCheck.ok) throw new Error(netCheck.error ?? '不允许访问受限地址');
    }
    const current = await loadConfig();
    if (current.mcpServers.some((s) => s.id === sanitized.id)) {
      throw new Error(`MCP 服务器 id 已存在: ${sanitized.id}`);
    }
    await this.assertStdioCommandConfirmed(sanitized);
    // S9：HTTP 也走原生确认（可携带 Authorization；stdio 已在上方确认则跳过重复弹窗）
    if (sanitized.transport !== 'stdio') {
      await this.assertServerChangeConfirmed(sanitized);
    }
    const headers = sanitized.headers;
    const stored = stripHeaderSecrets(sanitized, headers ?? null);
    // 先写密钥再落配置，避免「有配置无密钥」的半截状态
    if (headers && Object.keys(headers).length > 0) {
      await setMcpAuthHeaders(sanitized.id, headers);
    }
    current.mcpServers.push(stored);
    await saveConfig(current);
    this.invalidateCache();
  }

  async removeServer(id: string): Promise<void> {
    const current = await loadConfig();
    current.mcpServers = current.mcpServers.filter((s) => s.id !== id);
    await saveConfig(current);
    await deleteMcpAuthHeaders(id);
    this.invalidateCache();
  }

  async updateServer(id: string, patch: Partial<McpServerConfig>): Promise<void> {
    const current = await loadConfig();
    const idx = current.mcpServers.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`MCP 服务器不存在: ${id}`);
    const existing = current.mcpServers[idx]!;
    const merged = { ...existing, ...patch };
    const err = validationError(merged);
    if (err) throw new Error(err);
    if (merged.transport === 'http' && merged.url) {
      const netCheck = checkMcpHttpUrl(merged.url);
      if (!netCheck.ok) throw new Error(netCheck.error ?? '不允许访问受限地址');
    }
    // C3+：确认只看合并后的最终形态，而非 patch 里恰好出现的键。
    // 任何会改变 spawn 形态的补丁（transport/command/args）且最终是带命令的
    // stdio，都必须确认；http 不允许携带 spawn 字段（防止先存后翻）。
    const touchesSpawnConfig =
      hasOwn(patch, 'transport') || hasOwn(patch, 'command') || hasOwn(patch, 'args');
    if (touchesSpawnConfig && merged.transport === 'stdio' && merged.command) {
      await this.assertStdioCommandConfirmed(merged);
    } else if (
      hasOwn(patch, 'url') ||
      hasOwn(patch, 'headers') ||
      hasOwn(patch, 'approval') ||
      hasOwn(patch, 'enabled') ||
      hasOwn(patch, 'tools') ||
      hasOwn(patch, 'dangerousTools')
    ) {
      // S9：鉴权 / 审批策略 / 工具白名单变更同样需要原生确认
      await this.assertServerChangeConfirmed(merged);
    }
    // S8：headers 变更写入密钥库；显式 headers:{} 表示清除
    if (hasOwn(patch, 'headers')) {
      const next = patch.headers;
      if (next && Object.keys(next).length > 0) {
        await setMcpAuthHeaders(id, next);
      } else {
        await deleteMcpAuthHeaders(id);
      }
    }
    const storedHeaders = getMcpAuthHeaders(id);
    current.mcpServers[idx] = stripHeaderSecrets(withoutSpawnFields(merged), storedHeaders);
    await saveConfig(current);
    this.invalidateCache();
  }

  async testConnection(cfg: McpServerConfig): Promise<McpTestResult> {
    try {
      if (cfg.transport === 'http' && cfg.url) {
        const netCheck = checkMcpHttpUrl(cfg.url);
        if (!netCheck.ok) return { ok: false, error: netCheck.error ?? '不允许访问受限地址' };
      }
      await this.assertStdioCommandConfirmed(cfg);
      // S9：test 也会建立连接并拉取工具列表，HTTP 同样确认
      if (cfg.transport !== 'stdio') {
        await this.assertServerChangeConfirmed(cfg);
      }
      // 测试时优先用调用方提供的 headers，否则读密钥库（编辑已有服务器且未改头）
      const headers = cfg.headers && Object.keys(cfg.headers).length > 0
        ? cfg.headers
        : (getMcpAuthHeaders(cfg.id) ?? undefined);
      const { client, tools } = await connectMcpServer({ ...cfg, headers });
      await client.close();
      return { ok: true, toolCount: tools.length, tools };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }

  private async getEntry(serverId: string): Promise<CachedConnection> {
    const hit = this.cache.get(serverId);
    if (hit) return hit;
    const server = (await this.listServers()).find((s) => s.id === serverId);
    if (!server) throw new Error(`MCP 服务器不存在: ${serverId}`);
    // S8：明文 headers 只在主进程建连时注入
    const headers = getMcpAuthHeaders(serverId) ?? undefined;
    const entry = await connectMcpServer({ ...server, headers });
    this.cache.set(serverId, entry);
    return entry;
  }

  private invalidateFor(serverId: string): void {
    const entry = this.cache.get(serverId);
    if (!entry) return;
    void Promise.resolve(entry.client.close()).catch(() => {});
    this.cache.delete(serverId);
  }

  /**
   * 获取注入 agent 的 MCP 工具。
   * planOnly=true 时只返回 planVisible 服务器的工具（plan 模式下给 agent 做只读规划用）。
   */
  async getEnabledTools(planOnly = false): Promise<OpenAITool[]> {
    const servers = await this.listServers();
    const out: OpenAITool[] = [];
    for (const s of servers) {
      if (!s.enabled) continue;
      if (planOnly && !s.planVisible) continue;
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

  /**
   * 查询一个工具调用是否需要用户批准。
   * 非 MCP 工具（不以 mcp__ 开头）一律返回 false——内置工具的审批由
   * agent loop 的 DANGEROUS_TOOLS 单独判断，这里只负责 MCP 部分。
   * 策略：approval 缺省 always；dangerous 时仅 dangerousTools 列表内的工具需要批准。
   */
  async requiresApproval(fullName: string): Promise<boolean> {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) return false;
    const server = (await this.listServers()).find((s) => s.id === parsed.serverId);
    // 服务器不存在时调用本身会失败，无需审批
    if (!server) return false;
    const policy = server.approval ?? 'always';
    if (policy === 'never') return false;
    if (policy === 'always') return true;
    return (server.dangerousTools ?? []).includes(parsed.toolName);
  }

  async callTool(fullName: string, args: unknown): Promise<ToolResult> {
    const parsed = parseMcpToolName(fullName);
    if (!parsed) return { ok: false, output: '', error: `无效的 MCP 工具名: ${fullName}` };
    const { serverId, toolName } = parsed;
    const server = (await this.listServers()).find((s) => s.id === serverId);
    if (!server) return { ok: false, output: '', error: `MCP 服务器不存在: ${serverId}` };
    // C3：执行入口强制检查启用状态与工具白名单，禁用服务器不得建立连接
    if (server.enabled !== true) {
      return { ok: false, output: '', error: 'MCP 服务器未启用' };
    }
    if (server.tools && server.tools.length > 0 && !server.tools.includes(toolName)) {
      return { ok: false, output: '', error: '工具未授权' };
    }
    let entry: CachedConnection;
    try {
      entry = await this.getEntry(serverId);
    } catch (e) {
      return { ok: false, output: '', error: errorMessage(e) };
    }
    const result = await callMcpTool(entry.client, toolName, args);
    if (result.ok || result.error?.startsWith('MCP 工具执行错误')) return result;
    // 失败后作废缓存连接：下一次调用重建，避免复用坏连接
    this.invalidateFor(serverId);
    // 只有请求确定未送达才自动重试；超时/断流等可能已执行，重试有重复副作用风险
    if (!isPreDeliveryConnectionError(result.error ?? '')) return result;
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
