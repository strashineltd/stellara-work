import type { Memory } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface MemoryCardProps {
  memory: Memory;
  onEdit: (memory: Memory) => void;
  onDelete: (id: string) => void;
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

export function MemoryCard({ memory, onEdit, onDelete }: MemoryCardProps) {
  const kindLabel = KIND_LABELS[memory.kind] ?? memory.kind;
  const scopeLabel = SCOPE_LABELS[memory.scope] ?? memory.scope;
  const confidencePct = Math.round(memory.confidence * 100);
  const importancePct = Math.round(memory.importance * 100);

  return (
    <div className="memory-card">
      <div className="memory-card__header">
        <span className="memory-card__kind">{kindLabel}</span>
        <span className="memory-card__scope">{scopeLabel}</span>
        <span className="memory-card__confidence">置信度 {confidencePct}%</span>
      </div>
      <p className="memory-card__content">{memory.content}</p>
      <div className="memory-card__meta">
        <div className="memory-card__importance">
          <span className="memory-card__importance-label">重要性</span>
          <div className="memory-card__importance-bar">
            <div
              className="memory-card__importance-fill"
              style={{ width: `${importancePct}%` }}
            />
          </div>
          <span className="memory-card__importance-value">{importancePct}%</span>
        </div>
        {memory.tags && memory.tags.length > 0 && (
          <div className="memory-card__tags">
            {memory.tags.map((tag) => (
              <span key={tag} className="memory-card__tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <div className="memory-card__actions">
        <button
          className="memory-card__action"
          type="button"
          onClick={() => onEdit(memory)}
          aria-label="编辑记忆"
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          className="memory-card__action memory-card__action--danger"
          type="button"
          onClick={() => {
            if (window.confirm('确定删除这条记忆？')) {
              onDelete(memory.id);
            }
          }}
          aria-label="删除记忆"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
