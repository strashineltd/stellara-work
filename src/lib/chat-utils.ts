/**
 * MainView 用到的纯函数工具（无 React 依赖，方便单测 + 复用）
 */
import type { AttachmentMeta, ChatMessage, ChatStreamEvent, MessageRow, ToolCall, ToolResultMeta } from '../../shared/ipc';

// ============================================================================
// DisplayEntry 类型定义（也在这里导出，方便子组件 import）
// ============================================================================

export type EntryEnterMotion = 'discrete' | 'status';

export interface EntryPresentation {
  key: string;
  sessionId: string | null;
  enter?: EntryEnterMotion;
}

export type DisplayEntry = (
  | { kind: 'user'; content: string; attachments?: AttachmentMeta[] }
  | { kind: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; id: string; name: string; args: string }
  | { kind: 'tool_result'; toolCallId?: string; name: string; ok: boolean; output: string; error?: string; meta?: ToolResultMeta }
  | { kind: 'error'; message: string; meta?: import('../../shared/ipc').ErrorMeta }
  | { kind: 'summary'; tokensBefore: number; tokensAfter: number; compressedCount: number; summary: string }
  | { kind: 'report'; summary: string; files: Array<{ path: string; kind: 'write' | 'edit' }>; commands: Array<{ command: string; exitCode: number; ok: boolean }> }
  | { kind: 'plan'; steps: Array<{ description: string; status: string }> }
  | { kind: 'verify'; phase: string; target?: string }
  | { kind: 'subagent_summary'; results: Array<{ id: string; summary: string; ok: boolean; elapsedMs: number }> }
) & { presentation?: EntryPresentation };

export type PresentEntry = (entry: DisplayEntry, enter: EntryEnterMotion) => DisplayEntry;

// ============================================================================
// 字符串工具
// ============================================================================

/** 处理 Windows / POSIX 都可的 basename */
export function basename(p: string): string {
  const m = p.replace(/[\\/]+$/, '').match(/[^\\/]+$/);
  return m ? m[0] : p;
}

/** 相对时间展示（刚刚 / N 分钟前 / N 小时前 / M 月 D 日） */
export function formatRelativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 文件大小展示（B / KB / MB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 把 tool approval 的 JSON args 美化显示 */
export function prettyApprovalArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

// ============================================================================
// Stream event → DisplayEntry 累积
// ============================================================================

/**
 * 把一个流事件落到 entries 上（maintain a ref of prev entries, return new array）
 * 抽出来便于 MainView 之外测试
 */
