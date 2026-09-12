/**
 * Stellara Work IPC 接口定义
 *
 * 主进程和渲染进程通过这个接口通信。
 * 渲染进程通过 `window.electronAPI` 拿到这个对象（preload 暴露）。
 *
 * 设计原则：
 * 1. 渲染进程拿不到原始 API key（key 永远在主进程）
 * 2. 渲染进程不能直接调 fs/shell（必须走 IPC）
 * 3. 所有危险操作（写文件、shell 执行）走 approve 流程
 */

export {
  CONTEXT_WINDOW_OPTIONS,
  DEFAULT_CONTEXT_WINDOW,
  defaultThresholdTokens,
} from './context-window';
export type { ContextWindowValue } from './context-window';

// ============================================
// 模型相关
// ============================================

export type PresetModelId =
  | 'glm-5.2'
  | 'glm-5.3'
  | 'deepseek-v4-pro'
  | 'deepseek-v4-flash'
  | 'kimi-k3'
  | 'minimax-m3'
  | 'qwen3.8-max'
  | 'custom';

/** v0.9.2 支持的供应商传输协议。OpenAI Chat Completions 已移除。 */
export type WireApi = 'responses' | 'anthropic';

export interface ModelPreset {
  id: PresetModelId;
  label: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
  /** 模型上下文窗口（token 数），默认 256000；用户在 onboarding / settings 选 256K/512K/1M */
  contextWindow?: number;
  // v0.9.2 新增：Responses API 相关（可选，兼容旧代码）
  /** 协议类型：内置模型固定 Responses；自定义模型可选 Anthropic。 */
  wireApi?: WireApi;
  /** Responses 兼容状态 */
  compatibility?: 'verified' | 'unverified' | 'incompatible';
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** reasoning effort */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
}

export interface ModelConfig extends ModelPreset {
  apiKey: string;
  /** 工作目录（agent 在这里读/写文件） */
  workDir?: string;
}

/**
 * models:list 返回的已配置模型视图。
 * 刻意不含 apiKey —— 渲染进程永远拿不到原始 key（key 只在主进程）。
 * hasKey 告知 UI 是否已配置密钥（Onboarding 据此允许留空保留旧 key）。
 */
export type ConfiguredModel = Omit<ModelConfig, 'apiKey'> & { hasKey: boolean };

export interface ModelListResponse {
  presets: ModelPreset[];
  configured: ConfiguredModel | null;
}

// ============================================
// Chat 相关
// ============================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** tool_calls 由 assistant 发出 */
  tool_calls?: ToolCall[];
  /** tool_call_id 关联 assistant.tool_calls */
  tool_call_id?: string;
  name?: string;
  /** 用户消息附带的附件元数据（图片/文件） */
  attachments?: AttachmentMeta[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** 所属会话。主进程依此锁定模型和工作目录。 */
  sessionId: string;
  /** plan 模式只暴露只读工具 */
  planMode?: boolean;
  /** 危险工具等待用户批准的毫秒数，默认 60000（超时默认拒绝） */
  approvalTimeoutMs?: number;
  /** 本次发送附带的附件元数据（Agent 提示词注入附件说明） */
  attachments?: AttachmentMeta[];
  /** /skill 精确调用：技能名称（或文件名）。主进程在 workDir/skills 中查找并注入正文。 */
  activeSkillName?: string;
  /** 远端 server 会话的模型覆盖（由 Plan 2B 传入；本地路径忽略） */
  serverModel?: { providerID: string; modelID: string };
  /** 远端 server 会话的 agent 覆盖（由 Plan 2B 传入；本地路径忽略） */
  serverAgent?: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: string;
  toolCallId: string;
}

export interface PlanApprovalRequest {
  id: string;
  plan: string[];
}

/** API usage 信息（estimated=true 表示来自本地估算而非 provider 上报） */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

