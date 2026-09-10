import { useRef, type ReactNode } from 'react';
import type { AttachmentMeta } from '../../../shared/ipc';
import { AttachmentPicker } from '../attachments/AttachmentPicker';
import { ApprovalModeMenu } from '../chat/ApprovalModeMenu';
import type { ApprovalMode } from '../../lib/navigation';
import { Icon } from '../Icon';

interface HomeComposerProps {
  input: string;
  busy: boolean;
  attachments: AttachmentMeta[];
  hasWorkDir: boolean;
  projectName?: string;
  branch: string | null;
  approvalMode: ApprovalMode;
  modelControl?: ReactNode;
  projectControl?: ReactNode;
  onInputChange: (value: string) => void;
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  onAddPaths: (paths: string[]) => void;
  onPickAttachments: () => void;
  onSend: (returnFocus?: HTMLElement | null) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}

export function HomeComposer(props: HomeComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="home-composer">
      <div className="home-composer__chips">
        {props.projectControl ?? (
          <span className="home-composer__chip home-composer__project">
            <Icon name="folder" size={13} />
            {props.projectName ?? '选择项目'}
          </span>
        )}
        <span className="home-composer__chip home-composer__target">
          <Icon name="server" size={13} />
          本地
        </span>
        {props.branch !== null && (
          <span className="home-composer__chip home-composer__branch">
            <Icon name="file-tree" size={13} />
            {props.branch}
          </span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        rows={3}
        value={props.input}
        disabled={props.busy}
        aria-label="输入任务"
        placeholder="随心输入"
        onChange={(event) => props.onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            props.onSend(event.currentTarget);
          }
        }}
      />
      <div className="home-composer__footer">
        <AttachmentPicker
          attachments={props.attachments}
          onAttachmentsChange={props.onAttachmentsChange}
          onPick={props.onPickAttachments}
          onAddPaths={props.onAddPaths}
          disabled={props.busy || !props.hasWorkDir}
        />
        <ApprovalModeMenu mode={props.approvalMode} onModeChange={props.onApprovalModeChange} disabled={props.busy} />
        {props.modelControl}
        <button
          className="home-composer__send"
          type="button"
          aria-label="发送"
          disabled={props.busy || !props.input.trim()}
          onClick={(event) => props.onSend(event.currentTarget)}
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}
