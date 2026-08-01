/**
 * MainView 用到的纯函数工具（无 React 依赖，方便单测 + 复用）
 */
import type { ChatMessage, ChatStreamEvent, MessageRow, ToolCall, ToolResultMeta } from '../../shared/ipc';

// ============================================================================
// DisplayEntry 类型定义（也在这里导出，方便子组件 import）
// ============================================================================

export type DisplayEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { kind: 'tool_call'; id: string; name: string; args: string }
  | { kind: 'tool_result'; toolCallId?: string; name: string; ok: boolean; output: string; error?: string; meta?: ToolResultMeta }
  | { kind: 'error'; message: string; meta?: import('../../shared/ipc').ErrorMeta }
  | { kind: 'summary'; tokensBefore: number; tokensAfter: number; compressedCount: number; summary: string }
  | { kind: 'report'; summary: string; files: Array<{ path: string; kind: 'write' | 'edit' }>; commands: Array<{ command: string; exitCode: number; ok: boolean }> }
  | { kind: 'plan'; steps: Array<{ description: string; status: string }> }
  | { kind: 'verify'; phase: string; target?: string };

// ============================================================================
// 字符串工具
// ============================================================================

/** 处理 Windows / POSIX 都可的 basename */
export function basename(p: string): string {
  const m = p.replace(/[\\/]+$/, '').match(/[^\\/]+$/);
  return m ? m[0] : p;
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
  if (ev.type === 'content' && ev.content) {
    const last = copy[copy.length - 1];
    if (last && last.kind === 'assistant') {
      copy[copy.length - 1] = { ...last, content: last.content + ev.content };
    }
    return copy;
  }
  if (ev.type === 'tool_call' && ev.toolCall) {
    copy.push({
      kind: 'tool_call',
      id: ev.toolCall.id,
      name: ev.toolCall.function.name,
      args: ev.toolCall.function.arguments,
    });
    return copy;
  }
  if (ev.type === 'tool_result' && ev.toolResult) {
    const r = ev.toolResult.result as { ok?: boolean; output?: string; error?: string; meta?: ToolResultMeta };
    copy.push({
      kind: 'tool_result',
      toolCallId: ev.toolResult.toolCallId,
      name: ev.toolResult.name,
      ok: r?.ok === true,
      output: r?.output ?? '',
      error: r?.error,
      meta: r?.meta,
    });
    return copy;
  }
  if (ev.type === 'error' && ev.error) {
    const errorEntry: DisplayEntry = { kind: 'error', message: ev.error, meta: ev.errorMeta };
    const last = copy[copy.length - 1];
    if (last && last.kind === 'assistant' && last.content === '' && !last.toolCalls) {
      copy[copy.length - 1] = errorEntry;
    } else if (last && last.kind === 'assistant') {
      copy[copy.length - 1] = { ...last, content: last.content + `\n\n[连接错误] ${ev.error}` };
      copy.push(errorEntry);
    } else {
      copy.push(errorEntry);
    }
    return copy;
  }
  if (ev.type === 'summary') {
    copy.push({
      kind: 'summary',
      tokensBefore: ev.tokensBefore ?? 0,
      tokensAfter: ev.tokensAfter ?? 0,
      compressedCount: ev.compressedCount ?? 0,
      summary: ev.summary ?? '',
    });
    return copy;
  }
  if (ev.type === 'plan' && ev.plan) {
    copy.push({
      kind: 'plan',
      steps: ev.plan.map((s) => ({ description: s, status: 'pending' })),
    });
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
    copy.push({ kind: 'verify', phase: ev.phase ?? 'post_edit', target: ev.target });
    return copy;
  }
  return copy;
}

// ============================================================================
// Session transform (DB rows ↔ entries)
// ============================================================================

export function messagesToEntries(msgs: MessageRow[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      out.push({ kind: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      let toolCalls: ToolCall[] | undefined;
      try { if (m.toolCalls) toolCalls = JSON.parse(m.toolCalls); } catch { /* ignore */ }
      // 跳过完全空的 assistant（DB 历史脏数据 / autosave 时机问题）
      if (!m.content && !toolCalls) continue;
      out.push({ kind: 'assistant', content: m.content, toolCalls });
      if (toolCalls) {
        for (const tc of toolCalls) {
          out.push({ kind: 'tool_call', id: tc.id, name: tc.function.name, args: tc.function.arguments });
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
      });
    }
  }
  return out;
}

export function entriesToMessages(entries: DisplayEntry[], sessionId: string): MessageRow[] {
  const out: MessageRow[] = [];
  let pos = 0;
  const now = Date.now();
  for (const e of entries) {
    if (e.kind === 'user') {
      out.push({ sessionId, position: pos++, role: 'user', content: e.content, createdAt: now });
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
    if (e.kind === 'user') return [{ role: 'user', content: e.content }];
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