export interface ChatStreamEvent {
  type:
    | 'content'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'done'
    | 'plan'
    | 'plan_ready'
    | 'plan_progress'
    | 'approval_required'
    | 'plan_approval_required'
    | 'summary'
    | 'verify'
    | 'task_complete'
    | 'memory_context'
    | 'usage'
    | 'subagent_start'
    | 'subagent_progress'
    | 'subagent_done'
    | 'subagent_summary'
    // Responses API 新增事件类型
    | 'context_checkpoint'
    | 'context_compacted'
    | 'file_revision_changed'
    | 'evidence_stale'
    | 'subagent_conflict'
    // Context Hub 事件
    | 'context_revision'
    | 'context_usage'
    // AI 浏览器事件
    | 'browser_navigate'
    | 'browser_snapshot'
    | 'browser_screenshot';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; toolCallId?: string; result: unknown };
  error?: string;
  /** 错误分类 + 引导（替代裸报错） */
  errorMeta?: ErrorMeta;
  /** 本次任务注入的相关记忆（memory_context 事件） */
  memories?: { kind: string; content: string; importance: number; source?: string }[];
  plan?: string[];
  /** Plan 步骤进度（plan_progress 事件） */
  planSteps?: { description: string; status: string }[];
  /** 验证/反思阶段标记 */
  phase?: string;
  /** 验证目标（文件路径 / 提示文本） */
  target?: string;
  approval?: ApprovalRequest;
  /** 计划批准请求（plan_approval_required 事件） */
  planApproval?: PlanApprovalRequest;
  /** 上下文压缩提示 */
  tokensBefore?: number;
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
  /** 本次 LLM 调用的 token 用量（usage 事件） */
  usage?: UsageInfo;
  /** 会话累计用量（由调用方汇总） */
  totals?: { promptTokens: number; completionTokens: number };
  /** 会话内各工具调用次数（由调用方汇总） */
  toolCounts?: Record<string, number>;
  /** Context Hub 的可序列化视图；UI 只展示，不自行推断门禁。 */
  contextState?: ContextStateView;
  /** 子代理相关事件（subagent_start / subagent_progress / subagent_done / subagent_summary） */
  subagentId?: string;
  subagentTask?: string;
  subagentTool?: string;
  subagentOk?: boolean;
  subagentSummary?: string;
  subagentElapsedMs?: number;
  subagentResults?: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>;
  // Responses API 新增：上下文版本和证据字段
  /** 当前上下文版本（Context Hub 递增） */
  contextRevision?: number;
  /** 当前工作区版本（文件修改时递增） */
  workspaceRevision?: number;
  /** 关联的验证证据 ID 列表 */
  evidenceIds?: string[];
  /** 关联的 Plan step ID 列表 */
  planStepIds?: string[];
  /** 子代理关联的上下文版本（stale 检查用） */
  subagentContextRevision?: number;
  subagentRole?: 'research' | 'build' | 'verify';
  subagentModelId?: string;
  /** Context Hub 计算出的输入预算状态。 */
  contextUsage?: {
    inputUsageRatio: number;
    currentInputTokens: number;
    usableInputBudget: number;
    nearLimit: boolean;
    hardLimited: boolean;
    lastCompactedAt?: string;
  };
}

/** 错误类型 — 用于分类 + 引导文案 */
export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'quota'
  | 'model_not_found'
  | 'context_too_long'
  | 'invalid_request'
  | 'server'
  | 'network'
  | 'idle_timeout'
  | 'user_aborted'
  | 'unknown';

/** 推荐的行动按钮（前端按需渲染） */
export type ErrorAction = 'open_settings' | 'switch_model' | 'check_network' | 'retry';

export interface ErrorMeta {
  kind: ErrorKind;
  /** 中文一句话引导 */
  hint: string;
  /** 推荐的行动；undefined = 仅展示提示 */
  action?: ErrorAction;
  /** 是否值得 retry（前端可显示重试按钮） */
  retryable: boolean;
}

export interface ChatStream {
  streamId: string;
  events: AsyncIterable<ChatStreamEvent>;
}

// ============================================
// Tool 相关
// ============================================

/**
 * OpenAI 兼容协议的 function calling tool 定义
 * 主进程和渲染进程都引用，作为 IPC 契约的一部分
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolName =
  | 'read_file' | 'write_file' | 'edit_file' | 'run_command'
  | 'search_files' | 'search_content' | 'search_symbol' | 'list_files'
  | 'web_fetch' | 'web_search'
  | 'browser_navigate' | 'browser_snapshot' | 'browser_act'
  | 'browser_extract' | 'browser_screenshot' | 'browser_tabs' | 'browser_exec_js'
  | 'task_complete' | 'git_status' | 'git_diff' | 'git_log'
  | 'memory_search' | 'memory_save' | 'dispatch_subagents';

export interface ReadFileArgs {
  path: string;
  /** 起始行（1-indexed） */
  offset?: number;
  /** 最大读取行数 */
  limit?: number;
}

export interface WriteFileArgs {
  path: string;
  content: string;
  /** 是否需要用户批准（默认 true） */
  needsApproval?: boolean;
}

export interface EditFileArgs {
  path: string;
  /** 替换的文本 */
  oldText: string;
  /** 新文本 */
  newText: string;
  /** 是否替换所有匹配项（默认 false，要求恰好 1 次匹配） */
  replaceAll?: boolean;
  needsApproval?: boolean;
}

export interface RunCommandArgs {
  command: string;
  /** 超时毫秒，默认 30000 */
  timeoutMs?: number;
  /** 相对当前工作目录的子目录 */
  cwd?: string;
  /** 额外环境变量（键名需合法，禁止覆盖关键环境变量，最多 10 个） */
  env?: Record<string, string>;
  needsApproval?: boolean;
}

export interface SearchFilesArgs {
  pattern: string;
  /** 搜索根目录，默认工作目录 */
  cwd?: string;
}

export interface SearchContentArgs {
  pattern: string;
  query: string;
  caseSensitive?: boolean;
  /** 是否使用正则表达式匹配 query（默认 false） */
  regex?: boolean;
  cwd?: string;
}

export interface ListFilesArgs {
  path?: string;
  maxDepth?: number;
}

export interface WebFetchArgs {
  url: string;
  maxBytes?: number;
}

