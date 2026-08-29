import type { McpToolInfo, OpenAITool } from '../../shared/ipc';

/** 工具 schema 序列化后的最大字节数；超限时降级为宽松 object schema（防挤占上下文） */
const MAX_SCHEMA_BYTES = 4096;

export function mcpToolToOpenAITool(serverId: string, info: McpToolInfo): OpenAITool {
  const schema = (info.inputSchema ?? { type: 'object' }) as Record<string, unknown>;
  let parameters = schema;
  try {
    if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) {
      parameters = { type: 'object' };
    }
  } catch {
    parameters = { type: 'object' };
  }
  return {
    type: 'function',
    function: {
      name: `mcp__${serverId}__${info.name}`,
      // 空描述兜底：无描述的工具模型可能忽略，给一个可读的默认描述
      description: info.description?.trim() || `工具 ${info.name}（来自 MCP 服务器 ${serverId}）`,
      parameters,
    },
  };
}

export function parseMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
  if (!fullName.startsWith('mcp__')) return null;
  const parts = fullName.split('__');
  if (parts.length < 3) return null;
  const serverId = parts[1];
  const toolName = parts.slice(2).join('__');
  if (!serverId || !toolName) return null;
  return { serverId, toolName };
}
