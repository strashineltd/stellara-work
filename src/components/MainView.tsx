import { useEffect, useRef, useState } from 'react';
import type {
  AppInfo, ChatMessage, ModelConfig, ModelListItem, MessageRole, ChatStreamEvent,
  ToolResultMeta, SessionSummary, MessageRow, Session, ToolCall,
} from '../../shared/ipc';
import { MarkdownView } from './MarkdownView';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';
import { DiffCard } from './DiffCard';
import { ShellCard } from './ShellCard';
import { Sidebar } from './Sidebar';
import { FileTreeModal } from './FileTreeModal';

/**
 * UI 用的条目（流式累加过程中也用它来更新）
 */
type DisplayEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { kind: 'tool_call'; id: string; name: string; args: string }
  | { kind: 'tool_result'; toolCallId?: string; name: string; ok: boolean; output: string; error?: string; meta?: ToolResultMeta }
  | { kind: 'error'; message: string };

interface MainViewProps {
  config: ModelConfig;
  info: AppInfo;
  sidebarOpen: boolean;
  activeSessionId: string | null;
  sessions: SessionSummary[];
  onToggleSidebar: () => void;
  onReconfigure: () => void;
  onOpenSettings: () => void;
  onSessionCreated: (session: Session) => void;
  onSessionSwitched: (id: string) => void;
  onSessionDeleted: (id: string) => void;
  onSessionRenamed: (id: string, title: string) => void;
  onSessionsChanged: (sessions: SessionSummary[]) => void;
  onModelChanged: (config: ModelConfig) => void;
  onChangeWorkDir: () => void;
}

/**
 * W3 主聊天界面
 * - 左 Sidebar 会话列表 + 主聊天区
 * - entry-based 数据模型
 * - 自动保存：entries 变化时 debounce 300ms 写 SQLite
 * - 切会话：清空 entries + 加载该 session 的 messages
 */