export interface WebSearchArgs { query: string; count?: number; }
export interface BrowserNavigateArgs { tabId?: string; url: string; }
export interface BrowserSnapshotArgs { tabId: string; }
export interface BrowserActArgs {
  tabId: string;
  action: 'click'|'type'|'scroll'|'select'|'hover'|'press'|'back'|'reload';
  targetId?: string; text?: string; direction?: 'up'|'down';
}
export interface BrowserExtractArgs { tabId: string; kind: 'text'|'links'|'tables'; }
export interface BrowserScreenshotArgs { tabId: string; }
export interface BrowserTabsArgs { op: 'list'|'create'|'close'|'select'; tabId?: string; url?: string; }
export interface BrowserExecJsArgs { tabId: string; js: string; }
export interface BrowserConfigView {
  searchProvider: string;
  execJsEnabled: boolean;
  hasTavilyKey: boolean;
  hasBraveKey: boolean;
  loginAllowlist: string[];
}

export interface ViewportRect { x: number; y: number; width: number; height: number; }

export interface TaskCompleteArgs {
  summary?: string;
}

/** 单个子代理任务定义（dispatch_subagents 的 subagents 数组项） */
export interface SubagentDef {
  id: string;
  task: string;
  /** 角色：research（研究）、build（构建）、verify（验证） */
  role?: 'research' | 'build' | 'verify';
  /** 模型 ID（不指定时继承主模型） */
  modelId?: string;
  /** 是否只读（research/verify 默认 true） */
  readOnly?: boolean;
  /** 文件范围（build 角色必须声明，用于冲突检测） */
  fileScopes?: string[];
  /** 期望输出描述 */
  expectedOutput?: string;
}

/** 子代理上下文结果（子→父） */
export interface SubagentContextResult {
  /** 基于的 workspace revision */
  basedOnRevision: number;
  /** 结论 */
  conclusions: string[];
  /** 读取的文件 */
  filesRead: Array<{ path: string; hash?: string }>;
  /** 修改的文件 */
  filesChanged: string[];
  /** 验证证据 */
  verification: VerificationEvidence[];
  /** 提出的决策 */
  decisionsProposed: Array<{ description: string; reason: string; relatedFiles?: string[] }>;
  /** 未解决的问题 */
  unresolved: string[];
  /** 用量 */
  usage: { promptTokens: number; completionTokens: number };
}

/** 单个子代理执行结果（汇总报告用） */
export interface SubagentResult {
  id: string;
  summary: string;
  ok: boolean;
}

export interface DispatchSubagentsArgs {
  subagents: SubagentDef[];
}

export type ToolArgs =
  | ReadFileArgs
  | WriteFileArgs
  | EditFileArgs
  | RunCommandArgs
  | SearchFilesArgs
  | SearchContentArgs
  | ListFilesArgs
  | WebFetchArgs
  | WebSearchArgs
  | BrowserNavigateArgs
  | BrowserSnapshotArgs
  | BrowserActArgs
  | BrowserExtractArgs
  | BrowserScreenshotArgs
  | BrowserTabsArgs
  | BrowserExecJsArgs
  | TaskCompleteArgs
  | DispatchSubagentsArgs;

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
  /** 给 UI 用的额外信息（diff 数据、shell 输出等） */
  meta?: ToolResultMeta;
}

export type ToolResultMeta =
  | {
      kind: 'edit';
      path: string;
      /** 改之前的内容（write_file 覆盖时为旧文件内容；edit_file 总是有） */
      before: string | null;
      /** 改之后的内容 */
      after: string;
    }
  | {
      kind: 'command';
      command: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      durationMs: number;
      /** 输出超过 5MB 时为 true（已截断） */
      outputTruncated?: boolean;
    };

// ============================================
// 窗口 / 系统相关
// ============================================

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  appDataPath: string;
  envPath: string;
}

// ============================================
// W3: 会话 / 多 provider / 设置
// ============================================

export interface Project {
  id: string;
  name: string;
  workDir?: string;
  entryFile?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workDir?: string;
  entryFile?: string;
  updatedAt: number;
  sessionCount: number;
}

export interface Session {
  id: string;
  title: string;
  modelId: string;
  workDir?: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 运行端：local（本机）或 server（远端 OpenCode server）。缺省视为 local。 */
  runtime?: 'local' | 'server';
  /** 所属服务器（runtime='server' 时） */
  serverId?: string;
  /** 远端服务器的 session id（runtime='server' 时） */
  remoteSessionId?: string;
  /** 远端服务器离线时由主进程标注 */
  offline?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  modelId: string;
  projectId?: string;
  workDir?: string;
  messageCount: number;
  updatedAt: number;
  /** 运行端：local（本机）或 server（远端 OpenCode server）。缺省视为 local。 */
  runtime?: 'local' | 'server';
  /** 所属服务器（runtime='server' 时） */
  serverId?: string;
  /** 远端服务器的 session id（runtime='server' 时） */
  remoteSessionId?: string;
  /** 远端服务器离线时由主进程标注 */
  offline?: boolean;
}

