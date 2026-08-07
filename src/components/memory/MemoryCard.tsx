import { useEffect, useRef, useState } from 'react';
import type { Memory } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface MemoryCardProps {
  memory: Memory;
  onEdit?: (memory: Memory) => void;
  onDelete?: (memory: Memory) => void;
  onExport?: (memory: Memory) => void;
  onCopy?: (memory: Memory) => void;
  onTogglePin?: (memory: Memory) => void;
  expanded?: boolean;
  onToggleExpand?: (memory: Memory) => void;
  /** 项目名（scope 为 project 时显示为「项目 · 名称」） */
  scopeLabel?: string;
}

const KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  codebase: '代码库',
  requirement: '需求',
  meeting: '会议',
};

const SCOPE_LABELS: Record<string, string> = {
  personal: '个人',
  project: '项目',
  workspace: '企业',
};

/** 超过 80 字的内容视为需要截断（3 行）并显示「展开」 */
const CLAMP_THRESHOLD = 80;
/** 置顶判定阈值，与记忆中心「重要记忆」分组一致 */
export const PIN_THRESHOLD = 0.8;

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 2 * 86_400_000) return '昨天';
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sourceLabel(source?: string): string | null {
  if (!source) return null;
  if (source.startsWith('session:')) return 'Agent 自动提取';
  if (source.startsWith('agent')) return 'Agent 保存';
  return '手动记录';
}

function scopeText(memory: Memory, scopeLabel?: string): string {
  if (memory.scope !== 'project') return SCOPE_LABELS[memory.scope] ?? memory.scope;
  return scopeLabel ? `项目 · ${scopeLabel}` : '项目';
}

export function MemoryCard({
  memory,
  onEdit,
  onDelete,
  onExport,
  onCopy,
  onTogglePin,
  expanded: expandedProp,
  onToggleExpand,
  scopeLabel,
}: MemoryCardProps) {
  const [expandedLocal, setExpandedLocal] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  const expanded = expandedProp ?? expandedLocal;
  const pinned = memory.importance >= PIN_THRESHOLD;
  const isLong = memory.content.length > CLAMP_THRESHOLD;
  const clamped = isLong && !expanded;
  const src = sourceLabel(memory.source);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimer.current);
  }, []);

  function handleExpand() {
    if (onToggleExpand) onToggleExpand(memory);
    else setExpandedLocal(true);
  }

  function handleCopy() {
    onCopy?.(memory);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  const kindLabel = KIND_LABELS[memory.kind] ?? memory.kind;

  return (
    <div className={`memory-card${pinned ? ' memory-card--pinned' : ''}`}>
      <div className="memory-card__head">
        <span className={`memory-badge memory-badge--${memory.kind}`}>{kindLabel}</span>
        <span className="memory-card__scope">{scopeText(memory, scopeLabel)}</span>
        <span className="memory-card__time">
          <span className="memory-card__actions">
            {onTogglePin && (
              <button
                className={`memory-card__action memory-card__action--star${pinned ? ' on' : ''}`}
                type="button"
                aria-label={pinned ? '取消置顶' : '置顶'}
                onClick={() => onTogglePin(memory)}
              >
                <svg className="memory-card__star" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2.5 9.7 6l3.8.5-2.8 2.6.7 3.8L8 10.8l-3.4 1.9.7-3.8L2.5 6.5 6.3 6z" />
                </svg>
              </button>
            )}
            {onEdit && (
              <button
                className="memory-card__action"
                type="button"
                aria-label="编辑"
                onClick={() => onEdit(memory)}
              >
                <Icon name="edit" size={14} />
              </button>
            )}
            {onExport && (
              <button
                className="memory-card__action"
                type="button"
                aria-label="导出 MD"
                onClick={() => onExport(memory)}
              >
                <svg className="memory-card__export" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2v7M5.5 6.5 8 9l2.5-2.5M3 11.5V13h10v-1.5" />
                </svg>
              </button>
            )}
            {onCopy && (
              <button
                className="memory-card__action"
                type="button"
                aria-label="复制 MD"
                onClick={handleCopy}
              >
                {copied ? (
                  <span className="memory-card__copied">已复制</span>
                ) : (
                  <Icon name="copy" size={14} />
                )}
              </button>
            )}
            {onDelete && (
              <button
                className="memory-card__action memory-card__action--danger"
                type="button"
                aria-label="删除"
                onClick={() => onDelete(memory)}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </span>
          <span>{formatRelativeTime(memory.updatedAt)}</span>
        </span>
      </div>

      <p className={`memory-card__content${clamped ? ' memory-card__content--clamped' : ''}`}>
        {memory.content}
        {clamped && (
          <button className="memory-card__more" type="button" onClick={handleExpand}>
            展开
          </button>
        )}
      </p>

      {expanded && (
        <div className="memory-card__meta">
          {src && <span className="memory-card__src">{src}</span>}
          <span>创建 {formatDateTime(memory.createdAt)}</span>
          {memory.updatedAt !== memory.createdAt && (
            <span>更新 {formatDateTime(memory.updatedAt)}</span>
          )}
          <span>使用 {memory.accessCount} 次</span>
        </div>
      )}

      {memory.tags && memory.tags.length > 0 && (
        <div className="memory-card__tags">
          {memory.tags.map((tag) => (
            <span key={tag} className="memory-tag">{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}