export function applyStreamEventToEntries(
  prev: DisplayEntry[],
  ev: ChatStreamEvent,
  setPendingApproval: (req: import('../../shared/ipc').ApprovalRequest | null) => void,
  setPendingPlanApproval?: (req: import('../../shared/ipc').PlanApprovalRequest | null) => void,
  presentEntry: PresentEntry = (entry) => entry,
): DisplayEntry[] | null {
  // approval_required 不动 entries，只弹 modal
  if (ev.type === 'approval_required' && ev.approval) {
    setPendingApproval(ev.approval);
    return null;
  }
  if (ev.type === 'plan_approval_required' && ev.planApproval) {
    setPendingPlanApproval?.(ev.planApproval);
    return null;
  }
  const copy = [...prev];
  if (ev.type === 'reasoning' && ev.content) {
    // 思考过程：合并到上一个 reasoning 条目，保证"思考中"块连贯；
    // 思考显示在回复之前（当前末尾是空 assistant 时插到它前面）
    const last = copy[copy.length - 1];
    if (last && last.kind === 'reasoning') {
      copy[copy.length - 1] = { ...last, content: last.content + ev.content };
    } else if (last && last.kind === 'assistant' && !last.content) {
      copy.splice(copy.length - 1, 0, presentEntry({ kind: 'reasoning', content: ev.content }, 'status'));
    } else {
      copy.push(presentEntry({ kind: 'reasoning', content: ev.content }, 'status'));
    }
    return copy;
  }
  if (ev.type === 'content' && ev.content) {
    // 追加到最后一个 assistant 条目（中间可能有 reasoning / tool_result 等块，
    // 不能只看最后一条，否则 reasoning 之后的内容会被静默丢弃）
    for (let i = copy.length - 1; i >= 0; i--) {
      const entry = copy[i]!;
      if (entry.kind === 'assistant') {
        copy[i] = { ...entry, content: entry.content + ev.content };
        return copy;
      }
    }
    // 没有进行中的 assistant（如切换会话后的残留事件）→ 丢弃，不污染当前视图
    return copy;
  }
  if (ev.type === 'tool_call' && ev.toolCall) {
    copy.push(presentEntry({
      kind: 'tool_call',
      id: ev.toolCall.id,
      name: ev.toolCall.function.name,
      args: ev.toolCall.function.arguments,
    }, 'discrete'));
    return copy;
  }
  if (ev.type === 'tool_result' && ev.toolResult) {
    const r = ev.toolResult.result as { ok?: boolean; output?: string; error?: string; meta?: ToolResultMeta };
    copy.push(presentEntry({
      kind: 'tool_result',
      toolCallId: ev.toolResult.toolCallId,
      name: ev.toolResult.name,
      ok: r?.ok === true,
      output: r?.output ?? '',
      error: r?.error,
      meta: r?.meta,
    }, 'discrete'));
    return copy;
  }
  if (ev.type === 'error' && ev.error) {
    const errorEntry: DisplayEntry = { kind: 'error', message: ev.error, meta: ev.errorMeta };
    const last = copy[copy.length - 1];
    if (last && last.kind === 'assistant' && last.content === '' && !last.toolCalls) {
      copy[copy.length - 1] = presentEntry(errorEntry, 'status');
    } else {
      copy.push(presentEntry(errorEntry, 'status'));
    }
    return copy;
  }
  if (ev.type === 'summary') {
    copy.push(presentEntry({
      kind: 'summary',
      tokensBefore: ev.tokensBefore ?? 0,
      tokensAfter: ev.tokensAfter ?? 0,
      compressedCount: ev.compressedCount ?? 0,
      summary: ev.summary ?? '',
    }, 'discrete'));
    return copy;
  }
  if (ev.type === 'plan' && ev.plan) {
    copy.push(presentEntry({
      kind: 'plan',
      steps: ev.plan.map((s) => ({ description: s, status: 'pending' })),
    }, 'discrete'));
    return copy;
  }
  if (ev.type === 'plan_progress' && ev.planSteps) {
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i]!.kind === 'plan') {
        copy[i] = { ...(copy[i] as Extract<DisplayEntry, { kind: 'plan' }>), steps: ev.planSteps };
        break;
      }
    }
    return copy;
  }
  if (ev.type === 'verify') {
    copy.push(presentEntry({ kind: 'verify', phase: ev.phase ?? 'post_edit', target: ev.target }, 'status'));
    return copy;
  }
  if (ev.type === 'subagent_summary' && ev.subagentResults) {
    copy.push(presentEntry({ kind: 'subagent_summary', results: ev.subagentResults }, 'discrete'));
    return copy;
  }
  return copy;
}

// ============================================================================
// Session transform (DB rows ↔ entries)
// ============================================================================

function historyPresentation(row: MessageRow, suffix: string): EntryPresentation {
  return {
    key: `history:${row.sessionId}:${row.position}:${suffix}`,
    sessionId: row.sessionId,
  };
}

export function messagesToEntries(msgs: MessageRow[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      let attachments: AttachmentMeta[] | undefined;
      try { if (m.attachments) attachments = JSON.parse(m.attachments); } catch { /* ignore */ }
      const entry: DisplayEntry = { kind: 'user', content: m.content };
      entry.presentation = historyPresentation(m, 'user');
      if (attachments && attachments.length > 0) entry.attachments = attachments;
      out.push(entry);
    } else if (m.role === 'assistant') {
      let toolCalls: ToolCall[] | undefined;
      try { if (m.toolCalls) toolCalls = JSON.parse(m.toolCalls); } catch { /* ignore */ }
      // 跳过完全空的 assistant（DB 历史脏数据 / autosave 时机问题）
      if (!m.content && !toolCalls) continue;
      const assistantEntry: DisplayEntry = { kind: 'assistant', content: m.content, toolCalls };
      assistantEntry.presentation = historyPresentation(m, 'assistant');
      out.push(assistantEntry);
      if (toolCalls) {
        // 去重：DB 脏数据里同 id 可能重复（key 冲突会导致 React 渲染错乱）
        const seen = new Set<string>();
        for (const tc of toolCalls) {
          if (seen.has(tc.id)) continue;
          seen.add(tc.id);
          out.push({
            kind: 'tool_call',
            id: tc.id,
            name: tc.function.name,
            args: tc.function.arguments,
            presentation: {
              key: `${assistantEntry.presentation!.key}:tool-call:${tc.id}`,
              sessionId: m.sessionId,
            },
          });
        }
      }
    } else if (m.role === 'tool') {
      let meta: ToolResultMeta | undefined;
      try { if (m.meta) meta = JSON.parse(m.meta); } catch { /* ignore */ }
      const isError = m.content.startsWith('Error:');
      out.push({
        kind: 'tool_result',
        toolCallId: m.toolCallId,
        name: m.toolName ?? 'tool',
        ok: !isError,
        output: isError ? m.content.slice('Error:'.length).trim() : m.content,
        meta,
        presentation: historyPresentation(m, `tool-result:${m.toolCallId ?? m.toolName ?? 'tool'}`),
      });
    }
  }
  return out;
}