export interface MessageRow {
  sessionId: string;
  position: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: string;
  toolCallId?: string;
  toolName?: string;
  meta?: string;
  planMode?: number;
  /** attachments JSON 字符串（对应 messages.attachments 列） */
  attachments?: string;
  createdAt: number;
}

// ============================================
// Memory OS
// ============================================

export interface Memory {
  id: string;
  scope: 'personal' | 'project' | 'workspace';
  scopeId?: string;
  kind: 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting' | 'web';
  content: string;
  source?: string;
  importance: number;
  confidence: number;
  accessCount: number;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryStats {
  total: number;
  byScope: Record<string, number>;
  byKind: Record<string, number>;
  recentCount: number;
}

// ============================================
// 本地用户（Phase 1）
// ============================================

/** 本机使用者身份（不依赖云账号） */
export interface LocalUser {
  id: string;
  displayName: string;
  /** 头像文件路径（预留，Phase 1 UI 用显示名首字母） */
  avatarPath?: string;
  createdAt: number;
  updatedAt: number;
}

export type ThemeName = 'light' | 'dark' | 'system';

// ============================================
// 云账号（Phase 3 · 腾讯云 CloudBase）
// ============================================
//
// 数据边界：只同步「账号元数据」（uid / 邮箱 / 用户名 / 昵称）。
// 工作区、会话、记忆一律留在本机 —— local-first 承诺不变。
// token 永远不进入渲染进程，只在主进程内保存（secrets.ts 加密落盘）。

/** 云账号元数据（渲染层可见范围，绝不含 token） */
export interface CloudAccount {
  uid: string;
  email?: string;
  username?: string;
  /** 云端昵称 */
  displayName?: string;
  phone?: string;
}

/** 云账号整体状态 */
export interface CloudAuthState {
  /** 是否已配置 Publishable Key（开发者侧前置条件，未配置时其余操作都会失败） */
  configured: boolean;
  /** 是否存在有效的云会话（登出后为 false，但绑定关系仍保留） */
  signedIn: boolean;
  /** 当前本地身份**绑定**的云账号；未绑定为 null（登出不会清除绑定） */
  account: CloudAccount | null;
}

/** 可序列化的失败信息（IPC 友好，带中文说明与下一步建议） */
export interface CloudFailure {
  code: string;
  message: string;
  hint: string;
}

/** IPC 统一返回：成功带数据，失败带可展示错误 */
export type CloudResult<T> = { ok: true; data: T } | { ok: false; error: CloudFailure };

/**
 * 注册第一步的返回。
 * `verifyOtp` 是 SDK 返回的**函数**，无法跨 IPC，故由主进程暂存并以 pendingId 引用。
 */
export interface CloudPendingSignUp {
  pendingId: string;
  email: string;
}

/** 邮箱注册入参（CloudBase v2：注册必须走邮箱/手机验证码） */
export interface CloudSignUpArgs {
  email: string;
  password: string;
  /** 可选登录用户名（5-24 位，字母/数字开头，支持 -_.:+@ ） */
  username?: string;
  /** 可选昵称 */
  displayName?: string;
}

export interface AppSettings {
  workDirDefault?: string;
  /** 用户自定义的快捷键覆盖（action → binding 字符串） */
  shortcuts?: Partial<Record<string, string>>;
  /** 主题：light / dark / system（跟随系统 prefers-color-scheme） */
  theme?: ThemeName;
  /** 工作区模式：sidebar（紧凑 sidebar）或 tabs（Tab 栏） */
  workspaceMode?: 'sidebar' | 'tabs';
  /** 默认服务器 id（只读：仅能经 servers:setDefault 修改） */
  defaultServerId?: string | null;
  // 预留：language
}

/**
 * 诊断信息（settings:collectDiagnostics 返回）
 * 用户从 Settings → 「复制诊断信息」按钮一键复制到剪贴板，上报 bug 用
 */
export interface DiagnosticsInfo {
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  appDataPath: string;
  envPath: string;
  logPath: string;
  dbSizeBytes: number;
  sessionCount: number;
  messageCount: number;
  modelCount: number;
  activeModelId: string | null;
  modelsWithKey: string[];
  logTail: string;
  collectedAt: string;
}

export interface ModelListItem {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  workDir?: string;
  hasKey: boolean;
  isActive: boolean;
  createdAt: string;
  contextWindow?: number;
  wireApi?: WireApi;
  compatibility?: 'verified' | 'unverified' | 'incompatible';
  verifiedAt?: string;
}

export interface SkillDef {
  name: string;
  description: string;
  prompt: string;
  format?: 'md' | 'json';
  /** 缺省 true；md frontmatter `enabled: false` 时为 false（json 恒 true） */
  enabled?: boolean;
}

/** 无效技能文件的格式错误（界面标注「格式错误」用） */
export interface SkillLoadError {
  file: string;
  reason: string;
}

/** 内置技能模板信息（skills:listBuiltins 返回，UI 空状态展示用） */
export interface BuiltinSkillInfo {
  name: string;
  description: string;
}

/** listDetailed 返回的技能项：SkillDef + 相对 skills/ 的文件路径 */
export type SkillDetailedItem = SkillDef & {
  /** 相对 skills/ 的路径（如 'review/code-review.md' 或 'code-review.md'） */
  file: string;
};

/** skills:listDetailed 返回：可用技能 + 被跳过的格式错误文件 */
export interface SkillListDetailedResponse {
  items: SkillDetailedItem[];
  errors: SkillLoadError[];
}

// ============================================
// MCP 相关
// ============================================

/**
 * MCP 工具调用审批策略。
 * - always：该服务器所有工具调用都需要用户批准（默认）
 * - dangerous：仅 dangerousTools 列出的工具需要批准
 * - never：全部直接执行（风险自负）
 */
export type McpApprovalPolicy = 'always' | 'dangerous' | 'never';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  /** stdio */
  command?: string;
  /** stdio */
  args?: string[];
  /** http */
  url?: string;
  /** http 可选 */
  headers?: Record<string, string>;
  enabled: boolean;
  /** 空 = 全部 */
  tools?: string[];
  /** 工具调用审批策略；缺省 always */
  approval?: McpApprovalPolicy;
  /** approval='dangerous' 时需审批的工具名列表（不含 mcp__ 前缀） */
  dangerousTools?: string[];
  /** plan 模式下是否向 agent 暴露该服务器的工具（默认 false） */
  planVisible?: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** mcp:test 返回：连接成功时附带工具列表（白名单勾选用） */
export interface McpTestResult {
  ok: boolean;
  toolCount?: number;
  tools?: McpToolInfo[];
  error?: string;
}

export interface CreateSessionArgs {
  modelId?: string;
  workDir?: string;
  title?: string;
  projectId?: string;
  /** 运行端：local（默认）或 server */
  runtime?: 'local' | 'server';
  /** runtime='server' 时的目标服务器 id */
  serverId?: string;
  /** runtime='server' 时的模型映射，落库为 'providerID/modelID'（Plan 2B 传入） */
  serverModel?: { providerID: string; modelID: string };
}

// ============================================
// 服务器（远端 OpenCode server）
// ============================================

export type ServerRuntimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * 渲染进程可见的服务器视图。
 * 刻意不含 password 字段 —— 凭据只存在主进程（SecretStore）。
 */
export interface ServerEntry {
  id: string;
  name: string;
  url: string;
  username?: string;
  hasPassword: boolean;
  isDefault: boolean;
  createdAt: string;
  lastConnectedAt?: string;
}

export interface ServerInput {
  url: string;
  name?: string;
  username?: string;
  password?: string;
}

export interface ServerStatusEntry {
  id: string;
  status: ServerRuntimeStatus;
  error?: string;
  version?: string;
}

export interface ServerTestResult {
  ok: boolean;
  status: ServerRuntimeStatus;
  error?: string;
  version?: string;
}

export interface ServerProviderSummary {
  id: string;
  name: string;
  models: Array<{ id: string; name: string }>;
}

export interface ServerProvidersResult {
  providers: ServerProviderSummary[];
  /** 服务器默认模型（无法解析时缺省） */
  default?: { providerID: string; modelID: string };
}

export interface ServerVcsResult {
  branch: string | null;
}

export interface ServerAgentSummary {
  name: string;
  description?: string;
  mode?: string;
}

// ============================================
// W4: 文件树 / 文件预览
// ============================================

export interface FsNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  children?: FsNode[];
}

