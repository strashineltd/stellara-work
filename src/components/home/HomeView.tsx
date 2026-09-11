import type { ConfiguredModel, ProjectSummary, AttachmentMeta } from '../../../shared/ipc';
import type { ApprovalMode } from '../../lib/navigation';
import { CapabilityCards } from './CapabilityCards';
import { HomeComposer } from './HomeComposer';
import { Icon } from '../Icon';
import { useRef, type ReactNode } from 'react';

interface HomeViewProps {
  config: ConfiguredModel | null;
  projects: ProjectSummary[];
  activeProjectId?: string;
  branch: string | null;
  input: string;
  busy: boolean;
  attachments: AttachmentMeta[];
  hasWorkDir: boolean;
  approvalMode: ApprovalMode;
  modelMissing?: boolean;
  modelControl?: ReactNode;
  projectControl?: ReactNode;
  serverTarget?: { name: string } | null;
  onOpenSettings?: () => void;
  onInputChange: (value: string) => void;
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  onAddPaths: (paths: string[]) => void;
  onPickAttachments: () => void;
  onSend: (returnFocus?: HTMLElement | null) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}

export function HomeView(props: HomeViewProps) {
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <main className="home-view" aria-labelledby="home-title" data-motion="page-enter">
      {props.modelMissing && (
        <div className="no-model-banner" role="alert">
          <Icon name="alert" size={15} />
          <span>尚未配置模型，Agent 暂时无法执行任务。</span>
          <button className="no-model-banner__btn no-model-banner__btn--settings" type="button" onClick={props.onOpenSettings}>
            去设置
          </button>
        </div>
      )}
      <div className="home-view__center">
        <span className="home-view__glyph" aria-hidden="true"><Icon name="terminal" size={22} /></span>
        <h1 id="home-title">你想让我们在 Stellara Work 中构建什么?</h1>
        <CapabilityCards
          onPick={(prompt) => {
            props.onInputChange(prompt);
            textareaRef.current?.focus();
          }}
        />
      </div>
      <HomeComposer
        textareaRef={textareaRef}
        input={props.input}
        busy={props.busy}
        attachments={props.attachments}
        hasWorkDir={props.hasWorkDir}
        projectName={activeProject?.name}
        serverTarget={props.serverTarget}
        branch={props.branch}
        approvalMode={props.approvalMode}
        modelControl={props.modelControl}
        projectControl={props.projectControl}
        onInputChange={props.onInputChange}
        onAttachmentsChange={props.onAttachmentsChange}
        onAddPaths={props.onAddPaths}
        onPickAttachments={props.onPickAttachments}
        onSend={props.onSend}
        onApprovalModeChange={props.onApprovalModeChange}
      />
    </main>
  );
}
