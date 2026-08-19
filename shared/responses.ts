/**
 * Responses API 数据模型
 *
 * 定义 OpenAI Responses API 的类型，用于替代 Chat Completions。
 * 领域消息（UI 用）与网络 Items（供应商调用）分离。
 */

// ============================================
// 4.1 领域消息与协议 Items 分离
// ============================================

/** UI 展示用的会话消息（领域类型，不直接发给供应商） */
export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: import('./ipc').AttachmentMeta[];
  createdAt?: number;
}

/** Responses API 协议 Items */
export type ResponseItem =
  | ResponseMessageItem
  | ResponseReasoningItem
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem;

export interface ResponseMessageItem {
  type: 'message';
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: ResponseContentPart[];
  status?: 'completed' | 'incomplete';
}

export interface ResponseContentPart {
  type: 'output_text' | 'input_text';
  text: string;
}

export interface ResponseReasoningItem {
  type: 'reasoning';
  id?: string;
  /** reasoning item 的唯一标识 */
  item_id?: string;
  /** reasoning 文本（加密或明文） */
  content?: { type: 'reasoning_text'; text: string }[];
  /** summary 文本（部分供应商支持） */
  summary?: string[];
  encrypted_content?: string;
  status?: 'completed' | 'incomplete';
}

export interface ResponseFunctionCallItem {
  type: 'function_call';
  id?: string;
  /** 唯一标识，与 function_call_output 关联 */
  call_id: string;
  name: string;
  arguments: string;
  status?: 'completed' | 'incomplete';
}

export interface ResponseFunctionCallOutputItem {
  type: 'function_call_output';
  /** 关联 function_call.call_id */
  call_id: string;
  output: string;
  /** 部分供应商返回 */
  id?: string;
}

// ============================================
// 4.2 工具定义
// ============================================

/** Responses API 工具定义（扁平结构） */
export interface ResponseFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 跨厂商默认 false，只有 capability 明确支持时才启用 */
  strict: boolean;
}

// ============================================
// 4.3 请求模型
// ============================================

export interface CreateResponseRequest {
  model: string;
  instructions?: string;
  /** 可以是纯文本或 ResponseItems 数组 */
  input: string | ResponseItem[];
  tools?: ResponseFunctionTool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; name: string };
  stream: boolean;
  /** 固定 false，不使用供应商服务端存储 */
  store: false;
  max_output_tokens?: number;
  /** reasoning 配置 */
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
  /** 是否启用并行 Function Call（默认 true） */
  parallel_tool_calls?: boolean;
}

// ============================================
// 4.5 流式事件
// ============================================

/** Responses API 流式事件类型 */
export type ResponseStreamEventType =
  | 'response.created'
  | 'response.in_progress'
  | 'response.output_item.added'
  | 'response.output_item.done'
  | 'response.content_part.added'
  | 'response.content_part.done'
  | 'response.output_text.delta'
  | 'response.output_text.done'
  | 'response.reasoning_text.delta'
  | 'response.reasoning_text.done'
  | 'response.function_call_arguments.delta'
  | 'response.function_call_arguments.done'
  | 'response.completed'
  | 'response.incomplete'
  | 'response.failed';

/** 流式事件基础结构 */
export interface ResponseStreamEventBase {
  type: ResponseStreamEventType;
  sequence_number?: number;
}

export interface ResponseCreatedEvent extends ResponseStreamEventBase {
  type: 'response.created';
  response: ResponseObject;
}

export interface ResponseInProgressEvent extends ResponseStreamEventBase {
  type: 'response.in_progress';
  response: ResponseObject;
}

export interface ResponseOutputItemAddedEvent extends ResponseStreamEventBase {
  type: 'response.output_item.added';
  output_index: number;
  item: ResponseItem;
}

export interface ResponseOutputItemDoneEvent extends ResponseStreamEventBase {
  type: 'response.output_item.done';
  output_index: number;
  item: ResponseItem;
}

export interface ResponseContentPartAddedEvent extends ResponseStreamEventBase {
  type: 'response.content_part.added';
  output_index: number;
  content_index: number;
  part: ResponseContentPart;
}

export interface ResponseContentPartDoneEvent extends ResponseStreamEventBase {
  type: 'response.content_part.done';
  output_index: number;
  content_index: number;
  part: ResponseContentPart;
}

