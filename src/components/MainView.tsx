import { useEffect, useRef, useState } from 'react';
import type { AppInfo, ChatMessage, ModelConfig, MessageRole, ChatStreamEvent, ToolResultMeta } from '../../shared/ipc';
import { MarkdownView } from './MarkdownView';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';
import { DiffCard } from './DiffCard';
import { ShellCard } from './ShellCard';

/**
 * UI 用的条目（流式累加过程中也用它来更新）
 * 跟 ChatMessage 不一样：这是 renderer 自己用的展示模型
 */
type DisplayEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_call'; name: string; args: string }
  | { kind: 'tool_result'; name: string; ok: boolean; output: string; error?: string; meta?: ToolResultMeta }
  | { kind: 'error'; message: string };

interface MainViewProps {
  config: ModelConfig;
  info: AppInfo;
  onReconfigure: () => void;
  onSwitchModel: (config: ModelConfig) => void;
}

/**
 * W2.4 主聊天界面
 * - entry-based：每条消息独立（user / assistant / tool_call / tool_result / error）
 * - assistant 走 markdown 渲染
 * - tool_call / tool_result 走折叠卡片
 * - 真实流式：content event 直接更新最后一条 assistant 条目
 */
export function MainView({ config, info: _info, onReconfigure, onSwitchModel: _onSwitchModel }: MainViewProps) {
  void _info;
  void _onSwitchModel;
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [planMode, setPlanMode] = useState(false);

  // 点外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = () => setMenuOpen(false);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [menuOpen]);

  // 自动滚到底部
  const chatRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  function handleNewTask() {
    if (busy) return; // 不在 agent 跑的时候清空
    if (entries.length === 0) {
      setMenuOpen(false);
      return;
    }
    setConfirmNew(true);
  }

  function doNewTask() {
    setEntries([]);
    setConfirmNew(false);
    setMenuOpen(false);
  }

  // 把当前 entries 投成发给 LLM 的 history（只取 user + assistant 的纯文本，跳过 tool_call/tool_result/错误）
  // 注意：assistant 的 tool_calls 是 stream 才知道的；本轮流式期间 history 只提交上一轮
  //       完整的 tool_calls 提交等 done 后再做（W2.5 再加，先保 W2.4 跑得通）
  const buildHistory = (): ChatMessage[] =>
    entries.flatMap<ChatMessage>((e) => {
      if (e.kind === 'user') return [{ role: 'user' as MessageRole, content: e.content }];
      if (e.kind === 'assistant' && e.content) return [{ role: 'assistant' as MessageRole, content: e.content }];
      return [];
    });

  async function handleSend() {
    if (!input.trim() || busy) return;
    const userContent = input;
    const history = [...buildHistory(), { role: 'user' as MessageRole, content: userContent }];
    const usePlanMode = planMode;
    setLastUserForRetry(null); // 新的发送 → 清掉重试状态

    // 立即加 user + 空的 assistant
    setEntries((prev) => [
      ...prev,
      { kind: 'user', content: userContent },
      { kind: 'assistant', content: '' },
    ]);
    setInput('');
    setBusy(true);

    try {
      const { events } = await window.electronAPI.chat.start({ messages: history, planMode: usePlanMode });

      for await (const ev of events) {
        applyStreamEvent(ev);
        if (ev.type === 'done' || ev.type === 'error') break;
      }
    } catch (err) {
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        const msg = err instanceof Error ? err.message : String(err);
        if (last && last.kind === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            content: last.content + `\n\n[连接错误] ${msg}`,
          };
        } else {
          copy.push({ kind: 'error', message: msg });
        }
        // 记录最后一条 user 消息 → 错误条上挂「再试一次」
        setLastUserForRetry(userContent);
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  /** 错误后允许重试：把 input 还原 + 再 send */
  const [lastUserForRetry, setLastUserForRetry] = useState<string | null>(null);
  function handleRetry() {
    if (lastUserForRetry) {
      setInput(lastUserForRetry);
      // 移除上次的错误尾巴
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.kind === 'assistant' && last.content.includes('[连接错误]')) {
          // 去掉最后一段错误尾巴
          copy[copy.length - 1] = {
            ...last,
            content: last.content.replace(/\n\n\[连接错误\][\s\S]*$/, ''),
          };
        } else if (last && last.kind === 'error') {
          copy.pop();
        }
        return copy;
      });
      setLastUserForRetry(null);
      // 等 React 渲染完再 send（用 rAF 等状态落地）
      requestAnimationFrame(() => {
        void handleSend();
      });
    }
  }

  /**
   * 把一个流事件落到 entries 上
   */
  function applyStreamEvent(ev: ChatStreamEvent): void {
    setEntries((prev) => {
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
          name: ev.toolCall.function.name,
          args: ev.toolCall.function.arguments,
        });
        return copy;
      }
      if (ev.type === 'tool_result' && ev.toolResult) {
        const r = ev.toolResult.result as { ok?: boolean; output?: string; error?: string; meta?: ToolResultMeta };
        copy.push({
          kind: 'tool_result',
          name: ev.toolResult.name,
          ok: r?.ok === true,
          output: r?.output ?? '',
          error: r?.error,
          meta: r?.meta,
        });
        return copy;
      }
      if (ev.type === 'error' && ev.error) {
        copy.push({ kind: 'error', message: ev.error });
        return copy;
      }
      // 'done' / 'plan' 不动 entries
      return copy;
    });
  }

  return (
    <div className="main-view">
      <header className="main-header">
        <div className="main-header-left">
          <h1 className="main-title">Stellara Work</h1>
          <span className="main-model">
            {config.label} <code>{config.model}</code>
          </span>
        </div>
        <div className="main-header-right">
          <span className="main-workdir" title={config.workDir ?? ''}>
            {config.workDir ? truncatePath(config.workDir) : '（未选工作目录）'}
          </span>
          <div className="header-menu-wrap">
            <button
              className="btn-icon"
              onClick={() => setMenuOpen((o) => !o)}
              title="菜单"
              type="button"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="header-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  className="header-menu-item"
                  onClick={handleNewTask}
                  type="button"
                  disabled={busy || entries.length === 0}
                  title={entries.length === 0 ? '当前没有任务' : '清空聊天历史，开新任务'}
                >
                  🆕 新任务
                </button>
                <button
                  className="header-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onReconfigure();
                  }}
                  type="button"
                  title="切换模型 / 改 API key / 改工作目录"
                >
                  ⚙️ 重新配置
                </button>
                <div className="header-menu-hint">
                  v0.9 · 快捷键以后再加
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {confirmNew && (
        <div className="modal-backdrop" onClick={() => setConfirmNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>清空当前聊天？</h3>
            <p>当前 {entries.length} 条记录会被清掉，agent 上下文也会重置。</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmNew(false)} type="button">
                取消
              </button>
              <button className="btn btn-primary" onClick={doNewTask} type="button">
                清空
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="main-chat" ref={chatRef}>
        {entries.length === 0 ? (
          <div className="empty-chat">
            <h2>开始一个新的任务</h2>
            <p>在下方输入你的需求，agent 会在工作目录里读 / 写文件、跑命令、汇报结果。</p>
            <div className="empty-examples">
              <p>试试这些：</p>
              <ul>
                <li>"读 README.md 然后总结一下"</li>
                <li>"在 src/utils/ 新增一个 helper.ts 实现字符串反转"</li>
                <li>"跑 npm test 看哪些挂了"</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="messages">
            {entries.map((e, i) => (
              <div key={i} className="entry">
                {e.kind === 'user' && (
                  <div className="message message-user">
                    <div className="message-role">你</div>
                    <div className="message-content">
                      <pre className="user-text">{e.content}</pre>
                    </div>
                  </div>
                )}
                {e.kind === 'assistant' && (
                  <div className="message message-assistant">
                    <div className="message-role">Agent</div>
                    <div className="message-content">
                      {e.content ? <MarkdownView content={e.content} /> : <span className="thinking">思考中...</span>}
                      {lastUserForRetry && !busy && e.content.includes('[连接错误]') && (
                        <button className="btn btn-secondary btn-retry" onClick={handleRetry} type="button">
                          ↻ 再试一次
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {e.kind === 'tool_call' && <ToolCallCard name={e.name} args={e.args} />}
                {e.kind === 'tool_result' && e.meta?.kind === 'edit' && (
                  <DiffCard path={e.meta.path} before={e.meta.before} after={e.meta.after} />
                )}
                {e.kind === 'tool_result' && e.meta?.kind === 'command' && (
                  <ShellCard
                    command={e.meta.command}
                    stdout={e.meta.stdout}
                    stderr={e.meta.stderr}
                    exitCode={e.meta.exitCode}
                    durationMs={e.meta.durationMs}
                    ok={e.ok}
                  />
                )}
                {e.kind === 'tool_result' && !e.meta && (
                  <ToolResultCard name={e.name} ok={e.ok} output={e.output} error={e.error} />
                )}
                {e.kind === 'error' && (
                  <div className="error-banner">
                    <span className="error-icon">⚠</span>
                    <span className="error-text">{e.message}</span>
                    {lastUserForRetry && !busy && (
                      <button className="btn btn-secondary btn-retry" onClick={handleRetry} type="button">
                        ↻ 再试一次
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="streaming-indicator">
                <span></span><span></span><span></span>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="main-input">
        <textarea
          className="input-chat"
          placeholder={busy ? 'Agent 思考中...' : '输入你的需求...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={busy}
          rows={3}
        />
        <div className="input-actions">
          <label className={`plan-toggle ${planMode ? 'on' : ''}`} title="Plan 模式：agent 只读文件 / 搜索，不写不执行">
            <input
              type="checkbox"
              checked={planMode}
              onChange={(e) => setPlanMode(e.target.checked)}
              disabled={busy}
            />
            <span>Plan 模式{planMode ? '（只读）' : ''}</span>
          </label>
          <span className="hint">Ctrl+Enter 发送</span>
          <button
            className="btn btn-primary"
            onClick={() => void handleSend()}
            disabled={busy || !input.trim()}
          >
            {busy ? '思考中...' : '发送'}
          </button>
        </div>
      </footer>
    </div>
  );
}

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  return '...' + p.slice(p.length - max + 3);
}
