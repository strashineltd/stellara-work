import { useState, useRef } from 'react';

interface ShellCardProps {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  ok: boolean;
}

/**
 * Shell 输出卡片
 * - 显示命令 + exitCode + 耗时
 * - stdout / stderr 分色
 * - 复制按钮
 * - 长输出默认折叠
 */
export function ShellCard({ command, stdout, stderr, exitCode, durationMs, ok }: ShellCardProps) {
  const [open, setOpen] = useState(false);
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
          <span className="tool-card-icon">$</span>
          <span className="tool-card-name">{truncateMiddle(command, 80)}</span>
          <span className="tool-card-summary">
            exit {exitCode} · {durationMs}ms
          </span>
          {longOutput && <span className="tool-card-chevron">{open ? '▾' : '▸'}</span>}
        </button>
        <button
          type="button"
          className="shell-copy-btn"
          onClick={handleCopy}
          title="复制输出"
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
      {open && (
        <div className="shell-body">
          {stdout && <pre className="shell-stdout">{stdout.slice(0, 20000)}</pre>}
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
