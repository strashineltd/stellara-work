import type { RefObject } from 'react';
import type { ApprovalRequest, PlanApprovalRequest } from '../../../shared/ipc';
import { MarkdownView } from '../MarkdownView';
import { PlanCard } from '../PlanCard';
import { ToolCallCard } from '../ToolCallCard';
import { ToolResultCard } from '../ToolResultCard';
import { DiffCard } from '../DiffCard';
import { ShellCard } from '../ShellCard';
import { ErrorBanner } from '../ErrorBanner';
import { prettyApprovalArgs, type DisplayEntry } from '../../lib/chat-utils';

interface ChatStreamProps {
  entries: DisplayEntry[];
  busy: boolean;
  streamId: string | null;
  chatRef: RefObject<HTMLElement>;
  lastUserForRetry: string | null;
  modelMissing: boolean;
  /** M0：是否可以发起审查（任务完成且修改过文件） */
  reviewRequested?: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
  onAbort: () => void;
  onApprove: (approved: boolean) => void;
  onReview?: () => void;
  pendingApproval: ApprovalRequest | null;
  /** 等待计划批准（plan_approval_required） */
  pendingPlanApproval?: PlanApprovalRequest | null;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}

export function ChatStream(props: ChatStreamProps) {
  return (
    <main className="main-chat" ref={props.chatRef}>
      {props.modelMissing && (
        <div className="model-missing-banner">
          <span>此会话引用的模型已被删除。</span>
          <button className="btn btn-secondary btn-small" onClick={props.onOpenSettings} type="button">
            去设置重新配置
          </button>
        </div>
      )}
      {props.entries.length === 0 ? (
        <EmptyChat />
      ) : (
        <div className="messages">
          {props.entries.map((e, i) => (
            <div key={i} className="entry">
              {e.kind === 'user' && <UserEntry content={e.content} />}
              {e.kind === 'assistant' && (
                <AssistantEntry
                  content={e.content}
                  busy={props.busy}
                  canRetry={!!props.lastUserForRetry && e.content.includes('[连接错误]')}
                  onRetry={() => props.onRetry()}
                />
              )}
              {e.kind === 'tool_call' && <ToolCallCard name={e.name} args={e.args} />}
              {e.kind === 'tool_result' && e.meta?.kind === 'edit' && (
                <DiffCard path={e.meta.path} before={e.meta.before} after={e.meta.after} />
              )}
              {e.kind === 'tool_result' && e.meta?.kind === 'command' && (
                <ShellCard
                  command={e.meta.command}
                  stdout={e.meta.stdout}
                  stderr={e.meta.stderr}
                  exitCode={e.meta.exitCode}
                  durationMs={e.meta.durationMs}
                  ok={e.ok}
                />
              )}
              {e.kind === 'tool_result' && !e.meta && (
                <ToolResultCard name={e.name} ok={e.ok} output={e.output} error={e.error} />
              )}
              {e.kind === 'summary' && (
                <div className="summary-banner" title="上下文已被压缩，老消息被摘要替换">
                  <div className="summary-banner-title">
                    已压缩 {e.compressedCount} 条消息（{e.tokensBefore} → {e.tokensAfter} tokens）
                  </div>
                  {e.summary && <pre className="summary-banner-preview">{e.summary}</pre>}
                </div>
              )}
              {e.kind === 'plan' && (
                <PlanCard
                  steps={e.steps}
                  awaitingApproval={!!props.pendingPlanApproval}
                  onApprove={() => props.onApprovePlan?.()}
                  onReject={() => props.onRejectPlan?.()}
                />
              )}
              {e.kind === 'verify' && (
                <div className="verify-chip" role="status">
                  验证中{e.target ? ` · ${e.target}` : ''}
                </div>
              )}
              {e.kind === 'error' && (
                <ErrorBanner
                  message={e.message}
                  meta={e.meta}
                  onOpenSettings={() => props.onOpenSettings()}
                  onSwitchModel={() => props.onOpenSettings()}
                  onRetry={() => props.onRetry()}
                />
              )}
              {e.kind === 'report' && <ReportEntry entry={e} />}
            </div>
          ))}
          {props.busy && (
            <div className="busy-actions">
              <button
                className="btn btn-stop"
                onClick={() => { if (props.streamId) props.onAbort(); }}
                type="button"
                title="中断当前 agent 任务"
              >
                停止
              </button>
            </div>
          )}
          {!props.busy && props.reviewRequested && props.onReview && (
            <div className="busy-actions">
              <button
                className="btn btn-review"
                onClick={() => props.onReview!()}
                type="button"
                title="调度 reviewer agent 审查本次任务的结果"
              >
                审查代码
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

// --- 子组件 ---

function EmptyChat() {
  return (
    <div className="empty-chat">
      <h2>开始一个新的任务</h2>
      <p>在下方输入你的需求，agent 会在工作目录里读 / 写文件、跑命令、汇报结果。</p>
      <div className="empty-examples">
        <p>试试这些：</p>
        <ul>
          <li>"读 README.md 然后总结一下"</li>
          <li>"在 src/utils/ 新增一个 helper.ts 实现字符串反转"</li>
          <li>"跑 npm test 看哪些挂了"</li>
        </ul>
      </div>
    </div>
  );
}

function UserEntry({ content }: { content: string }) {
  return (
    <div className="message message-user">
      <div className="message-role">你</div>
      <div className="message-content">
        <pre className="user-text">{content}</pre>
      </div>
    </div>
  );
}

function AssistantEntry({
  content,
  busy,
  canRetry,
  onRetry,
}: {
  content: string;
  busy: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="message message-assistant">
      <div className="message-role">Agent</div>
      <div className="message-content">
        {content
          ? <MarkdownView content={content} />
          : busy
            ? <span className="thinking">思考中...</span>
            : <span className="empty-placeholder">[该消息未生成内容]</span>}
        {canRetry && !busy && (
          <button className="btn btn-secondary btn-retry" onClick={onRetry} type="button">
            ↻ 再试一次
          </button>
        )}
      </div>
    </div>
  );
}

function ReportEntry({ entry }: { entry: Extract<DisplayEntry, { kind: 'report' }> }) {
  return (
    <div className="report-card">
      <div className="report-card-header">
        <span className="report-card-title">任务完成</span>
      </div>
      <div className="report-body">
        <MarkdownView content={entry.summary} />
      </div>
      {entry.files.length > 0 && (
        <details className="report-section" open>
          <summary className="report-section-header">
            Files ({entry.files.length})
          </summary>
          <ul className="report-file-list">
            {entry.files.map((f, i) => (
              <li key={i} className="report-file-item">
                <span className="report-file-icon">{f.kind === 'write' ? '+' : '~'}</span>
                <code className="report-file-path">{f.path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {entry.commands.length > 0 && (
        <details className="report-section">
          <summary className="report-section-header">
            Commands ({entry.commands.length})
          </summary>
          <div className="report-command-list">
            {entry.commands.map((c, i) => (
              <div key={i} className={`report-command-item ${c.ok ? 'ok' : 'fail'}`}>
                <code className="report-command-text">{c.command}</code>
                <span className="report-command-exit">
                  exit {c.exitCode} {c.ok ? 'ok' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// 让旧代码用到的 utility 还能找到（如果有别的 import）
export { prettyApprovalArgs };