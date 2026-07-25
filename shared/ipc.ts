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
}

export interface ChatStreamEvent {
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'plan';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: { name: string; toolCallId?: string; result: unknown };
  error?: string;
  plan?: string[];
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
  | 'search_files';

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

export type ToolArgs =
  | ReadFileArgs
  | WriteFileArgs
  | EditFileArgs
  | RunCommandArgs
  | SearchFilesArgs;

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

export interface AppSettings {
  workDirDefault?: string;
  // 预留：theme / language
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
    configure: (config: ModelConfig) => Promise<{ ok: boolean; error?: string }>;
    test: (config: ModelConfig) => Promise<{ ok: boolean; error?: string }>;
    remove: (modelId: string) => Promise<void>;
    setActive: (modelId: string) => Promise<void>;
    updateKey: (modelId: string, newKey: string) => Promise<void>;
    updateWorkDir: (modelId: string, workDir: string) => Promise<void>;
  };
  chat: {
    /** 启动一个流式 chat，返回 { streamId, events } - events 是 AsyncIterable<ChatStreamEvent> */
    start: (request: ChatRequest) => Promise<ChatStream>;
    cancel: () => void;
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
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
