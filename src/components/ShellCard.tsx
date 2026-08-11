import { useState, useRef } from 'react';
import { Icon } from './Icon';

interface ShellCardProps {
  command: string;
  stdout: string;
  stderr: string;
  /** 缺失（null/undefined）时不显示退出码徽章 */
  exitCode?: number | null;
  /** 缺失（null/undefined）时不显示时长 */
  durationMs?: number | null;
  ok: boolean;
}

/**
 * Shell 输出卡片
 * - 显示命令 + 时长 + 退出码徽章
 * - stdout / stderr 分色
 * - 行号开关（仅 stdout 编号）
 * - 复制按钮
 * - 长输出默认折叠
 */
export function ShellCard({ command, stdout, stderr, exitCode, durationMs, ok }: ShellCardProps) {
  const [open, setOpen] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = (stdout + stderr).length;
  const longOutput = total > 500;
  const truncated = total > 10000;

  async function handleCopy() {
    const text = (stdout + stderr).slice(0, 100000);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className={`tool-card tool-card-shell ${ok ? 'ok' : 'fail'}`}>
      <div className="tool-card-header" style={{ cursor: longOutput ? 'pointer' : 'default' }}>
        <button
          type="button"
          className="tool-card-header-inner"
          onClick={() => longOutput && setOpen((o) => !o)}
          title={longOutput ? (open ? '折叠' : '展开') : undefined}
          disabled={!longOutput}
        >
          <span className="tool-card-icon"><Icon name="terminal" size={14} /></span>
          <span className="tool-card-name">{truncateMiddle(command, 80)}</span>
          <span className="shell-meta">
            {durationMs != null && (
              <span className="shell-duration">{`${(durationMs / 1000).toFixed(1)}s`}</span>
            )}
            {exitCode != null && (
              <span
                className={`shell-exit ${exitCode === 0 ? 'shell-exit--success' : 'shell-exit--danger'}`}
              >
                exit {exitCode}
              </span>
            )}
          </span>
          {longOutput && (
            <span className="tool-card-chevron">
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
          )}
        </button>
        <button
          type="button"
          className={`shell-lineno-btn ${lineNumbers ? 'shell-lineno-btn--active' : ''}`}
          onClick={() => setLineNumbers((v) => !v)}
          aria-pressed={lineNumbers}
          title="显示/隐藏行号"
        >
          行号
        </button>
        <button
          type="button"
          className="shell-copy-btn"
          onClick={handleCopy}
          title="复制输出"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
        </button>
      </div>
      {(open || !longOutput) && (
        <div className="shell-body">
          {stdout && (
            <pre className={`shell-stdout${lineNumbers ? ' shell-linenos' : ''}`}>
              {lineNumbers ? numberLines(stdout.slice(0, 20000)) : stdout.slice(0, 20000)}
            </pre>
          )}
          {stderr && <pre className="shell-stderr">{stderr.slice(0, 20000)}</pre>}
          {!stdout && !stderr && <pre className="shell-empty">（无输出）</pre>}
          {truncated && <div className="shell-truncated">（输出过长，已截断）</div>}
        </div>
      )}
    </div>
  );
}

function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return s.slice(0, head) + '…' + s.slice(s.length - tail);
}

function numberLines(s: string): string {
  return s
    .split('\n')
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');
}
