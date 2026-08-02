import type { ApprovalRequest } from '../../shared/ipc';
import { prettyApprovalArgs } from '../lib/chat-utils';
import { Icon } from './Icon';

interface ApprovalTopBarProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalTopBar({ request, onApprove, onReject }: ApprovalTopBarProps) {
  return (
    <div className="approval-top-bar" role="alertdialog" aria-label="确认敏感操作">
      <div className="approval-top-bar__inner">
        <span className="approval-top-bar__icon"><Icon name="shield" size={18} /></span>
        <div className="approval-top-bar__message">
          <span className="approval-top-bar__title">需要确认</span>
          <code className="approval-top-bar__tool">{request.toolName}</code>
        </div>
        <pre className="approval-top-bar__args">{prettyApprovalArgs(request.args)}</pre>
        <div className="approval-top-bar__actions">
          <button className="btn btn-secondary" onClick={onReject} type="button">拒绝</button>
          <button className="btn btn-primary" onClick={onApprove} type="button">允许这一次</button>
        </div>
      </div>
    </div>
  );
}
