import { useState } from 'react';
import type { AppInfo, ChatMessage, ModelConfig, MessageRole, ChatStreamEvent } from '../../shared/ipc';
import { MarkdownView } from './MarkdownView';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';

/**
 * UI 用的条目（流式累加过程中也用它来更新）
 * 跟 ChatMessage 不一样：这是 renderer 自己用的展示模型
 */
type DisplayEntry =
  | { kind: 'user'; content: string }
  | { kind: 'assistant'; content: string }
  | { kind: 'tool_call'; name: string; args: string }
  | { kind: 'tool_result'; name: string; ok: boolean; output: string; error?: string }
  | { kind: 'error'; message: string };

interface MainViewProps {
  config: ModelConfig;
  info: AppInfo;
}

/**
 * W2.4 主聊天界面
 * - entry-based：每条消息独立（user / assistant / tool_call / tool_result / error）
 * - assistant 走 markdown 渲染
 * - tool_call / tool_result 走折叠卡片
 * - 真实流式：content event 直接更新最后一条 assistant 条目
 */
export function MainView({ config, info: _info }: MainViewProps) {
  void _info;
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

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

    // 立即加 user + 空的 assistant
    setEntries((prev) => [
      ...prev,
      { kind: 'user', content: userContent },
      { kind: 'assistant', content: '' },
    ]);
    setInput('');
    setBusy(true);

    try {
      const { events } = await window.electronAPI.chat.start({ messages: history });

      for await (const ev of events) {
        applyStreamEvent(ev);
        if (ev.type === 'done' || ev.type === 'error') break;
      }
    } catch (err) {
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.kind === 'assistant') {
          copy[copy.length - 1] = {
            ...last,
            content: last.content + `\n\n[连接错误] ${err instanceof Error ? err.message : String(err)}`,
          };
        } else {
          copy.push({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return copy;
      });
    } finally {
      setBusy(false);
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
        const r = ev.toolResult.result as { ok?: boolean; output?: string; error?: string };
        copy.push({
          kind: 'tool_result',
          name: ev.toolResult.name,
          ok: r?.ok === true,
          output: r?.output ?? '',
          error: r?.error,
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
        </div>
      </header>

      <main className="main-chat">
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
                    </div>
                  </div>
                )}
                {e.kind === 'tool_call' && <ToolCallCard name={e.name} args={e.args} />}
                {e.kind === 'tool_result' && <ToolResultCard name={e.name} ok={e.ok} output={e.output} error={e.error} />}
                {e.kind === 'error' && (
                  <div className="error-banner">
                    <span className="error-icon">⚠</span>
                    <span>{e.message}</span>
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
