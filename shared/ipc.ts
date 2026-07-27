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

export interface ModelListResponse {
  presets: ModelPreset[];
  configured: ModelConfig | null;
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
  /** plan 模式只暴露只读工具 */
  planMode?: boolean;
  /** 取消 token（AbortSignal） */
  abortSignal?: AbortSignal;
  /** 危险工具等待用户批准的毫秒数，默认 60000（超时默认拒绝） */
  approvalTimeoutMs?: number;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: string;
  toolCallId: string;
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
    | 'approval_required'
    | 'summary'
    | 'verify'
    | 'task_complete';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; toolCallId?: string; result: unknown };
  error?: string;
  /** 错误分类 + 引导（替代裸报错） */
  errorMeta?: ErrorMeta;
  plan?: string[];
  /** 验证/反思阶段标记 */
  phase?: string;
  /** 验证目标（文件路径 / 提示文本） */
  target?: string;
  approval?: ApprovalRequest;
  /** 上下文压缩提示 */
  tokensBefore?: number;
  tokensAfter?: number;
  compressedCount?: number;
  summary?: string;
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
  | 'list_files'
  | 'web_fetch'
  | 'task_complete';

export interface ReadFileArgs {
  path: string;
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
  needsApproval?: boolean;
}

export interface RunCommandArgs {
  command: string;
  /** 超时毫秒，默认 30000 */
  timeoutMs?: number;
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

export type ToolArgs =
  | ReadFileArgs
  | WriteFileArgs
  | EditFileArgs
  | RunCommandArgs
  | SearchFilesArgs
  | SearchContentArgs
  | ListFilesArgs
  | WebFetchArgs
  | TaskCompleteArgs;

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
  platform: 'win32';
  appDataPath: string;
  envPath: string;
}

// ============================================
// W3: 会话 / 多 provider / 设置
// ============================================

export interface Session {
  id: string;
  title: string;
  modelId: string;
  workDir?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  modelId: string;
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
  createdAt: number;
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
}

export interface CreateSessionArgs {
  modelId: string;
  workDir?: string;
  title?: string;
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

// ============================================
// electronAPI 接口（preload 暴露给渲染进程）
// ============================================

export interface ElectronAPI {
  app: {
    getInfo: () => Promise<AppInfo>;
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
    cancel: () => void;
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
  };
  sessions: {
    list: () => Promise<SessionSummary[]>;
    get: (id: string) => Promise<{ session: Session; messages: MessageRow[] }>;
    create: (args: CreateSessionArgs) => Promise<Session>;
    delete: (id: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<void>;
    saveMessages: (id: string, messages: MessageRow[]) => Promise<void>;
    appendMessage: (id: string, message: MessageRow) => Promise<void>;
  };
  fs: {
    listTree: (cwd: string, maxDepth?: number) => Promise<FsNode>;
    readFile: (workDir: string, path: string, maxBytes?: number) => Promise<{ content: string; size: number; truncated: boolean }>;
    openPath: (workDir: string, path: string) => Promise<boolean>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    update: (partial: Partial<AppSettings>) => Promise<void>;
    clearAllData: () => Promise<void>;
    openDataDir: () => Promise<void>;
    openLogFile: (name: 'main' | 'renderer') => Promise<void>;
    collectDiagnostics: () => Promise<DiagnosticsInfo>;
  };
  skills: {
    list: (workDir: string) => Promise<SkillDef[]>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
