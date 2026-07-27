import type { ApprovalRequest } from '../../shared/ipc';
import { prettyApprovalArgs } from '../lib/chat-utils';

interface ApprovalTopBarProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalTopBar({ request, onApprove, onReject }: ApprovalTopBarProps) {
  return (
    <div className="approval-top-bar" role="alertdialog" aria-label="批准危险操作">
      <div className="approval-top-bar__inner">
        <span className="approval-top-bar__icon" aria-hidden>⚠</span>
        <code className="approval-top-bar__tool">{request.toolName}</code>
        <pre className="approval-top-bar__args">{prettyApprovalArgs(request.args)}</pre>
        <div className="approval-top-bar__actions">
          <button className="btn btn-secondary" onClick={onReject} type="button">拒绝</button>
          <button className="btn btn-primary"   onClick={onApprove} type="button">同意执行</button>
        </div>
      </div>
    </div>
  );
}
