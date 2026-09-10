/**
 * opencode 远端对象的宽容类型。
 *
 * 服务器版本可能增减字段：已知字段尽力窄化，其余通过索引签名保留，
 * 消费方（EventAdapter / message-adapter / ServerManager）负责运行时窄化。
 */

export interface RemoteTime {
  created?: number;
  updated?: number;
  completed?: number;
  [key: string]: unknown;
}

export interface RemoteSession {
  id: string;
  title?: string;
  parentID?: string;
  time?: RemoteTime;
  version?: string;
  [key: string]: unknown;
}

export interface RemoteMessageInfo {
  id: string;
  role: string;
  sessionID?: string;
  time?: RemoteTime;
  tokens?: { input?: number; output?: number; [key: string]: unknown };
  error?: unknown;
  [key: string]: unknown;
}

export interface RemoteTextPart {
  type: 'text';
  id: string;
  text: string;
  sessionID?: string;
  messageID?: string;
  [key: string]: unknown;
}

export interface RemoteReasoningPart {
  type: 'reasoning';
  id: string;
  text?: string;
  sessionID?: string;
  messageID?: string;
  [key: string]: unknown;
}

export interface RemoteToolState {
  status?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface RemoteToolPart {
  type: 'tool';
  id: string;
  callID: string;
  tool: string;
  state?: RemoteToolState;
  sessionID?: string;
  messageID?: string;
  [key: string]: unknown;
}

export interface RemoteUnknownPart {
  type: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
  [key: string]: unknown;
}

export type RemotePart = RemoteTextPart | RemoteReasoningPart | RemoteToolPart | RemoteUnknownPart;

export interface RemoteMessage {
  info: RemoteMessageInfo;
  parts?: RemotePart[];
  [key: string]: unknown;
}

export interface RemoteEvent {
  type: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RemoteProviderModel {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface RemoteProvider {
  id: string;
  name?: string;
  models?: Record<string, RemoteProviderModel>;
  [key: string]: unknown;
}

export interface RemoteAgent {
  name: string;
  description?: string;
  mode?: string;
  model?: { providerID?: string; modelID?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface RemotePath {
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
}

export interface RemoteVcs {
  branch?: string;
  [key: string]: unknown;
}
