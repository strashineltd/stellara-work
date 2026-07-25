import { useState } from 'react';

interface ToolResultCardProps {
  name: string;
  ok: boolean;
  output: string;
  error?: string;
}

/**
 * 工具结果卡片：成功/失败状态 + 输出（可折叠）
 */
export function ToolResultCard({ name, ok, output, error }: ToolResultCardProps) {
  const [open, setOpen] = useState(false);
  // 输出超过 200 字默认折叠
  const longOutput = (output?.length ?? 0) > 200;
  const text = error ?? output ?? '';
  return (
    <div className={`tool-card tool-card-result ${ok ? 'ok' : 'fail'}`}>
      <button
        type="button"
        className="tool-card-header"
        onClick={() => longOutput && setOpen((o) => !o)}
        title={longOutput ? (open ? '折叠' : '展开输出') : undefined}
      >
        <span className="tool-card-icon">{ok ? '✓' : '✗'}</span>
        <span className="tool-card-name">{name}</span>
        {!open && longOutput && (
          <span className="tool-card-summary">
            {text.slice(0, 80).replace(/\n/g, ' ')}
            {text.length > 80 ? '…' : ''}
          </span>
        )}
        {longOutput && <span className="tool-card-chevron">{open ? '▾' : '▸'}</span>}
      </button>
      {open && <pre className="tool-card-body">{text}</pre>}
    </div>
  );
}
