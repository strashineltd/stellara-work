import type { RefObject } from 'react';
import type { ApprovalRequest, PlanApprovalRequest } from '../../../shared/ipc';
import { MarkdownView } from '../MarkdownView';
import { PlanCard } from '../PlanCard';
import { ToolCallCard } from '../ToolCallCard';
import { ToolResultCard } from '../ToolResultCard';
import { DiffCard } from '../DiffCard';
import { ShellCard } from '../ShellCard';
import { ErrorBanner } from '../ErrorBanner';
import { ApprovalTopBar } from '../ApprovalTopBar';
import { Icon } from '../Icon';
import { prettyApprovalArgs, type DisplayEntry } from '../../lib/chat-utils';

interface ChatStreamProps {
  entries: DisplayEntry[];
  busy: boolean;
  streamId: string | null;
  chatRef: RefObject<HTMLElement | null>;
  lastUserForRetry: string | null;
  modelMissing: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
  onAbort: () => void;
  onApprove: (approved: boolean) => void;
  pendingApproval: ApprovalRequest | null;
  /** 等待计划批准（plan_approval_required） */
  pendingPlanApproval?: PlanApprovalRequest | null;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
}

export function ChatStream(props: ChatStreamProps) {
  return (
    <main className="main-chat" id="task-stream" ref={props.chatRef} tabIndex={-1}>
      {props.pendingApproval && (
        <ApprovalTopBar
          request={props.pendingApproval}
          onApprove={() => props.onApprove(true)}
          onReject={() => props.onApprove(false)}
        />
      )}
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
                title="停止当前任务"
              >
                <Icon name="stop" size={14} />
                <span>停止任务</span>
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
      <p className="empty-chat-eyebrow">任务起点</p>
      <h2>把目标和边界写清楚</h2>
      <p className="empty-chat-copy">说明要完成的工作、涉及范围和验收标准。执行过程、文件改动与验证结果会按顺序记录在这里。</p>
      <div className="empty-examples">
        <p>可以这样开始</p>
        <ul>
          <li>阅读 README.md，梳理项目结构和启动方式</li>
          <li>检查当前改动，定位仍未解决的类型错误</li>
          <li>运行测试并解释失败原因，不要直接修改代码</li>
        </ul>
      </div>
    </div>
  );
}

function UserEntry({ content }: { content: string }) {
  return (
    <div className="message message-user">
      <div className="message-role">任务简报</div>
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
      <div className="message-role">执行记录</div>
      <div className="message-content">
        {content
          ? <MarkdownView content={content} />
          : busy
            ? <span className="thinking">正在分析任务…</span>
            : <span className="empty-placeholder">[该消息未生成内容]</span>}
        {canRetry && !busy && (
          <button className="btn btn-secondary btn-retry" onClick={onRetry} type="button">
            <Icon name="refresh" size={14} />
            <span>再试一次</span>
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
            文件 ({entry.files.length})
          </summary>
          <ul className="report-file-list">
            {entry.files.map((f, i) => (
              <li key={i} className="report-file-item">
                <span className="report-file-icon" aria-hidden="true">
                  <Icon name={f.kind === 'write' ? 'file' : 'edit'} size={13} />
                </span>
                <code className="report-file-path">{f.path}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {entry.commands.length > 0 && (
        <details className="report-section">
          <summary className="report-section-header">
            命令 ({entry.commands.length})
          </summary>
          <div className="report-command-list">
            {entry.commands.map((c, i) => (
              <div key={i} className={`report-command-item ${c.ok ? 'ok' : 'fail'}`}>
                <code className="report-command-text">{c.command}</code>
                <span className="report-command-exit">
                  exit {c.exitCode} · {c.ok ? '通过' : '失败'}
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