export interface ProjectFileSelection {
  path: string;
  workDir: string;
}

// ============================================
// 附件相关
// ============================================

export interface AttachmentMeta {
  /** 存储文件名（含冲突重命名的时间戳后缀），readImage/open 凭此定位附件 */
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'image' | 'file';
  /** 相对附件目录（{sessionId}/{name}，正向斜杠） */
  relPath: string;
}

// ============================================
// Context Hub 相关（Responses API）
// ============================================

/** 验证证据类型 */
export type VerificationKind = 'file_reread' | 'typecheck' | 'test' | 'build' | 'manual';

/** 验证证据 */
export interface VerificationEvidence {
  id: string;
  kind: VerificationKind;
  command?: string;
  relatedFiles: string[];
  planStepIds: string[];
  workspaceRevision: number;
  ok: boolean;
  summary: string;
  createdAt: string;
}

/** Context Checkpoint（压缩后保存的结构化状态） */
export interface ContextCheckpoint {
  id: string;
  sessionId: string;
  contextRevision: number;
  workspaceRevision: number;
  objective: string;
  constraints: string[];
  decisions: string[];
  filesChanged: string[];
  verification: string[];
  failures: string[];
  planState: { id: string; description: string; status: string }[];
  pendingWork: string[];
  createdAt: string;
}

/** Context 事件类型 */
export type ContextEventType =
  | 'user_message_added'
  | 'plan_created'
  | 'plan_step_changed'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'approval_requested'
  | 'approval_resolved'
  | 'file_read'
  | 'file_modified'
  | 'command_completed'
  | 'verification_completed'
  | 'subagent_started'
  | 'subagent_completed'
  | 'memory_injected'
  | 'context_compacted'
  | 'checkpoint_created';

