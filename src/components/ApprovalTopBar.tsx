import type { ApprovalRequest } from '../../shared/ipc';
import { prettyApprovalArgs } from '../lib/chat-utils';
import { Icon } from './Icon';

interface ApprovalTopBarProps {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalTopBar({ request, onApprove, onReject }: ApprovalTopBarProps) {
  const subagentDefId = parseSubagentDefId(request.id);
  return (
    <div className="approval-top-bar" role="alertdialog" aria-label="确认敏感操作">
      <div className="approval-top-bar__inner">
        <span className="approval-top-bar__icon"><Icon name="shield" size={18} /></span>
        <div className="approval-top-bar__message">
          <span className="approval-top-bar__title">
            {subagentDefId ? `子代理 ${subagentDefId} 请求：` : '需要确认'}
          </span>
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

/**
 * 从审批 id 解析子代理 def.id。主进程格式：sub-{defId}-{ts}-{rand}；
 * 兼容旧格式（sub- 前缀的任意 id）时取第一段。
 */
function parseSubagentDefId(approvalId: string): string | null {
  if (!approvalId.startsWith('sub-')) return null;
  const body = approvalId.slice(4);
  const m = body.match(/^(.+)-(\d+)-[a-z0-9]{6}$/);
  return m ? m[1] : body.split('-')[0] ?? null;
}