export function clearEntryEnterMotion(entries: DisplayEntry[]): DisplayEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (!entry.presentation?.enter) return entry;
    changed = true;
    return {
      ...entry,
      presentation: { ...entry.presentation, enter: undefined },
    };
  });
  return changed ? next : entries;
}

export function entriesToMessages(entries: DisplayEntry[], sessionId: string): MessageRow[] {
  const out: MessageRow[] = [];
  let pos = 0;
  const now = Date.now();
  for (const e of entries) {
    if (e.kind === 'user') {
      const row: MessageRow = { sessionId, position: pos++, role: 'user', content: e.content, createdAt: now };
      if (e.attachments && e.attachments.length > 0) row.attachments = JSON.stringify(e.attachments);
      out.push(row);
    } else if (e.kind === 'assistant') {
      out.push({
        sessionId,
        position: pos++,
        role: 'assistant',
        content: e.content,
        toolCalls: e.toolCalls && e.toolCalls.length > 0 ? JSON.stringify(e.toolCalls) : undefined,
        createdAt: now,
      });
    } else if (e.kind === 'tool_call') {
      // 合并到上一条 assistant 消息
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') {
        const calls: ToolCall[] = last.toolCalls ? JSON.parse(last.toolCalls) : [];
        calls.push({ id: e.id, type: 'function', function: { name: e.name, arguments: e.args } });
        last.toolCalls = JSON.stringify(calls);
      }
    } else if (e.kind === 'tool_result') {
      out.push({
        sessionId,
        position: pos++,
        role: 'tool',
        content: e.output,
        toolCallId: e.toolCallId,
        toolName: e.name,
        meta: JSON.stringify(e.meta),
        createdAt: now,
      });
    }
    // error / summary / report / tool_call 不存
  }
  return out;
}

// ============================================================================
// History → LLM messages
// ============================================================================

export function buildHistory(entries: DisplayEntry[]): ChatMessage[] {
  return entries.flatMap<ChatMessage>((e) => {
    if (e.kind === 'user') {
      const msg: ChatMessage = { role: 'user', content: e.content };
      if (e.attachments && e.attachments.length > 0) msg.attachments = e.attachments;
      return [msg];
    }
    if (e.kind === 'assistant') {
      const msg: ChatMessage = { role: 'assistant', content: e.content };
      if (e.toolCalls && e.toolCalls.length > 0) msg.tool_calls = e.toolCalls;
      return [msg];
    }
    if (e.kind === 'tool_result') {
      return [{
        role: 'tool',
        tool_call_id: e.toolCallId ?? '',
        name: e.name,
        content: e.ok ? e.output : `Error: ${e.error ?? '未知错误'}`,
      }];
    }
    return [];
  });
}

// ============================================================================
// 任务完成报告
// ============================================================================

export function generateReportFromEntries(entries: DisplayEntry[]): DisplayEntry | null {
  let lastAssistant = '';
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === 'assistant' && e.content) { lastAssistant = e.content; break; }
  }
  if (!lastAssistant) return null;

  const files: Array<{ path: string; kind: 'write' | 'edit' }> = [];
  const commands: Array<{ command: string; exitCode: number; ok: boolean }> = [];

  for (const e of entries) {
    if (e.kind === 'tool_result' && e.meta) {
      const m = e.meta;
      if (m.kind === 'edit') {
        const kind: 'write' | 'edit' = m.before === null ? 'write' : 'edit';
        if (!files.some((f) => f.path === m.path)) {
          files.push({ path: m.path, kind });
        }
      }
      if (m.kind === 'command') {
        commands.push({ command: m.command, exitCode: m.exitCode, ok: e.ok });
      }
    }
  }

  return { kind: 'report', summary: lastAssistant, files, commands };
}