import { Icon } from './Icon';

export interface PlanCardStep {
  description: string;
  status: string;
}

interface PlanCardProps {
  steps: PlanCardStep[];
  awaitingApproval?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

function statusLabel(status: string): string {
  if (status === 'completed') return '完成';
  if (status === 'in_progress') return '进行中';
  return '待处理';
}

export function PlanCard({ steps, awaitingApproval, onApprove, onReject }: PlanCardProps) {
  return (
    <div className="tool-card tool-card-plan" role="group" aria-label="执行计划">
      <div className="tool-card-header">
        <span className="tool-card-icon"><Icon name="list" size={14} /></span>
        <span className="tool-card-name">执行计划</span>
        <span className="tool-card-summary">{steps.length} 步</span>
      </div>
      <ol className="plan-steps">
        {steps.map((s, i) => (
          <li key={i} className={`plan-step plan-step-${s.status}`}>
            <span className="plan-step-index">{i + 1}</span>
            <span className="plan-step-text">{s.description}</span>
            <span className="plan-step-status">
              {s.status === 'completed' && <Icon name="check" size={13} />}
              {s.status === 'in_progress' && <span className="plan-step-spinner" aria-hidden="true" />}
              <span className="plan-step-label">{statusLabel(s.status)}</span>
            </span>
          </li>
        ))}
      </ol>
      {awaitingApproval && (
        <div className="plan-actions">
          <button className="btn btn-secondary btn-small" onClick={onReject} type="button">拒绝</button>
          <button className="btn btn-primary btn-small" onClick={onApprove} type="button">批准执行</button>
        </div>
      )}
    </div>
  );
}