export interface ResponseOutputTextDeltaEvent extends ResponseStreamEventBase {
  type: 'response.output_text.delta';
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseOutputTextDoneEvent extends ResponseStreamEventBase {
  type: 'response.output_text.done';
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseReasoningTextDeltaEvent extends ResponseStreamEventBase {
  type: 'response.reasoning_text.delta';
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseReasoningTextDoneEvent extends ResponseStreamEventBase {
  type: 'response.reasoning_text.done';
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseFunctionCallArgumentsDeltaEvent extends ResponseStreamEventBase {
  type: 'response.function_call_arguments.delta';
  output_index: number;
  item_id: string;
  call_id?: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent extends ResponseStreamEventBase {
  type: 'response.function_call_arguments.done';
  output_index: number;
  item_id: string;
  call_id?: string;
  arguments: string;
}

export interface ResponseCompletedEvent extends ResponseStreamEventBase {
  type: 'response.completed';
  response: ResponseObject;
}

export interface ResponseIncompleteEvent extends ResponseStreamEventBase {
  type: 'response.incomplete';
  response: ResponseObject;
  /** 截断原因 */
  incomplete_details?: { reason?: string };
}

export interface ResponseFailedEvent extends ResponseStreamEventBase {
  type: 'response.failed';
  response: ResponseObject;
  error?: { type: string; message: string; code?: string };
}

/** 所有流式事件的联合类型 */
export type ResponseStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseReasoningTextDeltaEvent
  | ResponseReasoningTextDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseCompletedEvent
  | ResponseIncompleteEvent
  | ResponseFailedEvent;

// ============================================
// Response 对象（非流式/最终结果）
// ============================================

export interface ResponseObject {
  id: string;
  object: 'response';
  created_at?: number;
  model: string;
  status: 'completed' | 'failed' | 'incomplete' | 'in_progress';
  output: ResponseItem[];
  usage?: ResponseUsage;
  incomplete_details?: { reason?: string };
  error?: { type: string; message: string; code?: string };
}

// ============================================
// Usage
// ============================================

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

// ============================================
// Provider Capability（供应商能力）
// ============================================

export interface ProviderCapability {
  /** 供应商/模型标识 */
  modelId: string;
  /** baseUrl */
  baseUrl: string;
  /** 是否支持 Responses API（已验证） */
  responsesSupported: boolean;
  /** 是否支持流式文本输出 */
  textStream: boolean;
  /** 是否支持 Function Calling */
  functionCall: boolean;
  /** 是否支持并行 Function Call */
  parallelFunctionCall: boolean;
  /** 是否支持 function_call_output 回传 */
  functionOutput: boolean;
  /** 是否返回 usage 字段 */
  usage: boolean;
  /** 是否支持 reasoning（reasoning_text.delta 事件） */
  reasoning: boolean;
  /** 是否支持取消请求 */
  abort: boolean;
  /** 是否支持 reasoning effort 参数 */
  reasoningEffort: boolean;
  /** 是否支持 strict 工具模式 */
  strictTools: boolean;
  /** 最大上下文窗口（token） */
  contextWindow?: number;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** 验证时间 */
  verifiedAt?: string;
  /** 验证错误信息（若验证失败） */
  error?: string;
}

// ============================================
// Endpoint 工具函数
// ============================================

/**
 * 构建 Responses API 端点 URL
 *
 * 规则（按计划 Section 4.4）：
 * 1. 校验非空
 * 2. 移除末尾 /
 * 3. 已以 /responses 结尾时原样返回
 * 4. 否则只追加 /responses
 * 5. 不自动补 /v1
 * 6. 不按域名硬编码
 */
export function buildResponsesUrl(baseUrl: string): string {
  if (!baseUrl || !baseUrl.trim()) {
    throw new Error('baseUrl 不能为空');
  }
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean.endsWith('/responses')) {
    return clean;
  }
  return `${clean}/responses`;
}

/**
 * 从 ResponseObject 中提取文本内容
 */
export function extractResponseText(response: ResponseObject): string {
  const parts: string[] = [];
  for (const item of response.output) {
    if (item.type === 'message' && 'content' in item) {
      for (const part of item.content) {
        if (part.type === 'output_text') {
          parts.push(part.text);
        }
      }
    }
  }
  return parts.join('');
}

/**
 * 从 ResponseObject 中提取 Function Call 项
 */
export function extractFunctionCalls(response: ResponseObject): ResponseFunctionCallItem[] {
  return response.output.filter(
    (item): item is ResponseFunctionCallItem => item.type === 'function_call',
  );
}

/**
 * 构建 function_call_output item
 */
export function buildFunctionCallOutput(callId: string, output: string): ResponseFunctionCallOutputItem {
  return { type: 'function_call_output', call_id: callId, output };
}