export function MainView(props: MainViewProps) {
  const {
    config, info: _info, sidebarOpen, activeSessionId, sessions,
    onToggleSidebar, onReconfigure, onOpenSettings, onChangeWorkDir,
    onSessionCreated, onSessionSwitched, onSessionDeleted, onSessionRenamed, onSessionsChanged,
    onModelChanged,
  } = props;
  void _info;

  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [lastUserForRetry, setLastUserForRetry] = useState<string | null>(null);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);

  // 拉所有 model 列表（用于 header 下拉切换）
  useEffect(() => {
    void window.electronAPI.models.getAll().then(setModelList).catch(() => { /* ignore */ });
  }, [config.id]); // 切完 active model 后重新拉

  // 点外部关闭菜单（用 mousedown 避开同一次 click 触发的开/关竞态）
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.header-menu-wrap')) return; // 点菜单/按钮自己就跳过
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen]);

  // 点外部关闭 model 下拉
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.model-switcher')) return;
      setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [modelMenuOpen]);

  async function handleSwitchModel(id: string) {
    if (id === config.id || switchingModel) return;
    setSwitchingModel(true);
    try {
      await window.electronAPI.models.setActive(id);
      const list = await window.electronAPI.models.list();
      if (list.configured) onModelChanged(list.configured);
      setModelMenuOpen(false);
    } catch (e) {
      console.error('切换 model 失败:', e);
    } finally {
      setSwitchingModel(false);
    }
  }

  // 切会话：加载历史
  useEffect(() => {
    if (!activeSessionId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    void window.electronAPI.sessions.get(activeSessionId).then(({ session, messages }) => {
      if (cancelled) return;
      setEntries(messagesToEntries(messages));
      setPlanMode(false);
      setLastUserForRetry(null);
      void session; // 暂时不用
    }).catch((e) => {
      console.error('Failed to load session:', e);
    });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  // 自动保存：debounce 300ms
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.electronAPI.sessions.saveMessages(activeSessionId, entriesToMessages(entries))
        .then(() => window.electronAPI.sessions.list())
        .then(onSessionsChanged)
        .catch((e) => console.error('Auto-save failed:', e));
    }, 300);
  }, [entries, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动滚到底部
  const chatRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  // 把当前 entries 投成发给 LLM 的 history（包含完整的 tool_call / tool_result 链）
  const buildHistory = (): ChatMessage[] =>
    entries.flatMap<ChatMessage>((e) => {
      if (e.kind === 'user') return [{ role: 'user' as MessageRole, content: e.content }];
      if (e.kind === 'assistant') {
        const msg: ChatMessage = { role: 'assistant' as MessageRole, content: e.content };
        if (e.toolCalls && e.toolCalls.length > 0) msg.tool_calls = e.toolCalls;
        return [msg];
      }
      if (e.kind === 'tool_result') {
        return [{
          role: 'tool' as MessageRole,
          tool_call_id: e.toolCallId ?? '',
          name: e.name,
          content: e.ok ? e.output : `Error: ${e.error ?? '未知错误'}`,
        }];
      }
      return [];
    });

  // 自动给当前会话改名（首条 user 消息触发后用前 20 字做 title）
  useEffect(() => {
    if (!activeSessionId) return;
    const firstUser = entries.find((e) => e.kind === 'user');
    if (!firstUser || firstUser.kind !== 'user') return;
    const title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '');
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (currentSession && currentSession.title === 'New session') {
      void window.electronAPI.sessions.rename(activeSessionId, title)
        .then(() => window.electronAPI.sessions.list())
        .then(onSessionsChanged)
        .catch(() => { /* ignore */ });
    }
  }, [entries, activeSessionId, sessions, onSessionsChanged]);

  async function handleNewTask() {
    if (busy) return;
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
    setLastUserForRetry(null);
  }

  async function handleSend() {
    if (!input.trim() || busy) return;
    const userContent = input;
    const history = [...buildHistory(), { role: 'user' as MessageRole, content: userContent }];
    const usePlanMode = planMode;
    setLastUserForRetry(null);

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
          copy[copy.length - 1] = { ...last, content: last.content + `\n\n[连接错误] ${msg}` };
        } else {
          copy.push({ kind: 'error', message: msg });
        }
        setLastUserForRetry(userContent);
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  function handleRetry() {
    if (lastUserForRetry) {
      setInput(lastUserForRetry);
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.kind === 'assistant' && last.content.includes('[连接错误]')) {
          copy[copy.length - 1] = { ...last, content: last.content.replace(/\n\n\[连接错误\][\s\S]*$/, '') };
        } else if (last && last.kind === 'error') {
          copy.pop();
        }
        return copy;
      });
      setLastUserForRetry(null);
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
        copy.push({ kind: 'error', message: ev.error });
        return copy;
      }
      return copy;
    });
  }

  async function handleNewSession() {
    if (busy) return;
    try {
      const s = await window.electronAPI.sessions.create({
        modelId: config.id,
        workDir: config.workDir,
      });
      onSessionCreated(s);
    } catch (e) {
      console.error('New session failed:', e);
    }
  }

  async function handleDeleteSession(id: string) {
    try {
      await window.electronAPI.sessions.delete(id);
      onSessionDeleted(id);
    } catch (e) {
      console.error('Delete session failed:', e);
    }
  }

  async function handleRenameSession(id: string, title: string) {
    try {
      await window.electronAPI.sessions.rename(id, title);
      onSessionRenamed(id, title);
    } catch (e) {
      console.error('Rename session failed:', e);
    }
  }

  return (
    <div className="main-view">
      <header className="main-header">
        <div className="main-header-left">
          <button
            className="btn-icon sidebar-toggle"
            onClick={onToggleSidebar}
            type="button"
            title={sidebarOpen ? '隐藏会话列表' : '显示会话列表'}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
          <h1 className="main-title">Stellara Work</h1>
        </div>
        <div className="main-header-center">
          <button
            className="main-workdir"
            onClick={onChangeWorkDir}
            title={config.workDir ?? '点击选择工作目录'}
            type="button"
          >
            <span className="main-workdir-icon" aria-hidden="true">📂</span>
            <span className="main-workdir-name">
              {config.workDir ? basename(config.workDir) : '选择工作目录…'}
            </span>
          </button>
          <span className="model-switcher">
            <button
              className={`main-model ${modelMenuOpen ? 'open' : ''}`}
              onClick={() => setModelMenuOpen((v) => !v)}
              type="button"
              title={`${config.label} · ${config.model}（点击切换）`}
              disabled={switchingModel}
            >
              <span className="main-model-label">{config.label}</span>
              <span className="main-model-caret" aria-hidden="true">▾</span>
            </button>
            {modelMenuOpen && (
              <div className="model-switcher-menu" role="listbox">
                {modelList.length === 0 && <div className="empty-hint">还没有 model</div>}
                {modelList.map((m) => (
                  <button
                    key={m.id}
                    className={`model-switcher-item ${m.id === config.id ? 'active' : ''} ${!m.hasKey ? 'no-key' : ''}`}
                    onClick={() => void handleSwitchModel(m.id)}
                    type="button"
                    title={!m.hasKey ? '该 model 未配 API key' : m.model}
                    disabled={switchingModel}
                  >
                    <span className="model-switcher-item-name">{m.label}</span>
                    <span className="model-switcher-item-meta">
                      {m.id === config.id && <span className="badge">活跃</span>}
                      {!m.hasKey && <span className="badge-warn">无 key</span>}
                    </span>
                  </button>
                ))}
                <div className="model-switcher-footer">
                  <button
                    className="model-switcher-add"
                    onClick={() => { setModelMenuOpen(false); onOpenSettings(); }}
                    type="button"
                  >
                    ⚙️ 添加 / 管理模型
                  </button>
                </div>
              </div>
            )}
          </span>
        </div>
        <div className="main-header-right">
          {config.workDir && (
            <button
              className="btn-icon"
              onClick={() => setFileTreeOpen(true)}
              type="button"
              title="浏览文件"
            >
              📁
            </button>
          )}
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
                  🆕 新任务（清空当前）
                </button>
                <button
                  className="header-menu-item"
                  onClick={() => { setMenuOpen(false); void handleNewSession(); }}
                  type="button"
                  title="新建一个会话"
                >
                  ➕ 新建会话
                </button>
                <button
                  className="header-menu-item"
                  onClick={() => { setMenuOpen(false); onReconfigure(); }}
                  type="button"
                  title="切换模型 / 改 API key / 改工作目录"
                >
                  🔄 重新配置
                </button>
                <button
                  className="header-menu-item"
                  onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                  type="button"
                  title="Providers / Sessions / App 设置"
                >
                  ⚙️ 设置
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="main-layout">
        {sidebarOpen && (
          <Sidebar
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={onSessionSwitched}
            onNew={() => void handleNewSession()}
            onDelete={(id) => void handleDeleteSession(id)}
            onRename={(id, title) => void handleRenameSession(id, title)}
          />
        )}
        <div className="main-content">
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
      </div>

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

      {fileTreeOpen && config.workDir && (
        <FileTreeModal
          workDir={config.workDir}
          onClose={() => setFileTreeOpen(false)}
        />
      )}
    </div>
  );
}

