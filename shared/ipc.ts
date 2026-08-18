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
  | 'deepseek-v4-pro'
  | 'kimi-k3'
  | 'minimax-m3'
  | 'custom';

export interface ModelPreset {
  id: PresetModelId;
  label: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
  /** 模型上下文窗口（token 数），默认 256000；用户在 onboarding / settings 选 256K/512K/1M */
  contextWindow?: number;
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
    | 'subagent_summary';
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
  /** 子代理相关事件（subagent_start / subagent_progress / subagent_done / subagent_summary） */
  subagentId?: string;
  subagentTask?: string;
  subagentTool?: string;
  subagentOk?: boolean;
  subagentSummary?: string;
  subagentElapsedMs?: number;
  subagentResults?: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }>;
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
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'search_files'
  | 'search_content'
  | 'search_symbol'
  | 'list_files'
  | 'web_fetch'
  | 'task_complete'
  | 'git_status'
  | 'git_diff'
  | 'git_log'
  | 'memory_search'
  | 'memory_save'
  | 'dispatch_subagents';

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

export interface TaskCompleteArgs {
  summary?: string;
}

/** 单个子代理任务定义（dispatch_subagents 的 subagents 数组项） */
export interface SubagentDef {
  id: string;
  task: string;
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
}

export interface SessionSummary {
  id: string;
  title: string;
  modelId: string;
  projectId?: string;
  workDir?: string;
  messageCount: number;
  updatedAt: number;
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
  kind: 'fact' | 'preference' | 'decision' | 'codebase' | 'requirement' | 'meeting';
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

export type ThemeName = 'light' | 'dark' | 'system';

export interface AppSettings {
  workDirDefault?: string;
  /** 用户自定义的快捷键覆盖（action → binding 字符串） */
  shortcuts?: Partial<Record<string, string>>;
  /** 主题：light / dark / system（跟随系统 prefers-color-scheme） */
  theme?: ThemeName;
  /** 工作区模式：sidebar（紧凑 sidebar）或 tabs（Tab 栏） */
  workspaceMode?: 'sidebar' | 'tabs';
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
  modelId: string;
  workDir?: string;
  title?: string;
  projectId?: string;
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
// electronAPI 接口（preload 暴露给渲染进程）
// ============================================

export interface ElectronAPI {
  app: {
    getInfo: () => Promise<AppInfo>;
    /** 监听设置变更广播 */
    onSettingsChanged: (callback: () => void) => () => void;
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
  tools: {
    /** 直接调一个 tool（不通过 LLM，用于开发期 / 测试） */
    invoke: (name: ToolName, args: ToolArgs) => Promise<ToolResult>;
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
    get: (id: string) => Promise<{ session: Session; messages: MessageRow[] }>;
    create: (args: CreateSessionArgs) => Promise<Session>;
    delete: (id: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<void>;
    saveMessages: (id: string, messages: MessageRow[]) => Promise<void>;
    appendMessage: (id: string, message: MessageRow) => Promise<void>;
    move: (sessionId: string, projectId: string | null) => Promise<void>;
  };
  fs: {
    listTree: (cwd: string, maxDepth?: number) => Promise<FsNode>;
    readFile: (workDir: string, path: string, maxBytes?: number) => Promise<{ content: string; size: number; truncated: boolean }>;
    openPath: (workDir: string, path: string) => Promise<boolean>;
    createFile: (workDir: string, relativePath: string) => Promise<{ path: string }>;
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
}

/** 原生菜单（macOS）触发的动作，渲染层据此打开对应界面 */
export type MenuAction = 'open-settings' | 'open-command-palette' | 'new-session';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
