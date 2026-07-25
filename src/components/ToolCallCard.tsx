import { useState } from 'react';

interface ToolCallCardProps {
  name: string;
  args: string;
}

/**
 * 工具调用卡片：折叠式，名字 + 参数摘要，点击展开
 */
export function ToolCallCard({ name, args }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  // 尝试格式化 JSON 参数做摘要
  let summary = args;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (keys.length > 0) {
      const first = keys[0]!;
      const val = parsed[first];
      const valStr = typeof val === 'string' ? val : JSON.stringify(val);
      summary = `${first}: ${valStr.length > 60 ? valStr.slice(0, 60) + '…' : valStr}${keys.length > 1 ? ` (+${keys.length - 1})` : ''}`;
    }
  } catch {
    // 保持原样
  }

  return (
    <div className="tool-card tool-card-call">
      <button
        type="button"
        className="tool-card-header"
        onClick={() => setOpen((o) => !o)}
        title={open ? '折叠' : '展开参数'}
      >
        <span className="tool-card-icon">🔧</span>
        <span className="tool-card-name">{name}</span>
        {!open && <span className="tool-card-summary">{summary}</span>}
        <span className="tool-card-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <pre className="tool-card-body">{prettyArgs(args)}</pre>
      )}
    </div>
  );
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}
