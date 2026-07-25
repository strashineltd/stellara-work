import { useState } from 'react';
import type { AppInfo, ChatMessage, ModelConfig, MessageRole } from '../../shared/ipc';

interface MainViewProps {
  config: ModelConfig;
  info: AppInfo;
}

/**
 * W2.2 主聊天界面（占位版）
 * 真正的聊天流 + 流式渲染 + tool call 卡片在 W2.3 / W2.4
 */
export function MainView({ config, info: _info }: MainViewProps) {
  // info 当前没用到，预留用于 W2 后续显示工作目录等信息
  void _info;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    if (!input.trim() || busy) return;
    const userMsg: ChatMessage = { role: 'user' as MessageRole, content: input };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);

    try {
      // W2.3 替换为真正流式
      const events = await window.electronAPI.chat.send({
        messages: [...messages, userMsg],
      });
      let content = '';
      for await (const event of events) {
        if (event.type === 'content' && event.content) {
          content += event.content;
        } else if (event.type === 'error') {
          content += `\n\n[错误] ${event.error}`;
        }
      }
      const assistantMsg: ChatMessage = {
        role: 'assistant' as MessageRole,
        content: content || '（空响应）',
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: 'assistant' as MessageRole,
        content: `错误：${err instanceof Error ? err.message : String(err)}`,
      };
      setMessages((m) => [...m, errorMsg]);
    } finally {
      setBusy(false);
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
