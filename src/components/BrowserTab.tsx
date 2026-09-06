import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatStreamEvent } from '../../shared/ipc';
import { MarkdownView } from './MarkdownView';

export interface BrowserTabInfo {
  id: string;
  url: string;
  title: string;
  /** 服务端当前活动 Tab（browser.list 标记），未手动选择时跟随 */
  active?: boolean;
}

interface BrowserTabProps {
  sessionId: string;
  streamId: string | null;
  events?: ChatStreamEvent[];
  /** 收起面板（MainView 持有 dismissedRef，收起后本次流内不再自动展开） */
  onDismiss?: () => void;
}

/** URL → hostname（解析失败时回退原串，避免白屏） */
export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

const SCREENSHOT_RE = /data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/;

/** 从 chat-stream 事件中提取最近一次 browser_screenshot 的 dataUrl */
export function extractScreenshotDataUrl(events: ChatStreamEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === 'tool_result' && ev.toolResult?.name === 'browser_screenshot') {
      const out = (ev.toolResult.result as { output?: unknown } | null | undefined)?.output;
      if (typeof out === 'string') {
        const m = out.match(SCREENSHOT_RE);
        if (m) return m[0];
      }
    }
    if (ev.type === 'browser_screenshot' && typeof ev.content === 'string') {
      const m = ev.content.match(SCREENSHOT_RE);
      if (m) return m[0];
    }
  }
  return null;
}

export function isBrowserStreamEvent(ev: ChatStreamEvent): boolean {
  if (ev.type === 'browser_navigate' || ev.type === 'browser_snapshot' || ev.type === 'browser_screenshot') {
    return true;
  }
  if (ev.type === 'tool_call' && ev.toolCall?.function.name.startsWith('browser_')) return true;
  if (ev.type === 'tool_result' && ev.toolResult?.name.startsWith('browser_')) return true;
  return false;
}

/**
 * 只读浏览器观察窗：
 * - useEffect 加载 browser.list(sessionId)，browser_* 流事件到达时刷新
 * - 选中 tab 后加载 getSnapshot，经 MarkdownView 渲染
 * - screenshot dataUrl 取自 browser_screenshot 事件（无新通道）
 * - 中断按钮调用 chat.abort(streamId)
 */
export function BrowserTab({ sessionId, streamId, events = [], onDismiss }: BrowserTabProps) {
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState('');

  const browserEventCount = useMemo(() => events.filter(isBrowserStreamEvent).length, [events]);
  const screenshotDataUrl = useMemo(() => extractScreenshotDataUrl(events), [events]);
  // 同 Tab 的 browser_snapshot 结果事件计数：每次自增触发快照 effect 重跑
  const snapshotTick = useMemo(
    () => events.filter((ev) => ev.type === 'tool_result' && ev.toolResult?.name === 'browser_snapshot').length,
    [events],
  );
  // 用户本轮手动点过 Tab 后，列表刷新不再用服务端 active 覆盖选择
  const userSelectedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.browser
      ?.list(sessionId)
      .then((list) => {
        if (cancelled) return;
        const next = list ?? [];
        setTabs(next);
        if (userSelectedRef.current) return;
        const active = next.find((t) => t.active);
        if (active) setSelectedId(active.id);
        else setSelectedId((prev) => prev ?? next[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setTabs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, browserEventCount]);

  const activeTab = tabs.find((t) => t.id === selectedId) ?? tabs[0];
  const activeId = activeTab?.id;

  useEffect(() => {
    if (!activeId) {
      setSnapshot('');
      return;
    }
    let cancelled = false;
    window.electronAPI?.browser
      ?.getSnapshot?.(sessionId, activeId)
      .then((r) => {
        if (!cancelled) setSnapshot(r?.markdown ?? '');
      })
      .catch(() => {
        if (!cancelled) setSnapshot('');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, activeId, snapshotTick]);

  function handleAbort() {
    if (!streamId) return;
    window.electronAPI?.chat?.abort?.(streamId);
  }

  /** 快照内链接：http/https/mailto 允许新窗口打开（主进程 setWindowOpenHandler 兜底） */
  function handleAnchorClick(href: string) {
    try {
      const u = new URL(href, window.location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
        window.open(u.href, '_blank');
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="browser-tab" aria-label="浏览器观察">
      <div className="browser-tab__tabs">
        {tabs.length === 0 && <span className="empty-hint">暂无标签页</span>}
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`browser-tab__tab${t.id === activeId ? ' selected' : ''}${t.active ? ' active' : ''}`}
            onClick={() => {
              userSelectedRef.current = true;
              setSelectedId(t.id);
            }}
            title={t.url}
            aria-pressed={t.id === activeId}
          >
            <span className="browser-tab__domain">{hostnameOf(t.url)}</span>
            {t.title && <span className="browser-tab__title">{t.title}</span>}
          </button>
        ))}
      </div>
      {snapshot && (
        <div className="browser-tab__snapshot">
          <MarkdownView content={snapshot} onAnchorClick={handleAnchorClick} />
        </div>
      )}
      {screenshotDataUrl && (
        <img className="browser-tab__screenshot" src={screenshotDataUrl} alt="浏览器截图" />
      )}
      <div className="browser-tab__actions">
        {onDismiss && (
          <button type="button" className="btn btn-secondary" onClick={onDismiss}>
            收起
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={handleAbort}>
          中断
        </button>
      </div>
    </section>
  );
}
