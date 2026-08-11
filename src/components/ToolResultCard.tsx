import { useState, useRef } from 'react';
import { Icon } from './Icon';
import { HoverablePath } from './hover/HoverablePath';
import type { ToolResultMeta } from '../../shared/ipc';

interface ToolResultCardProps {
  name: string;
  ok: boolean;
  output: string;
  error?: string;
  /** 工具结果 meta（edit 类含 path，渲染为可 hover 预览的路径） */
  meta?: ToolResultMeta;
  /** 项目根目录；无则 meta.path 渲染为纯文本 */
  workDir?: string;
}

/**
 * 工具结果卡片：成功/失败状态 + 输出（可折叠）+ 复制内容 + meta.path hover 预览
 */
export function ToolResultCard({ name, ok, output, error, meta, workDir }: ToolResultCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 输出超过 200 字默认折叠
  const longOutput = (output?.length ?? 0) > 200;
  const text = error ?? output ?? '';
  const showCopy = (output?.length ?? 0) > 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className={`tool-card tool-card-result ${ok ? 'ok' : 'fail'}`}>
      <div className="tool-card-header">
        <button
          type="button"
          className="tool-card-header-inner"
          onClick={() => longOutput && setOpen((o) => !o)}
          title={longOutput ? (open ? '折叠' : '展开输出') : undefined}
          disabled={!longOutput}
        >
          <span className="tool-card-icon"><Icon name={ok ? 'check' : 'x'} size={14} /></span>
          <span className="tool-card-name">{name}</span>
          {!open && longOutput && (
            <span className="tool-card-summary">
              {text.slice(0, 80).replace(/\n/g, ' ')}
              {text.length > 80 ? '…' : ''}
            </span>
          )}
          {longOutput && (
            <span className="tool-card-chevron">
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
            </span>
          )}
        </button>
        {showCopy && (
          <button
            type="button"
            className="tool-copy-btn"
            aria-label="复制内容"
            title="复制内容"
            onClick={handleCopy}
          >
            {copied ? (
              <span className="tool-copy-btn__copied">已复制</span>
            ) : (
              <Icon name="copy" size={14} />
            )}
          </button>
        )}
      </div>
      {open && (
        <div className="tool-card-body">
          {meta?.kind === 'edit' && meta.path && (
            <div className="tool-result-path">
              {workDir
                ? <HoverablePath path={meta.path} workDir={workDir}>{meta.path}</HoverablePath>
                : <span className="tool-result-path-text">{meta.path}</span>}
            </div>
          )}
          <pre className="tool-result-output">{text}</pre>
        </div>
      )}
    </div>
  );
}
