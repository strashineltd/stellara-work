import { useState } from 'react';
import type { AppInfo, ChatMessage, ModelConfig, MessageRole, ChatStreamEvent } from '../../shared/ipc';

interface MainViewProps {
  config: ModelConfig;
  info: AppInfo;
}

/**
 * W2.2 + W2.3 主聊天界面（流式版）
 * - 真流式：每个 token 实时 push 到 UI
 * - 暂未实现：markdown 渲染、tool call 卡片、plan 模式（后续 W2.4 / W2.5）
 */
export function MainView({ config, info: _info }: MainViewProps) {
  void _info;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);

  async function handleSend() {
    if (!input.trim() || busy) return;
    const userMsg: ChatMessage = { role: 'user' as MessageRole, content: input };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setBusy(true);
    setStreaming(true);

    // 立即加一个空的 assistant 消息，后续 content 增量追加
    const assistantIdx = history.length;
    setMessages((m) => [...m, { role: 'assistant' as MessageRole, content: '' }]);

    let buffer = '';

    try {
      const { events } = await window.electronAPI.chat.start({ messages: history });

      for await (const ev of events) {
        handleStreamEvent(ev, buffer, (next) => {
          buffer = next;
          setMessages((m) => {
            const copy = [...m];
            copy[assistantIdx] = { role: 'assistant' as MessageRole, content: buffer };
            return copy;
          });
        });
        if (ev.type === 'done' || ev.type === 'error') break;
      }
    } catch (err) {
      setMessages((m) => {
        const copy = [...m];
        copy[assistantIdx] = {
          role: 'assistant' as MessageRole,
          content: buffer + `\n\n[连接错误] ${err instanceof Error ? err.message : String(err)}`,
        };
        return copy;
      });
    } finally {
      setBusy(false);
      setStreaming(false);
    }
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
        {messages.length === 0 ? (
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
            {messages.map((m, i) => (
              <div key={i} className={`message message-${m.role}`}>
                <div className="message-role">{m.role === 'user' ? '你' : 'Agent'}</div>
                <div className="message-content">
                  <pre>{m.content}</pre>
                </div>
              </div>
            ))}
            {streaming && (
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

/**
 * 处理一个 stream event，累积到 buffer
 * 纯函数，外部用 callback 拿最新 buffer
 */
function handleStreamEvent(
  ev: ChatStreamEvent,
  buffer: string,
  setBuffer: (next: string) => void,
): void {
  if (ev.type === 'content' && ev.content) {
    setBuffer(buffer + ev.content);
  } else if (ev.type === 'tool_call' && ev.toolCall) {
    const tc = ev.toolCall;
    const args = tc.function.arguments.length > 100
      ? tc.function.arguments.slice(0, 100) + '...'
      : tc.function.arguments;
    setBuffer(buffer + `\n\n🔧 ${tc.function.name}(${args})\n`);
  } else if (ev.type === 'tool_result' && ev.toolResult) {
    const tr = ev.toolResult;
    const ok = (tr.result as { ok?: boolean })?.ok;
    setBuffer(buffer + `   ${ok ? '✓' : '✗'} ${tr.name}\n`);
  } else if (ev.type === 'error' && ev.error) {
    setBuffer(buffer + `\n\n[错误] ${ev.error}`);
  }
  // 'done' / 'plan' 不动 buffer
}

function truncatePath(p: string, max = 40): string {
  if (p.length <= max) return p;
  return '...' + p.slice(p.length - max + 3);
}
