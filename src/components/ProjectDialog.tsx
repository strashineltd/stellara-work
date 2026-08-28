import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { Project, ProjectFileSelection, ProjectSummary } from '../../shared/ipc';
import { Icon } from './Icon';
import { basename } from '../lib/chat-utils';
import { presenceRootProps, type PresenceMotionProps } from '../lib/presence-ui';

interface ProjectDialogProps extends PresenceMotionProps {
  mode?: 'create' | 'edit';
  project?: ProjectSummary;
  workDir?: string;
  onCreate?: (name: string, selection: { workDir: string; entryFile?: string }) => void | Promise<void>;
  onRename?: (id: string, name: string) => void | Promise<void>;
  onUpdateFile?: (id: string, selection: ProjectFileSelection) => Project | Promise<Project>;
  onClose: () => void;
}

type DialogFeedback = {
  kind: 'success' | 'error';
  message: string;
  scope: 'name' | 'file';
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectDialog({ mode = 'edit', project, workDir, onCreate, onRename, onUpdateFile, onClose, presence }: ProjectDialogProps) {
  const isCreateMode = mode === 'create';
  const initialName = isCreateMode ? '' : (project?.name ?? '');
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [projectWorkDir, setProjectWorkDir] = useState(workDir ?? project?.workDir ?? '');
  const [selectedFile, setSelectedFile] = useState<string | null>(project?.entryFile ?? null);
  const [busyAction, setBusyAction] = useState<'createProject' | 'rename' | 'pick' | 'open' | null>(null);
  const [feedback, setFeedback] = useState<DialogFeedback | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const focusAfterResetRef = useRef(false);
  const isBusy = busyAction !== null;
  const presenceState = presence?.state;
  const isClosing = presenceState === 'closing';

  useLayoutEffect(() => {
    const freshOpenMount = !initializedRef.current && !isClosing;
    initializedRef.current = true;
    if (isClosing) {
      operationGenerationRef.current += 1;
      focusAfterResetRef.current = false;
      return;
    }
    if (presenceState && presenceState !== 'entering' && !freshOpenMount) return;
    operationGenerationRef.current += 1;
    focusAfterResetRef.current = true;
    const nextName = mode === 'create' ? '' : (project?.name ?? '');
    setName(nextName);
    setSavedName(nextName);
    setProjectWorkDir(workDir ?? project?.workDir ?? '');
    setSelectedFile(project?.entryFile ?? null);
    setBusyAction(null);
    setFeedback(null);
  }, [isClosing, mode, presenceState, project?.entryFile, project?.id, project?.name, project?.workDir, workDir]);

  useLayoutEffect(() => {
    const input = nameInputRef.current;
    if (!focusAfterResetRef.current || !input || input.disabled) return;
    focusAfterResetRef.current = false;
    input.focus({ preventScroll: true });
  });

  useLayoutEffect(() => () => {
    operationGenerationRef.current += 1;
    focusAfterResetRef.current = false;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy && !isClosing) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, isClosing, onClose]);

  async function handleNameSubmit(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim().slice(0, 50);
    if (!nextName) {
      setFeedback({ kind: 'error', message: '项目名称不能为空', scope: 'name' });
      nameInputRef.current?.focus();
      return;
    }
    if (isCreateMode) {
      if (!onCreate) return;
      if (!projectWorkDir) {
        setFeedback({ kind: 'error', message: '请先选择工作区文件夹或入口文件', scope: 'file' });
        return;
      }
      const operationGeneration = ++operationGenerationRef.current;
      setBusyAction('createProject');
      setFeedback(null);
      try {
        await onCreate(nextName, { workDir: projectWorkDir, entryFile: selectedFile ?? undefined });
      } catch (error) {
        if (operationGenerationRef.current !== operationGeneration) return;
        setFeedback({ kind: 'error', message: `项目创建失败：${errorMessage(error)}`, scope: 'name' });
        requestAnimationFrame(() => {
          if (operationGenerationRef.current === operationGeneration) nameInputRef.current?.focus();
        });
      } finally {
        if (operationGenerationRef.current === operationGeneration) setBusyAction(null);
      }
      return;
    }

    if (!project || !onRename || nextName === savedName) return;

    const operationGeneration = ++operationGenerationRef.current;
    setBusyAction('rename');
    setFeedback(null);
    try {
      await onRename(project.id, nextName);
      if (operationGenerationRef.current !== operationGeneration) return;
      setName(nextName);
      setSavedName(nextName);
      setFeedback({ kind: 'success', message: '项目名称已保存', scope: 'name' });
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) return;
      setFeedback({ kind: 'error', message: `名称保存失败：${errorMessage(error)}`, scope: 'name' });
      requestAnimationFrame(() => {
        if (operationGenerationRef.current === operationGeneration) nameInputRef.current?.focus();
      });
    } finally {
      if (operationGenerationRef.current === operationGeneration) setBusyAction(null);
    }
  }

  async function handlePickEntry() {
    const operationGeneration = ++operationGenerationRef.current;
    setBusyAction('pick');
    setFeedback(null);
    try {
      const result = await window.electronAPI.dialog.selectProjectDir();
      if (operationGenerationRef.current !== operationGeneration || !result) return;
      if (!isCreateMode && project && onUpdateFile && result.entryFile) {
        await onUpdateFile(project.id, { path: result.entryFile, workDir: result.workDir });
        if (operationGenerationRef.current !== operationGeneration) return;
      }
      setProjectWorkDir(result.workDir);
      setSelectedFile(result.entryFile ?? null);
      setFeedback({ kind: 'success', message: `已选择 ${basename(result.entryFile ?? result.workDir)}`, scope: 'file' });
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) return;
      setFeedback({ kind: 'error', message: `选择失败：${errorMessage(error)}`, scope: 'file' });
    } finally {
      if (operationGenerationRef.current === operationGeneration) setBusyAction(null);
    }
  }

  async function handleOpenFolder() {
    if (!projectWorkDir) return;
    const operationGeneration = ++operationGenerationRef.current;
    setBusyAction('open');
    setFeedback(null);
    try {
      await window.electronAPI.fs.openPath(projectWorkDir, projectWorkDir);
      if (operationGenerationRef.current !== operationGeneration) return;
      setFeedback({ kind: 'success', message: '已打开项目文件夹', scope: 'file' });
    } catch (error) {
      if (operationGenerationRef.current !== operationGeneration) return;
      setFeedback({ kind: 'error', message: `打开文件夹失败：${errorMessage(error)}`, scope: 'file' });
    } finally {
      if (operationGenerationRef.current === operationGeneration) setBusyAction(null);
    }
  }

  const nameDirty = name.trim() !== savedName;

  function handleClose() {
    if (!isBusy && !isClosing) onClose();
  }

  return (
    <div className="modal-backdrop project-dialog-backdrop" {...presenceRootProps(presence)} onClick={handleClose}>
      <section
        className="modal project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        aria-busy={isBusy}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="project-dialog-header">
          <div>
            <span className="project-dialog-kicker">{isCreateMode ? '新项目' : '项目'}</span>
            <h2 id="project-dialog-title">{isCreateMode ? '创建项目' : '项目设置'}</h2>
          </div>
          <button className="btn-icon" type="button" aria-label="关闭项目窗口" onClick={handleClose} disabled={isBusy}>
            <Icon name="x" />
          </button>
        </header>

        <form id="project-dialog-name-form" className="project-dialog-name-form" onSubmit={(event) => void handleNameSubmit(event)}>
          <label htmlFor="project-dialog-name">
            项目名称
            {isCreateMode && <span className="project-dialog-required">必填</span>}
          </label>
          <div className={`project-dialog-name-row${isCreateMode ? ' project-dialog-name-row--create' : ''}`}>
            <input
              ref={nameInputRef}
              id="project-dialog-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              disabled={isBusy}
              autoFocus
              autoComplete="off"
              placeholder={isCreateMode ? '例如：品牌网站' : undefined}
              required={isCreateMode}
            />
            {!isCreateMode && (
              <button className="btn btn-primary" type="submit" disabled={isBusy || !nameDirty || !name.trim()}>
                {busyAction === 'rename' ? '保存中…' : '保存名称'}
              </button>
            )}
          </div>
          <p>{isCreateMode ? '项目将在完成设置后创建，关闭窗口不会生成占位项目。' : '名称会同步到项目列表，现有工作记录不会改变。'}</p>
          {feedback?.scope === 'name' && (
            <div className={`project-dialog-feedback project-dialog-feedback--${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
              <Icon name={feedback.kind === 'error' ? 'alert' : 'check'} size={14} />
              <span>{feedback.message}</span>
            </div>
          )}
        </form>

        <section className="project-dialog-files" aria-labelledby="project-dialog-files-title">
          <div className="project-dialog-section-heading">
            <div>
              <h3 id="project-dialog-files-title">项目入口文件{isCreateMode ? '（可选）' : ''}</h3>
              <p>{isCreateMode ? '选择文件夹或文件作为项目工作区，入口文件可选。' : '可重新选择入口文件或文件夹，项目工作区会同步切换。'}</p>
            </div>
            <code title={projectWorkDir}>{projectWorkDir ? basename(projectWorkDir) : '尚未选择'}</code>
          </div>

          <div className="project-file-actions">
            {isCreateMode ? (
            <div className="project-file-action project-file-action--split">
              <button
                type="button"
                className="project-file-action__main"
                onClick={() => void handlePickEntry()}
                disabled={isBusy}
              >
                <Icon name="folder" size={16} />
                <span>
                  <strong>{busyAction === 'pick' ? '正在选择…' : '选择文件夹或文件'}</strong>
                  <small>可同时选择文件夹或文件</small>
                </span>
              </button>
              <button
                type="button"
                className="project-file-action__open"
                onClick={() => void handleOpenFolder()}
                disabled={isBusy || !projectWorkDir}
                title="在系统文件管理器中打开"
              >
                <Icon name="arrow-right" size={14} />
                <span>打开文件夹</span>
              </button>
            </div>
            ) : (
            <button type="button" className="project-file-action" onClick={() => void handlePickEntry()} disabled={isBusy}>
              <Icon name="folder" size={16} />
              <span>
                <strong>{busyAction === 'pick' ? '正在选择…' : '选择文件夹或文件'}</strong>
                <small>可同时选择文件夹或文件</small>
              </span>
            </button>
            )}
          </div>

          {!selectedFile && (
            <p className="project-dialog-empty" role="status">{isCreateMode ? '尚未选择入口文件（可选），不会影响项目创建。' : '程序不会预设工作项目。请为这个项目选择一个入口文件。'}</p>
          )}

          {projectWorkDir && (
            <div className="project-selected-file">
              <Icon name="folder" size={16} />
              <div>
                <strong>{basename(projectWorkDir)}</strong>
                <code title={projectWorkDir}>{projectWorkDir}</code>
              </div>
              <button className="btn btn-secondary" type="button" onClick={() => void handleOpenFolder()} disabled={isBusy}>
                {busyAction === 'open' ? '打开中…' : '打开文件夹'}
              </button>
            </div>
          )}

          {feedback?.scope === 'file' && (
            <div className={`project-dialog-feedback project-dialog-feedback--${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
              <Icon name={feedback.kind === 'error' ? 'alert' : 'check'} size={14} />
              <span>{feedback.message}</span>
            </div>
          )}
        </section>

        <footer className="project-dialog-footer">
          {isCreateMode ? (
            <>
              <button className="btn btn-secondary" type="button" onClick={handleClose} disabled={isBusy}>取消</button>
              <button className="btn btn-primary" type="submit" form="project-dialog-name-form" disabled={isBusy || !name.trim() || !projectWorkDir}>
                {busyAction === 'createProject' ? '创建中…' : '创建项目'}
              </button>
            </>
          ) : (
            <button className="btn btn-secondary" type="button" onClick={handleClose} disabled={isBusy}>完成</button>
          )}
        </footer>
      </section>
    </div>
  );
}
