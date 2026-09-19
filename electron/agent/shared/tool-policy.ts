/**
 * 工具审批策略（单点定义）
 *
 * 两条 agent loop（Responses / Anthropic）共用；新增危险工具或调整审批
 * 规则只改这里。MCP 查询以回调注入，避免 shared → mcp 的反向依赖。
 */

export const DANGEROUS_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'run_command',
  'web_fetch',
  'dispatch_subagents',
  'browser_act',
  'browser_exec_js',
  'browser_screenshot',
  'memory_save',
]);

/** plan（只读）模式下也必须逐次审批的敏感工具：可能读到已登录页面的内容 */
export const PLAN_MODE_SENSITIVE_TOOLS: ReadonlySet<string> = new Set([
  'browser_snapshot',
  'browser_extract',
]);

export interface ApprovalDecisionInput {
  toolName: string;
  planMode: boolean;
  forceApproval: boolean;
  /** MCP 工具的审批查询；非 mcp__ 前缀的工具不会调用它 */
  mcpRequiresApproval?: (name: string) => Promise<boolean>;
}

export async function needsApproval(input: ApprovalDecisionInput): Promise<boolean> {
  const { toolName, planMode, forceApproval, mcpRequiresApproval } = input;
  if (forceApproval) return true;
  if (DANGEROUS_TOOLS.has(toolName)) return true;
  if (planMode && PLAN_MODE_SENSITIVE_TOOLS.has(toolName)) return true;
  if (toolName.startsWith('mcp__')) {
    // fail-closed：缺少查询回调时按需要审批处理
    return mcpRequiresApproval ? await mcpRequiresApproval(toolName) : true;
  }
  return false;
}
