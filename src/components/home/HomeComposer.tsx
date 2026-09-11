import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AttachmentMeta, ProjectSummary } from '../../../shared/ipc';
import { AttachmentPicker } from '../attachments/AttachmentPicker';
import { ApprovalModeMenu } from '../chat/ApprovalModeMenu';
import type { ApprovalMode } from '../../lib/navigation';
import { usePresence } from '../../hooks/usePresence';
import { presenceRootProps } from '../../lib/presence-ui';
import { Icon } from '../Icon';

interface HomeComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  busy: boolean;
  attachments: AttachmentMeta[];
  hasWorkDir: boolean;
  projects: ProjectSummary[];
  activeProjectId?: string;
  projectName?: string;
  serverTarget?: { name: string } | null;
  branch: string | null;
  approvalMode: ApprovalMode;
  modelControl?: ReactNode;
  projectControl?: ReactNode;
  onSelectProject: (id: string) => void;
  onCreateProject: (returnFocus?: HTMLElement | null) => void;
  onInputChange: (value: string) => void;
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  onAddPaths: (paths: string[]) => void;
  onPickAttachments: () => void;
  onSend: (returnFocus?: HTMLElement | null) => void;
  onApprovalModeChange: (mode: ApprovalMode) => void;
}

export function HomeComposer(props: HomeComposerProps) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectPresence = usePresence(projectMenuOpen, 120);
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId);

  // 点外部 / Escape 关闭项目下拉
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.home-composer__project-menu')) return;
      setProjectMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjectMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [projectMenuOpen]);

  return (
    <div className="home-composer">
      <div className="home-composer__chips">
        {props.serverTarget
          ? null
          : props.projectControl ?? (
            <span className="home-composer__project-menu">
              <button
                ref={projectTriggerRef}
                className="home-composer__chip home-composer__project"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={projectMenuOpen}
                onClick={() => setProjectMenuOpen((value) => !value)}
              >
                <Icon name="folder" size={13} />
                <span className="home-composer__project-name">
                  {activeProject?.name ?? props.projectName ?? '选择项目'}
                </span>
                <Icon name="chevron-down" size={12} />
              </button>
              {projectPresence.mounted && (
                <div
                  className="home-composer__project-list"
                  role="listbox"
                  aria-label="选择项目"
                  {...presenceRootProps(projectPresence)}
                >
                  {props.projects.map((project) => (
                    <button
                      key={project.id}
                      className={`home-composer__project-item${project.id === props.activeProjectId ? ' active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={project.id === props.activeProjectId}
                      onClick={() => {
                        props.onSelectProject(project.id);
                        setProjectMenuOpen(false);
                      }}
                    >
                      <span className="home-composer__project-item-name">{project.name}</span>
                      {project.id === props.activeProjectId && <Icon name="check" size={13} />}
                    </button>
                  ))}
                  {props.projects.length > 0 && (
                    <span className="home-composer__project-separator" role="separator" />
                  )}
                  <button
                    className="home-composer__project-item home-composer__project-item--new"
                    type="button"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      props.onCreateProject(projectTriggerRef.current);
                    }}
                  >
                    <Icon name="plus" size={13} />
                    <span className="home-composer__project-item-name">新建项目…</span>
                  </button>
                </div>
              )}
            </span>
          )}
        <span className="home-composer__chip home-composer__target">
          <Icon name="server" size={13} />
          {props.serverTarget?.name ?? '本地'}
        </span>
        {props.branch !== null && (
          <span className="home-composer__chip home-composer__branch">
            <Icon name="file-tree" size={13} />
            {props.branch}
          </span>
        )}
      </div>
      <textarea
        ref={props.textareaRef}
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
          disabled={props.busy || !props.hasWorkDir || !!props.serverTarget}
          disabledHint={
            props.serverTarget
              ? '服务器会话暂不支持附件'
              : !props.hasWorkDir
                ? '请先选择或创建项目后再添加附件'
                : undefined
          }
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
