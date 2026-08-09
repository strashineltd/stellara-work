import type { McpToolInfo, OpenAITool } from '../../shared/ipc';

export function mcpToolToOpenAITool(serverId: string, info: McpToolInfo): OpenAITool {
  return {
    type: 'function',
    function: {
      name: `mcp__${serverId}__${info.name}`,
      description: info.description ?? '',
      parameters: (info.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
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