function basename(p: string): string {
  // 处理 Windows / POSIX 都可
  const m = p.replace(/[\\/]+$/, '').match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function messagesToEntries(msgs: MessageRow[]): DisplayEntry[] {
  const out: DisplayEntry[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      out.push({ kind: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      let toolCalls: ToolCall[] | undefined;
      try { if (m.toolCalls) toolCalls = JSON.parse(m.toolCalls); } catch { /* ignore */ }
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

function entriesToMessages(entries: DisplayEntry[]): MessageRow[] {
  const out: MessageRow[] = [];
  let pos = 0;
  const now = Date.now();
  for (const e of entries) {
    if (e.kind === 'user') {
      out.push({ sessionId: '', position: pos++, role: 'user', content: e.content, createdAt: now });
    } else if (e.kind === 'assistant') {
      out.push({
        sessionId: '',
        position: pos++,
        role: 'assistant',
        content: e.content,
        toolCalls: e.toolCalls && e.toolCalls.length > 0 ? JSON.stringify(e.toolCalls) : undefined,
        createdAt: now,
      });
    } else if (e.kind === 'tool_call') {
      // 合并到上一条 assistant 消息，与 OpenAI 消息格式一致
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') {
        const calls: ToolCall[] = last.toolCalls ? JSON.parse(last.toolCalls) : [];
        calls.push({ id: e.id, type: 'function', function: { name: e.name, arguments: e.args } });
        last.toolCalls = JSON.stringify(calls);
      }
    } else if (e.kind === 'tool_result') {
      out.push({
        sessionId: '',
        position: pos++,
        role: 'tool',
        content: e.output,
        toolCallId: e.toolCallId,
        toolName: e.name,
        meta: JSON.stringify(e.meta),
        createdAt: now,
      });
    } else if (e.kind === 'error') {
      // 错误不存
    }
  }
  return out;
}
