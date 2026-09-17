import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  ModelListItem, ProjectSummary, ScheduledRun, ScheduledTask, ScheduledTaskInput,
  ScheduledTaskKind, ServerEntry,
} from '../../shared/ipc';
import { usePresence } from '../hooks/usePresence';
import { captureFocusTarget, presenceRootProps, restoreFocusTarget, type PresenceMotionProps } from '../lib/presence-ui';
import { Icon } from './Icon';

export interface ScheduledTasksProps {
  /** 历史记录中的会话跳转：切换到任务页并打开该会话 */
  onOpenSession?: (sessionId: string) => void;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  success: '成功',
  error: '失败',
  missed: '错过',
  aborted: '已中止',
};

const KIND_LABELS: Record<ScheduledTaskKind, string> = {
  once: '一次性时间',
  interval: '每隔一段时间',
  cron: 'Cron 表达式',
};

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: '每 5 分钟', expr: '*/5 * * * *' },
  { label: '每小时', expr: '0 * * * *' },
  { label: '每天 9:00', expr: '0 9 * * *' },
  { label: '每周一 9:00', expr: '0 9 * * 1' },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatDuration(startedAt: number, finishedAt: number | null | undefined): string {
  if (finishedAt == null) return '—';
  const totalSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

/** ISO 字符串 → datetime-local 输入值（本地时区） */
function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 间隔分钟数 → 表单字段（整小时显示为“小时”） */
function intervalToFields(expr: string): { amount: string; unit: 'minutes' | 'hours' } {
  const minutes = Number(expr);
  if (Number.isFinite(minutes) && minutes >= 60 && minutes % 60 === 0) {
    return { amount: String(minutes / 60), unit: 'hours' };
  }
  return { amount: expr, unit: 'minutes' };
}

export function ScheduledTasks({ onOpenSession }: ScheduledTasksProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [editor, setEditor] = useState<{ present: boolean; task: ScheduledTask | null }>({
    present: false,
    task: null,
  });
  const [history, setHistory] = useState<{ present: boolean; task: ScheduledTask | null }>({
    present: false,
    task: null,
  });
  const editorPresence = usePresence(editor.present);
  const historyPresence = usePresence(history.present);
  const editorReturnFocusRef = useRef<HTMLElement | null>(null);
  const historyReturnFocusRef = useRef<HTMLElement | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const list = await window.electronAPI.scheduled.list();
      setTasks(list);
      setListError(null);
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    return window.electronAPI.scheduled.onChanged(() => {
      void loadTasks();
    });
  }, [loadTasks]);

  useEffect(() => {
    let alive = true;
    void window.electronAPI.servers.list()
      .then((list) => { if (alive) setServers(list); })
      .catch(() => { /* 无法读取服务器列表时仅影响选择项 */ });
    void window.electronAPI.models.getAll()
      .then((list) => { if (alive) setModels(list); })
      .catch(() => { /* ignore */ });
    void window.electronAPI.projects.list()
      .then((list) => { if (alive) setProjects(list); })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, []);

  function openEditor(task: ScheduledTask | null, returnFocus?: HTMLElement | null) {
    if (editor.present || history.present) return;
    editorReturnFocusRef.current = captureFocusTarget(returnFocus);
    setEditor({ present: true, task });
  }

  function closeEditor() {
    if (!editor.present) return;
    restoreFocusTarget(editorReturnFocusRef.current);
    setEditor((current) => ({ ...current, present: false }));
  }

  function openHistory(task: ScheduledTask, returnFocus?: HTMLElement | null) {
    if (editor.present || history.present) return;
    historyReturnFocusRef.current = captureFocusTarget(returnFocus);
    setHistory({ present: true, task });
  }

  function closeHistory() {
    if (!history.present) return;
    restoreFocusTarget(historyReturnFocusRef.current);
    setHistory((current) => ({ ...current, present: false }));
  }

  async function handleSaveEditor(input: ScheduledTaskInput) {
    if (editor.task) {
      await window.electronAPI.scheduled.update(editor.task.id, {
        name: input.name,
        prompt: input.prompt,
        projectId: input.projectId ?? null,
        workDir: input.workDir ?? null,
        runtime: input.runtime,
        serverId: input.serverId ?? null,
        modelId: input.modelId ?? null,
        scheduleKind: input.scheduleKind,
        scheduleExpr: input.scheduleExpr,
        allowDangerous: input.allowDangerous ?? false,
      });
    } else {
      await window.electronAPI.scheduled.create(input);
    }
    await loadTasks();
    closeEditor();
  }

  async function handleToggle(task: ScheduledTask) {
    try {
      await window.electronAPI.scheduled.toggle(task.id);
      await loadTasks();
    } catch (error) {
      await loadTasks();
      setListError(errorMessage(error));
    }
  }

  async function handleRunNow(task: ScheduledTask) {
    setListError(null);
    try {
      await window.electronAPI.scheduled.runNow(task.id);
    } catch (error) {
      setListError(errorMessage(error));
    }
  }

  async function handleDelete(task: ScheduledTask) {
    if (!window.confirm(`删除任务「${task.name}」？该操作不可撤销。`)) return;
    try {
      await window.electronAPI.scheduled.remove(task.id);
      await loadTasks();
    } catch (error) {
      setListError(errorMessage(error));
    }
  }

  function runtimeLabel(task: ScheduledTask): string {
    if (task.runtime === 'local') return '本地';
    const server = servers.find((entry) => entry.id === task.serverId);
    return server?.name ?? '服务器';
  }

  function nextRunLabel(task: ScheduledTask): string {
    if (!task.enabled) return '已停用';
    if (task.nextRunAt == null) return '无';
    return formatDateTime(task.nextRunAt);
  }

  function lastStatusLabel(task: ScheduledTask): string {
    if (!task.lastStatus) return '—';
    return RUN_STATUS_LABELS[task.lastStatus] ?? task.lastStatus;
  }

  return (
    <div className="scheduled-page" data-motion="page-enter" data-page="scheduled">
      <header className="scheduled-page__header">
        <div>
          <h1>已安排</h1>
          <p className="scheduled-page__sub">按计划自动运行本地或服务器任务；关闭窗口后可在后台继续</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={(event) => openEditor(null, event.currentTarget)}
        >
          新建任务
        </button>
      </header>

      {listError && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{listError}</div>
        </div>
      )}

      {loading && tasks.length === 0 && <p className="scheduled-page__hint">加载中…</p>}

      {!loading && tasks.length === 0 && (
        <div className="scheduled-empty">
          <div className="scheduled-empty__art">
            <Icon name="calendar" size={30} />
          </div>
          <h3>还没有定时任务</h3>
          <p>创建任务后，Agent 会按计划自动运行，并在历史中保留每次执行记录</p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={(event) => openEditor(null, event.currentTarget)}
          >
            新建任务
          </button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="scheduled-task-list">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="scheduled-task-row"
              data-task-id={task.id}
              data-enabled={task.enabled}
            >
              <div className="scheduled-task-row__main">
                <div className="scheduled-task-row__title">
                  <strong>{task.name}</strong>
                  <span className={`scheduled-badge scheduled-badge--${task.runtime}`}>
                    {runtimeLabel(task)}
                  </span>
                  <span className="scheduled-badge scheduled-badge--kind">
                    {KIND_LABELS[task.scheduleKind] ?? task.scheduleKind}
                  </span>
                </div>
                <p className="scheduled-task-row__prompt" title={task.prompt}>{task.prompt}</p>
                <div className="scheduled-task-row__meta">
                  <span>下次运行：{nextRunLabel(task)}</span>
                  <span>最近：{lastStatusLabel(task)}</span>
                </div>
              </div>
              <div className="scheduled-task-row__actions">
                <button className="btn btn-ghost btn-small" type="button" onClick={() => void handleRunNow(task)}>
                  立即运行
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  onClick={(event) => openEditor(task, event.currentTarget)}
                >
                  编辑
                </button>
                <button className="btn btn-ghost btn-small" type="button" onClick={() => void handleDelete(task)}>
                  删除
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  type="button"
                  onClick={(event) => openHistory(task, event.currentTarget)}
                >
                  历史
                </button>
                <button
                  className={`settings-switch${task.enabled ? ' on' : ''}`}
                  role="switch"
                  aria-checked={task.enabled}
                  aria-label={`${task.name}：启用或停用`}
                  title={task.enabled ? '停用该任务' : '启用该任务'}
                  type="button"
                  onClick={() => void handleToggle(task)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {editorPresence.mounted && (
        <ScheduledTaskDialog
          key={editor.task?.id ?? 'new'}
          presence={editorPresence}
          task={editor.task ?? undefined}
          servers={servers}
          models={models}
          projects={projects}
          onSave={handleSaveEditor}
          onClose={closeEditor}
        />
      )}

      {historyPresence.mounted && history.task && (
        <ScheduledHistoryPanel
          key={history.task.id}
          presence={historyPresence}
          task={history.task}
          onOpenSession={onOpenSession}
          onClose={closeHistory}
        />
      )}
    </div>
  );
}

interface ScheduledTaskDialogProps extends PresenceMotionProps {
  task?: ScheduledTask;
  servers: ServerEntry[];
  models: ModelListItem[];
  projects: ProjectSummary[];
  onSave: (input: ScheduledTaskInput) => Promise<void>;
  onClose: () => void;
}

function ScheduledTaskDialog({
  task, servers, models, projects, onSave, onClose, presence,
}: ScheduledTaskDialogProps) {
  const isEdit = !!task;
  const initialInterval = intervalToFields(task?.scheduleKind === 'interval' ? task.scheduleExpr : '30');
  const [name, setName] = useState(task?.name ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [runtime, setRuntime] = useState<'local' | 'server'>(task?.runtime ?? 'local');
  const [serverId, setServerId] = useState(task?.serverId ?? '');
  const [projectId, setProjectId] = useState(task?.projectId ?? '');
  const [workDir, setWorkDir] = useState(task?.workDir ?? '');
  const [modelId, setModelId] = useState(task?.modelId ?? '');
  const [kind, setKind] = useState<ScheduledTaskKind>(task?.scheduleKind ?? 'once');
  const [onceValue, setOnceValue] = useState(
    task && task.scheduleKind === 'once' ? toDatetimeLocal(task.scheduleExpr) : '',
  );
  const [intervalAmount, setIntervalAmount] = useState(initialInterval.amount);
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>(initialInterval.unit);
  const [cronExpr, setCronExpr] = useState(task?.scheduleKind === 'cron' ? task.scheduleExpr : '');
  const [allowDangerous, setAllowDangerous] = useState(task?.allowDangerous ?? false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const savingRef = useRef(false);
  const isClosing = presence?.state === 'closing';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current && !isClosing) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isClosing, onClose]);

  function toggleDangerous() {
    if (allowDangerous) {
      setAllowDangerous(false);
      return;
    }
    const confirmed = window.confirm(
      '允许危险工具后，无人值守运行可能执行删除、写入等高风险操作。确认开启？',
    );
    if (confirmed) setAllowDangerous(true);
  }

  function handleProjectChange(id: string) {
    setProjectId(id);
    const project = projects.find((entry) => entry.id === id);
    if (project?.workDir) setWorkDir(project.workDir);
  }

  async function handlePickWorkDir() {
    try {
      const result = await window.electronAPI.dialog.selectProjectDir();
      if (result) setWorkDir(result.workDir);
    } catch (error) {
      setFeedback(`选择目录失败：${errorMessage(error)}`);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || isClosing) return;
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName) {
      setFeedback('任务名不能为空');
      return;
    }
    if (!trimmedPrompt) {
      setFeedback('提示词不能为空');
      return;
    }
    if (runtime === 'server' && !serverId) {
      setFeedback('请选择服务器');
      return;
    }
    let scheduleExpr: string;
    if (kind === 'once') {
      if (!onceValue) {
        setFeedback('请选择执行时间');
        return;
      }
      const at = new Date(onceValue);
      if (Number.isNaN(at.getTime())) {
        setFeedback('执行时间无效');
        return;
      }
      if (at.getTime() <= Date.now()) {
        setFeedback('执行时间已过期，请选择将来的时间');
        return;
      }
      scheduleExpr = at.toISOString();
    } else if (kind === 'interval') {
      const amount = Number(intervalAmount);
      if (!intervalAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
        setFeedback('间隔时长必须是大于 0 的数字');
        return;
      }
      scheduleExpr = String(intervalUnit === 'hours' ? amount * 60 : amount);
    } else {
      if (!cronExpr.trim()) {
        setFeedback('请填写 Cron 表达式');
        return;
      }
      scheduleExpr = cronExpr.trim();
    }

    const input: ScheduledTaskInput = {
      name: trimmedName,
      prompt: trimmedPrompt,
      runtime,
      scheduleKind: kind,
      scheduleExpr,
      allowDangerous,
    };
    if (runtime === 'server') {
      input.serverId = serverId;
    } else {
      if (projectId) input.projectId = projectId;
      if (workDir.trim()) input.workDir = workDir.trim();
    }
    if (modelId) input.modelId = modelId;

    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(input);
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleClose() {
    if (!savingRef.current && !isClosing) onClose();
  }

  const unknownServer = !!serverId && !servers.some((entry) => entry.id === serverId);
  const unknownProject = !!projectId && !projects.some((entry) => entry.id === projectId);
  const unknownModel = !!modelId && !models.some((entry) => entry.id === modelId);

  return (
    <div className="modal-backdrop" {...presenceRootProps(presence)} onClick={handleClose}>
      <section
        className="modal scheduled-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '编辑任务' : '新建任务'}
        aria-busy={saving || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="scheduled-dialog__header">
          <h2>{isEdit ? '编辑任务' : '新建任务'}</h2>
          <button className="btn-icon" type="button" aria-label="关闭任务窗口" onClick={handleClose} disabled={saving}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <form className="scheduled-dialog__form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="scheduled-field">
            <span className="scheduled-field__label">任务名</span>
            <input
              aria-label="任务名"
              className="scheduled-field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
              autoComplete="off"
              placeholder="例如：每日构建巡检"
            />
          </label>

          <label className="scheduled-field">
            <span className="scheduled-field__label">提示词</span>
            <textarea
              aria-label="提示词"
              className="scheduled-field__textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              placeholder="任务运行时发送给 Agent 的指令"
            />
          </label>

          <div className="scheduled-field__row">
            <label className="scheduled-field">
              <span className="scheduled-field__label">执行端</span>
              <select
                aria-label="执行端"
                className="scheduled-field__select"
                value={runtime}
                onChange={(event) => setRuntime(event.target.value as 'local' | 'server')}
              >
                <option value="local">本地</option>
                <option value="server">服务器</option>
              </select>
            </label>

            {runtime === 'server' ? (
              <label className="scheduled-field">
                <span className="scheduled-field__label">模型</span>
                <input
                  aria-label="模型"
                  className="scheduled-field__input"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="provider/model（留空使用服务器默认）"
                  autoComplete="off"
                />
              </label>
            ) : (
              <label className="scheduled-field">
                <span className="scheduled-field__label">模型</span>
                <select
                  aria-label="模型"
                  className="scheduled-field__select"
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                >
                  <option value="">使用默认模型</option>
                  {unknownModel && <option value={modelId}>{modelId}</option>}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {runtime === 'server' ? (
            <label className="scheduled-field">
              <span className="scheduled-field__label">服务器</span>
              <select
                aria-label="服务器"
                className="scheduled-field__select"
                value={serverId}
                onChange={(event) => setServerId(event.target.value)}
              >
                <option value="">选择服务器</option>
                {unknownServer && <option value={serverId}>{serverId}</option>}
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="scheduled-field">
                <span className="scheduled-field__label">项目</span>
                <select
                  aria-label="项目"
                  className="scheduled-field__select"
                  value={projectId}
                  onChange={(event) => handleProjectChange(event.target.value)}
                >
                  <option value="">不使用项目</option>
                  {unknownProject && <option value={projectId}>{projectId}</option>}
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              <div className="scheduled-field">
                <span className="scheduled-field__label">工作目录</span>
                <div className="scheduled-workdir">
                  <code title={workDir}>{workDir || '未选择'}</code>
                  <button className="btn btn-secondary btn-small" type="button" onClick={() => void handlePickWorkDir()}>
                    选择文件夹
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="scheduled-field__row">
            <label className="scheduled-field">
              <span className="scheduled-field__label">调度方式</span>
              <select
                aria-label="调度方式"
                className="scheduled-field__select"
                value={kind}
                onChange={(event) => setKind(event.target.value as ScheduledTaskKind)}
              >
                <option value="once">{KIND_LABELS.once}</option>
                <option value="interval">{KIND_LABELS.interval}</option>
                <option value="cron">{KIND_LABELS.cron}</option>
              </select>
            </label>
          </div>

          {kind === 'once' && (
            <label className="scheduled-field">
              <span className="scheduled-field__label">执行时间</span>
              <input
                aria-label="执行时间"
                className="scheduled-field__input"
                type="datetime-local"
                value={onceValue}
                onChange={(event) => setOnceValue(event.target.value)}
              />
            </label>
          )}

          {kind === 'interval' && (
            <div className="scheduled-field">
              <span className="scheduled-field__label">间隔</span>
              <div className="scheduled-inline">
                <input
                  aria-label="间隔时长"
                  className="scheduled-field__input"
                  type="number"
                  min="1"
                  value={intervalAmount}
                  onChange={(event) => setIntervalAmount(event.target.value)}
                />
                <select
                  aria-label="间隔单位"
                  className="scheduled-field__select"
                  value={intervalUnit}
                  onChange={(event) => setIntervalUnit(event.target.value as 'minutes' | 'hours')}
                >
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                </select>
              </div>
            </div>
          )}

          {kind === 'cron' && (
            <div className="scheduled-field">
              <span className="scheduled-field__label">Cron 表达式</span>
              <input
                aria-label="Cron 表达式"
                className="scheduled-field__input"
                value={cronExpr}
                onChange={(event) => setCronExpr(event.target.value)}
                placeholder="0 9 * * *"
                autoComplete="off"
              />
              <div className="scheduled-presets">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="scheduled-preset"
                    type="button"
                    onClick={() => setCronExpr(preset.expr)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="scheduled-danger">
            <div className="scheduled-danger__text">
              <strong>允许危险工具</strong>
              <span>无人值守运行时可能执行删除、写入等高风险操作；运行时仍按失败关闭处理。</span>
            </div>
            <button
              className={`settings-switch${allowDangerous ? ' on' : ''}`}
              role="switch"
              aria-checked={allowDangerous}
              aria-label="允许危险工具"
              type="button"
              onClick={toggleDangerous}
            />
          </div>

          {feedback && <p className="scheduled-dialog__error" role="alert">{feedback}</p>}

          <div className="scheduled-dialog__actions">
            <button className="btn btn-ghost" type="button" onClick={handleClose} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? '保存中…' : isEdit ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface ScheduledHistoryPanelProps extends PresenceMotionProps {
  task: ScheduledTask;
  onOpenSession?: (sessionId: string) => void;
  onClose: () => void;
}

function ScheduledHistoryPanel({ task, onOpenSession, onClose, presence }: ScheduledHistoryPanelProps) {
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    window.electronAPI.scheduled.runs(task.id)
      .then((list) => {
        if (alive) setRuns(list.slice(0, 20));
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [task.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop scheduled-history-backdrop" {...presenceRootProps(presence)} onClick={onClose}>
      <aside
        className="scheduled-history"
        role="dialog"
        aria-modal="true"
        aria-label="执行历史"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="scheduled-history__header">
          <div>
            <h3>执行历史</h3>
            <p>{task.name} · 最近 20 条</p>
          </div>
          <button className="btn-icon" type="button" aria-label="关闭历史" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>

        {loading && <p className="scheduled-history__hint">加载中…</p>}
        {!loading && error && <p className="scheduled-history__hint" role="alert">{error}</p>}
        {!loading && !error && runs.length === 0 && (
          <p className="scheduled-history__hint">暂无执行记录</p>
        )}

        {!loading && !error && runs.length > 0 && (
          <ul className="scheduled-history__list">
            {runs.map((run) => (
              <li key={run.id} className="scheduled-history-row" data-run-id={run.id} data-status={run.status}>
                <div className="scheduled-history-row__top">
                  <span className={`scheduled-status scheduled-status--${run.status}`}>
                    {RUN_STATUS_LABELS[run.status] ?? run.status}
                  </span>
                  <time>{formatDateTime(run.startedAt)}</time>
                </div>
                <div className="scheduled-history-row__meta">
                  <span>耗时 {formatDuration(run.startedAt, run.finishedAt)}</span>
                  {run.sessionId && onOpenSession && (
                    <button
                      className="btn btn-ghost btn-small"
                      type="button"
                      onClick={() => onOpenSession(run.sessionId!)}
                    >
                      查看会话
                    </button>
                  )}
                </div>
                {run.error && <p className="scheduled-history-row__error" role="alert">{run.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