/** Context 事件信封 */
export interface ContextEventEnvelope {
  id: string;
  sessionId: string;
  sequence: number;
  contextRevision: number;
  workspaceRevision: number;
  sourceAgentId: string;
  createdAt: string;
  event: ContextEventType;
  /** 事件附加数据（序列化存储） */
  data?: unknown;
}

/** Context 使用量统计 */
export interface ContextUsage {
  /** 输入 token 使用百分比（0-1） */
  inputUsageRatio: number;
  /** 软阈值百分比 */
  softThreshold: number;
  /** 硬阈值百分比 */
  hardThreshold: number;
  /** 当前是否达到软阈值 */
  nearLimit: boolean;
  /** 当前是否达到硬阈值 */
  hardLimited: boolean;
  /** 当前输入 token 数 */
  currentInputTokens: number;
  /** 可用输入预算 */
  usableInputBudget: number;
  /** 上次压缩时间 */
  lastCompactedAt?: string;
}

/** 渲染层可安全消费的 Context Hub 快照。 */
export interface ContextStateView {
  sessionId: string;
  revision: number;
  workspaceRevision: number;
  objective: string;
  planSteps: Array<{ id: string; description: string; status: string }>;
  usage: ContextUsage;
  checkpoint: ContextCheckpoint | null;
  modifiedFiles: string[];
  unverifiedFiles: string[];
  staleEvidence: Array<{ id: string; summary: string }>;
  taskGate: { ok: boolean; reasons: string[] };
  subagents: Array<{
    id: string;
    task: string;
    role: 'research' | 'build' | 'verify';
    modelId?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    contextRevision: number;
    workspaceRevision: number;
    resultSummary?: string;
  }>;
}

/** 文件修改证据 */
export interface FileModificationEvidence {
  filePath: string;
  toolCallId?: string;
  agentId: string;
  planStepId?: string;
  workspaceRevision: number;
  /** 文件内容哈希 */
  contentHash?: string;
  createdAt: string;
}

// ============================================
// 工具执行上下文（v0.9.2）
// ============================================

/** 工具执行上下文（关联 agent/session/revision/plan step） */
export interface ToolExecutionContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 当前 agent ID（main 或子代理 ID） */
  agentId: string;
  /** 当前上下文版本 */
  contextRevision: number;
  /** 当前工作区版本 */
  workspaceRevision: number;
  /** 关联的 Plan step ID */
  planStepId?: string;
  /** 工具调用 ID（用于关联 function_call_output） */
  toolCallId: string;
}

// ============================================
// 协议自动检测（v0.9.2）
// ============================================

/**
 * 根据 baseUrl 自动推断 wireApi 协议类型
 *
 * 规则：仅明确的 Anthropic Messages 地址推断为 anthropic，其余统一使用
 * Responses API。绝不回退到 Chat Completions。
 */
export function inferWireApiFromUrl(baseUrl: string): WireApi {
  if (!baseUrl) return 'responses';
  const lower = baseUrl.toLowerCase();
  if (lower.includes('/v1/messages') || lower.includes('/anthropic')) return 'anthropic';
  return 'responses';
}

// ============================================
// electronAPI 接口（preload 暴露给渲染进程）
// ============================================

