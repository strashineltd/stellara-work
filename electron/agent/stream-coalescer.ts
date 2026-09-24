/**
 * 流式 delta 合并器（性能 P1）。
 *
 * LLM 每秒可产出数十个 content/reasoning 片段；逐条 IPC + React setState
 * 会导致整表重渲染与 markdown 重解析。这里在主进程侧把连续同类 delta
 * 合并，按时间窗或长度阈值冲刷；离散事件（tool_call / done…）前先冲刷，
 * 保证与 UI 的事件顺序一致。
 */
import type { ChatStreamEvent } from '../../shared/ipc';

export type StreamEmit = (event: ChatStreamEvent) => void;

export interface StreamCoalescer {
  send: StreamEmit;
  flush: () => void;
  dispose: () => void;
}

const DEFAULT_FLUSH_MS = 40;
const DEFAULT_MAX_CHARS = 512;

export function createStreamCoalescer(
  emit: StreamEmit,
  flushMs: number = DEFAULT_FLUSH_MS,
  maxPendingChars: number = DEFAULT_MAX_CHARS,
): StreamCoalescer {
  let content = '';
  let reasoning = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (reasoning) {
      const chunk = reasoning;
      reasoning = '';
      emit({ type: 'reasoning', content: chunk });
    }
    if (content) {
      const chunk = content;
      content = '';
      emit({ type: 'content', content: chunk });
    }
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushMs);
  };

  const send: StreamEmit = (event) => {
    if (event.type === 'content' && event.content) {
      content += event.content;
      if (content.length >= maxPendingChars) flush();
      else schedule();
      return;
    }
    if (event.type === 'reasoning' && event.content) {
      reasoning += event.content;
      if (reasoning.length >= maxPendingChars) flush();
      else schedule();
      return;
    }
    // 离散事件：先冲刷缓冲，保持 reasoning/content 在其之前
    flush();
    emit(event);
  };

  return {
    send,
    flush,
    dispose: () => {
      clearTimer();
      content = '';
      reasoning = '';
    },
  };
}
