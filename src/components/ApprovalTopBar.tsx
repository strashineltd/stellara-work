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
  const browserSummary = browserApprovalSummary(request.toolName, request.args);
  return (
    <div className="approval-top-bar motion-feedback-enter" role="alertdialog" aria-label="确认敏感操作">
      <div className="approval-top-bar__inner">
        <span className="approval-top-bar__icon"><Icon name="shield" size={18} /></span>
        <div className="approval-top-bar__message">
          <span className="approval-top-bar__title">
            {subagentDefId ? `子代理 ${subagentDefId} 请求：` : '需要确认'}
          </span>
          <code className="approval-top-bar__tool">{request.toolName}</code>
        </div>
        {browserSummary && (
          <div className="approval-top-bar__browser-summary">{browserSummary}</div>
        )}
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

/**
 * 浏览器审批摘要（无新通道：仅解析现有 args JSON）。
 * 显示 `toolName: 域名 · 动作`，便于用户一眼确认目标与动作。
 */
export function browserApprovalSummary(toolName: string, argsJson: string): string | null {
  if (!toolName.startsWith('browser_')) return null;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return toolName;
  }
  const parts: string[] = [];
  if (typeof args.url === 'string' && args.url) {
    try {
      parts.push(new URL(args.url).hostname);
    } catch {
      parts.push(args.url);
    }
  }
  if (typeof args.action === 'string' && args.action) parts.push(args.action);
  else if (typeof args.op === 'string' && args.op) parts.push(args.op);
  else if (typeof args.kind === 'string' && args.kind) parts.push(args.kind);
  if (typeof args.targetId === 'string' && args.targetId) parts.push(args.targetId);
  if (typeof args.text === 'string' && args.text.trim()) parts.push(args.text.slice(0, 50));
  const detail = parts.length > 0 ? parts.join(' · ') : '浏览器操作';
  return `${toolName}: ${detail}`;
}