export interface ElectronAPI {
  app: {
    getInfo: () => Promise<AppInfo>;
    getGitBranch: (workDir: string) => Promise<string | null>;
    /** 监听设置变更广播 */
    onSettingsChanged: (callback: () => void) => () => void;
    /** 当前窗口是否全屏（macOS 全屏时红绿灯隐藏，顶栏箭头需贴左） */
    isFullScreen: () => Promise<boolean>;
    /** 监听窗口全屏状态变化 */
    onFullscreenChanged: (callback: (fullscreen: boolean) => void) => () => void;
  };
  models: {
    list: () => Promise<ModelListResponse>;
    /** 列出所有已配 model（含 key 状态、活跃标志） */
    getAll: () => Promise<ModelListItem[]>;
    configure: (config: ModelConfig) => Promise<{ ok: boolean; error?: string; errorKind?: string }>;
    test: (config: ModelConfig) => Promise<{ ok: boolean; error?: string }>;
    remove: (modelId: string) => Promise<void>;
    setActive: (modelId: string) => Promise<void>;
    updateKey: (modelId: string, newKey: string) => Promise<void>;
    updateWorkDir: (modelId: string, workDir: string) => Promise<void>;
    updateContextWindow: (modelId: string, contextWindow: number) => Promise<void>;
  };
  chat: {
    /** 启动一个流式 chat，返回 { streamId, events } - events 是 AsyncIterable<ChatStreamEvent> */
    start: (request: ChatRequest) => Promise<ChatStream>;
    /** 中断当前 chat（通过 streamId） */
    abort: (streamId: string) => void;
    /** 回应一次批准请求（true=同意，false=拒绝） */
    approve: (approvalId: string, approved: boolean) => void;
  };
  context: {
    /** 恢复会话的结构化上下文、revision、验证门禁和最新检查点。 */
    getSnapshot: (sessionId: string) => Promise<ContextStateView>;
    /** 在当前 revision 创建一个可恢复检查点。 */
    createCheckpoint: (sessionId: string) => Promise<ContextStateView>;
  };
  tools: {
    /** 直接调一个 tool（不通过 LLM，用于开发期 / 测试） */
    invoke: (name: ToolName, args: ToolArgs) => Promise<ToolResult>;
  };
  browser: {
    list: (sessionId: string) => Promise<Array<{ id: string; url: string; title: string; active?: boolean }>>;
    getSnapshot: (sessionId: string, tabId: string) => Promise<{ markdown: string }>;
    getConfig: () => Promise<BrowserConfigView>;
    updateConfig: (partial: { searchProvider?: string; execJsEnabled?: boolean; loginAllowlist?: string[] }) => Promise<void>;
    setSearchKey: (provider: 'tavily' | 'brave', key: string) => Promise<void>;
    clearSearchKey: (provider: 'tavily' | 'brave') => Promise<void>;
    attachView: (sessionId: string, tabId: string) => Promise<void>;
    detachView: () => Promise<void>;
    setViewport: (rect: ViewportRect) => Promise<void>;
    setUserInteraction: (sessionId: string, tabId: string, enabled: boolean) => Promise<void>;
  };
  dialog: {
    /** 弹原生目录选择器，返回选中的路径（或 null 取消） */
    openDirectory: () => Promise<string | null>;
    /** 在已授权工作目录内选择单个文件（或 null 取消） */
    openFile: (workDir: string) => Promise<string | null>;
    /** 统一入口选择：文件（父目录为工作区）或文件夹（自动探测 README.md 作为可选入口文件） */
    selectProjectDir: () => Promise<{ workDir: string; entryFile?: string } | null>;
    /** 多选任意附件文件，返回绝对路径列表（或 null 取消）；校验由 attachments:add 完成 */
    openAttachmentFiles: () => Promise<string[] | null>;
    /** 拖拽 drop 的 File → 磁盘绝对路径（webUtils.getPathForFile；非本地文件返回 ''） */
    getPathForFile: (file: File) => string;
  };
  projects: {
    list: () => Promise<ProjectSummary[]>;
    create: (args: { name: string; workDir: string; entryFile?: string }) => Promise<Project>;
    delete: (id: string) => Promise<void>;
    rename: (id: string, name: string) => Promise<void>;
    updateFile: (id: string, selection: ProjectFileSelection) => Promise<Project>;
  };
  sessions: {
    list: () => Promise<SessionSummary[]>;
    /** 内容搜索：匹配标题与消息内容，返回匹配的 session id（按更新时间倒序） */
    search: (query: string) => Promise<string[]>;
    get: (id: string) => Promise<{ session: Session; messages: MessageRow[] }>;
    create: (args: CreateSessionArgs) => Promise<Session>;
    delete: (id: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<void>;
    saveMessages: (id: string, messages: MessageRow[]) => Promise<void>;
    appendMessage: (id: string, message: MessageRow) => Promise<void>;
    move: (sessionId: string, projectId: string | null) => Promise<void>;
  };
  servers: {
    list: () => Promise<ServerEntry[]>;
    add: (input: ServerInput) => Promise<ServerEntry>;
    update: (id: string, patch: Partial<ServerInput>) => Promise<ServerEntry>;
    remove: (id: string) => Promise<void>;
    test: (id: string) => Promise<ServerTestResult>;
    setDefault: (id: string | null) => Promise<void>;
    status: () => Promise<ServerStatusEntry[]>;
    /** 手动连接/重连（幂等）：初始健康检查失败后的恢复入口 */
    connect: (id: string) => Promise<ServerStatusEntry>;
    providers: (id: string) => Promise<ServerProvidersResult>;
    vcs: (id: string) => Promise<ServerVcsResult>;
    agents: (id: string) => Promise<ServerAgentSummary[]>;
    onStatusChanged: (callback: (statuses: ServerStatusEntry[]) => void) => () => void;
  };
  fs: {
    listTree: (cwd: string, maxDepth?: number) => Promise<FsNode>;
    readFile: (workDir: string, path: string, maxBytes?: number) => Promise<{ content: string; size: number; truncated: boolean }>;
    openPath: (workDir: string, path: string) => Promise<boolean>;
    createFile: (workDir: string, relativePath: string) => Promise<{ path: string }>;
    mkdir: (workDir: string, relativePath: string) => Promise<string>;
  };
  attachments: {
    /** 校验 + 复制到附件目录，返回附件元数据 */
    add: (sessionId: string, workDir: string, filePaths: string[]) => Promise<{ attachments: AttachmentMeta[] }>;
    /** 读取图片附件（≤5MB），返回 base64 dataUrl */
    readImage: (sessionId: string, workDir: string, id: string) => Promise<{ dataUrl: string }>;
    /** 用系统默认应用打开附件 */
    open: (sessionId: string, workDir: string, id: string) => Promise<boolean>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (partial: Partial<AppSettings>) => Promise<void>;
    clearAllData: () => Promise<void>;
    resetSelective: (level: 'sessions' | 'memories' | 'all') => Promise<{ cleared: string; count?: number } | void>;
    openDataDir: () => Promise<void>;
    openLogFile: (name: 'main' | 'renderer') => Promise<void>;
    collectDiagnostics: () => Promise<DiagnosticsInfo>;
  };
  skills: {
    list: (workDir: string) => Promise<SkillDef[]>;
    /** 含格式错误文件列表（设置面板「格式错误」标注用） */
    listDetailed: (workDir: string) => Promise<SkillListDetailedResponse>;
    /** 初始化内置技能模板到 workDir/skills/（幂等），返回实际创建的文件名列表 */
    initBuiltins: (workDir: string) => Promise<string[]>;
    /** 内置技能模板列表（名称 + 描述，UI 空状态展示） */
    listBuiltins: () => Promise<BuiltinSkillInfo[]>;
    /** 创建技能文件 skills/{name}.md（name 自动清洗非法字符），返回文件名 */
    create: (workDir: string, skill: { name: string; description: string; prompt: string }) => Promise<{ file: string }>;
    /** 更新技能文件（仅 .md；旧 .json 格式仅支持删除） */
    update: (
      workDir: string,
      file: string,
      patch: { name?: string; description?: string; prompt?: string; enabled?: boolean },
    ) => Promise<void>;
    /** 删除技能文件（.md / .json 均可） */
    delete: (workDir: string, file: string) => Promise<void>;
  };
  mcp: {
    list: () => Promise<McpServerConfig[]>;
    add: (cfg: McpServerConfig) => Promise<void>;
    update: (id: string, patch: Partial<McpServerConfig>) => Promise<void>;
    remove: (id: string) => Promise<void>;
    test: (cfg: McpServerConfig) => Promise<McpTestResult>;
  };
  memory: {
    search: (query: string, options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number }) => Promise<Memory[]>;
    list: (options?: { scope?: Memory['scope']; kind?: Memory['kind']; limit?: number; offset?: number }) => Promise<Memory[]>;
    save: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>) => Promise<Memory>;
    update: (id: string, patch: Partial<Pick<Memory, 'content' | 'importance' | 'tags'>>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    stats: () => Promise<MemoryStats>;
    /** 导出单条记忆为 .md 文件（系统保存窗口），返回路径或 null（取消） */
    exportSingle: (id: string) => Promise<{ path: string } | null>;
    /** 导出全部记忆为单个 .md 文件，返回路径与条数或 null（取消） */
    exportAll: () => Promise<{ path: string; count: number } | null>;
    /** 返回单条记忆的 Markdown 文本（渲染层写剪贴板） */
    copyMd: (id: string) => Promise<string>;
    /** 监听"会话结束后已提取记忆"事件（sessionId + 条数） */
    onExtracted: (callback: (info: { sessionId: string; count: number }) => void) => () => void;
  };
  menu: {
    /** 监听原生菜单触发的 action（macOS）。返回取消监听函数。 */
    onAction: (callback: (action: MenuAction) => void) => () => void;
  };
  auth: {
    local: {
      /** 当前激活的本地身份 */
      getCurrent: () => Promise<LocalUser>;
      /** 全部本地身份（按创建时间升序） */
      list: () => Promise<LocalUser[]>;
      /** 新建本地身份（不自动切换） */
      create: (displayName?: string) => Promise<LocalUser>;
      /** 更新当前身份（只能改自己） */
      update: (patch: { displayName?: string; avatarPath?: string | null }) => Promise<LocalUser>;
      /** 切换当前身份 */
      switch: (id: string) => Promise<LocalUser>;
    };
    cloud: {
      /** 云账号状态（是否配置 / 是否登录 / 绑定的账号） */
      getState: () => Promise<CloudAuthState>;
      /** 注册第一步：向邮箱发送验证码 */
      sendSignUpCode: (args: CloudSignUpArgs) => Promise<CloudResult<CloudPendingSignUp>>;
      /** 注册第二步：校验验证码完成注册（SDK 成功后自动登录并绑定当前本地身份） */
      verifySignUp: (args: { pendingId: string; code: string }) => Promise<CloudResult<CloudAuthState>>;
      /** 邮箱或用户名 + 密码登录 */
      signInWithPassword: (args: { identifier: string; password: string }) => Promise<CloudResult<CloudAuthState>>;
      /** 登出云账号（本地身份保留） */
      signOut: () => Promise<CloudResult<CloudAuthState>>;
      /** 解绑当前本地身份与云账号 */
      unlink: () => Promise<CloudResult<CloudAuthState>>;
      /** 用户名是否已被占用（注册前预检） */
      isUsernameRegistered: (username: string) => Promise<CloudResult<boolean>>;
    };
  };
}

/** 原生菜单（macOS）触发的动作，渲染层据此打开对应界面 */
export type MenuAction = 'open-settings' | 'open-command-palette' | 'new-session';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
