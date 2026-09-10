import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummary, Project, ProjectFileSelection, ProjectSummary } from '../../shared/ipc';
import { Icon } from './Icon';
import { ProjectDialog } from './ProjectDialog';
import { formatRelativeTime } from '../lib/chat-utils';
import type { AppSection } from '../lib/navigation';
import { usePresence } from '../hooks/usePresence';
import { captureFocusTarget, presenceRootProps, restoreFocusTarget, type PresenceMotionProps } from '../lib/presence-ui';

interface SidebarProps extends PresenceMotionProps {
  projects: ProjectSummary[];
  /** @deprecated Project directories now come from each project record. */
  defaultWorkDir?: string;
  sessions: SessionSummary[];
  activeId: string | null;
  /** 'full' = normal sidebar with active highlight; 'compact' = skip active-highlight (used in tabs mode) */
  mode?: 'full' | 'compact';
  onSelect: (id: string) => void;
  onNew: (returnFocus?: HTMLElement | null) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport?: (id: string) => void;
  onProjectCreate: (returnFocus?: HTMLElement | null) => void;
  onProjectDelete: (id: string) => void | Promise<void>;
  onProjectRename: (id: string, name: string) => void | Promise<void>;
  onProjectFileUpdate?: (id: string, selection: ProjectFileSelection) => Project | Promise<Project>;
  onNewSessionInProject: (projectId: string) => void;
  activeSection?: AppSection;
  onNavigate: (section: AppSection) => void;
  onOpenSettings?: () => void;
}

type ProjectFeedback = {
  kind: 'success' | 'error';
  message: string;
};

type SessionMenuPosition = {
  anchorLeft: number;
  anchorTop: number;
  boundaryRight: number;
  boundaryBottom: number;
  flipBottom: number;
  left: number;
  top: number;
};

type MenuSide = 'top' | 'bottom';

type SessionMenuState = SessionMenuPosition & {
  open: boolean;
  side: MenuSide;
  session: SessionSummary;
};

type ProjectMenuState = {
  open: boolean;
  project: ProjectSummary;
};

/** Truncate title to maxLen chars, appending ellipsis if needed. */
function truncateTitle(title: string, maxLen = 28): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + '…';
}


// 默认展开所有项目
function initExpanded(projects: ProjectSummary[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const p of projects) map[p.id] = true;
  return map;
}

export function Sidebar({
  projects, sessions, activeId, mode,
  onSelect, onNew, onDelete, onRename, onExport,
  onProjectCreate, onProjectDelete, onProjectRename, onProjectFileUpdate, onNewSessionInProject,
  activeSection, onNavigate, onOpenSettings, presence,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  /** 内容搜索匹配的 session id（sessions.search 异步结果） */
  const [contentMatchIds, setContentMatchIds] = useState<string[]>([]);
  /** 项目筛选：'all' | 'unassigned' | 项目 id */
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [projectMenu, setProjectMenu] = useState<ProjectMenuState | null>(null);
  const [projectMenuSourceRemoved, setProjectMenuSourceRemoved] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initExpanded(projects));
  const [projectBusyId, setProjectBusyId] = useState<string | null>(null);
  const [projectFeedback, setProjectFeedback] = useState<ProjectFeedback | null>(null);
  const [projectDialog, setProjectDialog] = useState<{
    present: boolean;
    projectId: string | null;
  }>({ present: false, projectId: null });
  const sessionMenuPresence = usePresence(sessionMenu?.open === true, 120);
  const projectMenuPresence = usePresence(projectMenu?.open === true, 120);
  const projectDialogPresence = usePresence(projectDialog.present);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuOpenRef = useRef(false);
  const projectMenuOpenRef = useRef(false);
  const sessionMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const projectMenuIndexRef = useRef<number | null>(null);
  const projectDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const retainedProjectDialogRef = useRef<ProjectSummary | null>(null);

  // 新项目创建时自动展开
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const p of projects) {
        if (!(p.id in next)) next[p.id] = true;
      }
      return next;
    });
  }, [projects]);

  // 内容搜索：防抖 300ms 调主进程（LIKE 匹配消息内容 + 标题）
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setContentMatchIds([]);
      return;
    }
    const timer = setTimeout(() => {
      void window.electronAPI.sessions.search(q)
        .then(setContentMatchIds)
        .catch(() => setContentMatchIds([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // 按项目分组会话（支持内容搜索与项目筛选）
  const { projectGroups, unassigned } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchIds = new Set(contentMatchIds);
    const filtered = sessions.filter((s) => {
      if (projectFilter === 'unassigned' && s.projectId) return false;
      if (projectFilter !== 'all' && projectFilter !== 'unassigned' && s.projectId !== projectFilter) return false;
      if (!query) return true;
      // 标题即时匹配；内容匹配依赖异步结果
      return s.title.toLowerCase().includes(query) || matchIds.has(s.id);
    });
    const knownProjectIds = new Set(projects.map((project) => project.id));

    const groupMap = new Map<string, SessionSummary[]>();
    const unassignedList: SessionSummary[] = [];

    for (const s of filtered) {
      if (s.projectId && knownProjectIds.has(s.projectId)) {
        const arr = groupMap.get(s.projectId) || [];
        arr.push(s);
        groupMap.set(s.projectId, arr);
      } else {
        unassignedList.push(s);
      }
    }

    return {
      projectGroups: groupMap,
      unassigned: unassignedList.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }, [projects, sessions, search, contentMatchIds, projectFilter]);

  // 搜索时展开包含匹配项的分组，避免在 render/useMemo 中更新 state。
  useEffect(() => {
    if (!search) return;
    const query = search.toLowerCase();
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const session of sessions) {
        if (!session.projectId) continue;
        if (!session.title.toLowerCase().includes(query)) continue;
        if (!next[session.projectId]) {
          next[session.projectId] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [search, sessions]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (projectFeedback?.kind !== 'success') return;
    const timer = window.setTimeout(() => setProjectFeedback(null), 3200);
    return () => window.clearTimeout(timer);
  }, [projectFeedback]);

  const sessionMenuOpen = sessionMenu?.open === true;
  const projectMenuOpen = projectMenu?.open === true;
  const sessionMenuSourceMissing = Boolean(
    sessionMenu
    && !sessions.some((session) => session.id === sessionMenu.session.id),
  );
  const projectMenuSourceIndex = projectMenu
    ? projects.findIndex((project) => project.id === projectMenu.project.id)
    : -1;
  const projectMenuSourceMissing = Boolean(projectMenu && projectMenuSourceIndex === -1);
  const retainProjectMenuHost = Boolean(
    projectMenu
    && projectMenuPresence.mounted
    && (projectMenuSourceMissing || projectMenuSourceRemoved),
  );
  const renderedProjects = projectMenu && retainProjectMenuHost
    ? (() => {
        const sourceProject = projectMenuSourceIndex === -1
          ? projectMenu.project
          : projects[projectMenuSourceIndex]!;
        const next = projects.filter((project) => project.id !== projectMenu.project.id);
        const index = Math.min(projectMenuIndexRef.current ?? next.length, next.length);
        next.splice(index, 0, sourceProject);
        return next;
      })()
    : projects;

  // Close menus on outside click without taking focus back from the click target.
  useEffect(() => {
    if (!sessionMenuOpen && !projectMenuOpen) return;
    const onClick = () => {
      closeSessionMenu(false);
      closeProjectMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (sessionMenuOpen) {
        closeSessionMenu(true);
        return;
      }
      if (projectMenuOpen) closeProjectMenu(true);
    };
    const onViewportChange = () => {
      if (sessionMenuOpen) closeSessionMenu(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [projectMenuOpen, sessionMenuOpen]);

  useLayoutEffect(() => {
    if (presence?.state !== 'closing') return;
    closeSessionMenu(false);
    closeProjectMenu(false);
    setProjectDialog((current) => ({ ...current, present: false }));
  }, [presence?.state]);

  useLayoutEffect(() => {
    if (!sessionMenuSourceMissing) return;
    closeSessionMenu(false);
  }, [sessionMenu?.session.id, sessionMenuSourceMissing]);

  useLayoutEffect(() => {
    if (!projectMenuSourceMissing) return;
    setProjectMenuSourceRemoved(true);
    closeProjectMenu(false);
  }, [projectMenu?.project.id, projectMenuSourceMissing]);

  useLayoutEffect(() => {
    if (!sessionMenu?.open || !sessionMenuPresence.mounted || !sessionMenuRef.current) return;

    const menu = sessionMenuRef.current;
    const rect = menu.getBoundingClientRect();
    const gutter = 8;
    const viewportMaxLeft = window.innerWidth - rect.width - gutter;
    const sidebarMaxLeft = sessionMenu.boundaryRight - rect.width - gutter;
    const maxLeft = Math.max(gutter, Math.min(viewportMaxLeft, sidebarMaxLeft));
    const maxTop = Math.max(gutter, window.innerHeight - rect.height - gutter);
    const nextLeft = Math.min(Math.max(sessionMenu.anchorLeft, gutter), maxLeft);
    const visibleBottom = Math.min(window.innerHeight - gutter, sessionMenu.boundaryBottom - gutter);
    const shouldFlip = sessionMenu.anchorTop + rect.height > visibleBottom;
    const side: MenuSide = shouldFlip ? 'top' : 'bottom';
    const top = shouldFlip ? sessionMenu.flipBottom - rect.height : sessionMenu.anchorTop;
    const nextTop = Math.min(Math.max(top, gutter), maxTop);

    if (nextLeft !== sessionMenu.left || nextTop !== sessionMenu.top || side !== sessionMenu.side) {
      setSessionMenu((current) => current ? { ...current, left: nextLeft, top: nextTop, side } : current);
      return;
    }

    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [sessionMenu, sessionMenuPresence.mounted]);

  useEffect(() => {
    if (sessionMenuPresence.mounted || !sessionMenu || sessionMenu.open) return;
    setSessionMenu(null);
    sessionMenuOpenRef.current = false;
    sessionMenuReturnFocusRef.current = null;
  }, [sessionMenu, sessionMenuPresence.mounted]);

  useEffect(() => {
    if (projectMenuPresence.mounted || !projectMenu || projectMenu.open) return;
    setProjectMenu(null);
    setProjectMenuSourceRemoved(false);
    projectMenuOpenRef.current = false;
    projectMenuReturnFocusRef.current = null;
    projectMenuIndexRef.current = null;
  }, [projectMenu, projectMenuPresence.mounted]);

  function closeSessionMenu(restoreFocus: boolean): boolean {
    if (!sessionMenuOpenRef.current) return false;
    sessionMenuOpenRef.current = false;
    setSessionMenu((current) => current?.open ? { ...current, open: false } : current);
    if (restoreFocus) restoreFocusTarget(sessionMenuReturnFocusRef.current);
    return true;
  }

  function closeProjectMenu(restoreFocus: boolean): boolean {
    if (!projectMenuOpenRef.current) return false;
    projectMenuOpenRef.current = false;
    setProjectMenu((current) => current?.open ? { ...current, open: false } : current);
    if (restoreFocus) restoreFocusTarget(projectMenuReturnFocusRef.current);
    return true;
  }

  function startEdit(s: SessionSummary) {
    setEditingId(s.id);
    setEditValue(s.title);
  }

  function commitEdit() {
    if (!editingId || !editValue.trim()) { setEditingId(null); return; }
    onRename(editingId, editValue.trim().slice(0, 50));
    setEditingId(null);
    setEditValue('');
  }

  async function deleteProject(p: ProjectSummary) {
    if (!projectMenuOpenRef.current) return;
    const confirmed = window.confirm(`删除项目“${p.name}”？\n项目中的会话会保留，并移动到“未分组”。`);
    if (!confirmed) return;
    if (!closeProjectMenu(true)) return;
    setProjectBusyId(p.id);
    setProjectFeedback(null);
    try {
      await onProjectDelete(p.id);
      setProjectDialog((current) => current.projectId === p.id
        ? { ...current, present: false }
        : current);
      setProjectFeedback({ kind: 'success', message: `项目“${p.name}”已删除，会话已移到未分组` });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setProjectFeedback({ kind: 'error', message: `删除失败：${reason}` });
    } finally {
      setProjectBusyId(null);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  function toggleProject(projectId: string) {
    setExpanded((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }

  function openSessionMenu(
    s: SessionSummary,
    left: number,
    top: number,
    boundaryRight: number,
    boundaryBottom: number,
    flipBottom: number,
    returnFocus: HTMLElement,
  ) {
    closeProjectMenu(false);
    sessionMenuOpenRef.current = true;
    sessionMenuReturnFocusRef.current = captureFocusTarget(returnFocus);
    setSessionMenu({
      anchorLeft: left,
      anchorTop: top,
      boundaryRight,
      boundaryBottom,
      flipBottom,
      left,
      top,
      open: true,
      side: 'bottom',
      session: s,
    });
  }

  function handleSessionContextMenu(e: React.MouseEvent<HTMLElement>, s: SessionSummary) {
    e.preventDefault();
    e.stopPropagation();
    const rowTop = e.currentTarget.getBoundingClientRect().top;
    const listRect = e.currentTarget.closest('.session-list')?.getBoundingClientRect();
    openSessionMenu(s, e.clientX, e.clientY, listRect?.right ?? window.innerWidth, listRect?.bottom ?? window.innerHeight, rowTop - 4, e.currentTarget);
  }

  function handleProjectContextMenu(e: React.MouseEvent, p: ProjectSummary) {
    e.preventDefault();
    e.stopPropagation();
    const actions = e.currentTarget.querySelector<HTMLElement>('.project-actions-button');
    toggleProjectMenu(p, actions);
  }

  function toggleProjectMenu(p: ProjectSummary, returnFocus: HTMLElement | null) {
    if (projectMenuOpenRef.current && projectMenu?.project.id === p.id) {
      closeProjectMenu(false);
      return;
    }
    closeSessionMenu(false);
    projectMenuOpenRef.current = true;
    setProjectMenuSourceRemoved(false);
    projectMenuReturnFocusRef.current = captureFocusTarget(returnFocus);
    const projectIndex = projects.findIndex((project) => project.id === p.id);
    projectMenuIndexRef.current = projectIndex === -1 ? projects.length : projectIndex;
    setProjectMenu({ open: true, project: p });
  }

  function openProjectDialog(projectId: string, returnFocus: HTMLElement | null) {
    projectDialogReturnFocusRef.current = captureFocusTarget(returnFocus);
    setProjectDialog({ present: true, projectId });
  }

  function closeProjectDialog() {
    if (!projectDialog.present) return;
    restoreFocusTarget(projectDialogReturnFocusRef.current);
    setProjectDialog((current) => ({ ...current, present: false }));
  }

  // 渲染一个会话行
  function renderSession(s: SessionSummary) {
    const isActive = s.id === activeId;
    const rowClass = [
      'session-row',
      (isActive && mode !== 'compact') ? 'session-row--active' : 'session-row--idle',
    ].join(' ');
    return (
      <li
        key={s.id}
        className={rowClass}
        data-session-id={s.id}
        role="button"
        tabIndex={0}
        aria-current={isActive && mode !== 'compact' ? 'page' : undefined}
        aria-label={`打开会话：${s.title}`}
        aria-haspopup="menu"
        aria-expanded={sessionMenu?.open === true && sessionMenu.session.id === s.id}
        onClick={() => onSelect(s.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const listRect = event.currentTarget.closest('.session-list')?.getBoundingClientRect();
            openSessionMenu(s, rect.right - 8, rect.bottom - 4, listRect?.right ?? window.innerWidth, listRect?.bottom ?? window.innerHeight, rect.top - 4, event.currentTarget);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(s.id);
          }
        }}
        onContextMenu={(e) => handleSessionContextMenu(e, s)}
      >
        <span className="session-status-icon" aria-hidden="true">
          <span className="session-status-dot" />
        </span>
        {editingId === s.id ? (
          <input
            ref={editInputRef}
            className="session-title-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
              else if (e.key === 'Tab') commitEdit();
            }}
            onBlur={commitEdit}
            maxLength={50}
          />
        ) : (
          <span
            className="session-title"
            onDoubleClick={(e) => { e.stopPropagation(); startEdit(s); }}
            title={s.title}
          >
            {truncateTitle(s.title)}
          </span>
        )}
        <span className="session-time">{formatRelativeTime(s.updatedAt)}</span>
      </li>
    );
  }

  // 渲染一个项目组
  function renderProjectGroup(p: ProjectSummary, sessionsInProject: SessionSummary[], sourceMissing = false) {
    const isExpanded = expanded[p.id] ?? true;

    return (
      <li
        key={p.id}
        className="project-group"
        inert={sourceMissing ? true : undefined}
        aria-hidden={sourceMissing ? true : undefined}
      >
        <div
          className={`project-header${isExpanded ? ' project-header--expanded' : ''}`}
          data-project-id={p.id}
          onContextMenu={(event) => {
            if (sourceMissing) return;
            handleProjectContextMenu(event, p);
          }}
        >
          <button
            className="project-toggle-button"
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? '收起' : '展开'}项目：${p.name}`}
            disabled={sourceMissing}
            onClick={(event) => {
              event.stopPropagation();
              if (sourceMissing) return;
              toggleProject(p.id);
            }}
          >
            <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
            <span
              className="project-name"
              title={p.name}
            >
              {truncateTitle(p.name, 22)}
            </span>
            <span className="project-count">{sessionsInProject.length}</span>
          </button>
          <button
            className="btn-icon project-actions-button"
            type="button"
            aria-label={`项目操作：${p.name}`}
            aria-haspopup="menu"
            aria-expanded={!sourceMissing && projectMenu?.open === true && projectMenu.project.id === p.id}
            disabled={sourceMissing || projectBusyId === p.id}
            onClick={(event) => {
              event.stopPropagation();
              if (sourceMissing) return;
              toggleProjectMenu(p, event.currentTarget);
            }}
          >
            <Icon name="more" size={14} />
          </button>
        </div>
        {projectMenuPresence.mounted && projectMenu?.project.id === p.id && (
          <div
            className="project-action-panel"
            role="menu"
            aria-label={`${projectMenu.project.name} 项目操作`}
            data-motion="menu"
            data-side="bottom"
            {...presenceRootProps(projectMenuPresence)}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="session-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                if (!closeProjectMenu(false)) return;
                openProjectDialog(projectMenu.project.id, projectMenuReturnFocusRef.current);
              }}
            >
              编辑项目
            </button>
            <button
              className="session-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                const projectId = projectMenu.project.id;
                if (!closeProjectMenu(true)) return;
                onNewSessionInProject(projectId);
              }}
            >
              新建会话
            </button>
            <button
              className="session-menu-item session-menu-item--danger"
              type="button"
              role="menuitem"
              onClick={() => {
                void deleteProject(projectMenu.project);
              }}
            >
              删除项目
            </button>
          </div>
        )}
        {isExpanded && (
          <ul className="project-children">
            {sessionsInProject.length === 0 && (
              <li className="session-empty">暂无会话</li>
            )}
            {sessionsInProject.map(renderSession)}
          </ul>
        )}
      </li>
    );
  }

  const resolvedOpenProject = projectDialog.projectId
    ? projects.find((project) => project.id === projectDialog.projectId) ?? null
    : null;
  const openProject = resolvedOpenProject
    ?? (retainedProjectDialogRef.current?.id === projectDialog.projectId
      ? retainedProjectDialogRef.current
      : null);

  useLayoutEffect(() => {
    if (resolvedOpenProject) {
      retainedProjectDialogRef.current = resolvedOpenProject;
      return;
    }
    if (projectDialog.present && projectDialog.projectId) {
      const missingProjectId = projectDialog.projectId;
      projectDialogReturnFocusRef.current = null;
      setProjectDialog((current) => current.present && current.projectId === missingProjectId
        ? { ...current, present: false }
        : current);
      return;
    }
    if (!projectDialogPresence.mounted) retainedProjectDialogRef.current = null;
  }, [projectDialog.present, projectDialog.projectId, projectDialogPresence.mounted, resolvedOpenProject]);

  function handleSessionMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = activeIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = (activeIndex + 1 + items.length) % items.length;
    else nextIndex = (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus({ preventScroll: true });
  }

  return (
    <>
      <aside className="sidebar" {...presenceRootProps(presence)}>
      <nav className="sidebar-primary" aria-label="主要导航">
        <button className="sidebar-primary-item" type="button" onClick={(event) => onNew(event.currentTarget)}>
          <Icon name="plus" size={15} />
          <span>新对话</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'pull-requests' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'pull-requests' ? 'page' : undefined}
          onClick={() => onNavigate('pull-requests')}
        >
          <Icon name="copy" size={15} />
          <span>Pull Request</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'scheduled' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'scheduled' ? 'page' : undefined}
          onClick={() => onNavigate('scheduled')}
        >
          <Icon name="calendar" size={15} />
          <span>已安排</span>
        </button>
      </nav>

      <div className="sidebar-library-heading">
        <span>项目与会话</span>
        <span>{sessions.length}</span>
      </div>

      {/* New session / New project buttons */}
      <div className="sidebar-header">
        <button className="btn-new-session" onClick={(event) => onNew(event.currentTarget)} type="button">
          <Icon name="plus" size={15} />
          <span>新建会话</span>
        </button>
        <button
          className="btn-new-project"
          onClick={(event) => onProjectCreate(event.currentTarget)}
          type="button"
          title="新建项目"
          aria-label="新建项目"
        >
          <Icon name="folder" size={14} />
          <span>项目</span>
        </button>
      </div>

      {projectFeedback && (
        <div
          className={`project-feedback project-feedback--${projectFeedback.kind}`}
          role={projectFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          <Icon name={projectFeedback.kind === 'error' ? 'alert' : 'check'} size={14} />
          <span>{projectFeedback.message}</span>
          <button
            className="btn-icon btn-icon-small"
            type="button"
            aria-label="关闭项目操作提示"
            onClick={() => setProjectFeedback(null)}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="sidebar-search">
        <Icon className="sidebar-search-icon" name="search" size={14} />
        <input
          className="sidebar-search-input"
          type="text"
          placeholder="查找会话"
          aria-label="搜索会话"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="sidebar-search-clear" onClick={() => setSearch('')} type="button" title="清除搜索" aria-label="清除搜索">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      {/* 项目筛选 */}
      <div className="sidebar-filter">
        <select
          className="sidebar-filter-select"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label="按项目筛选工作记录"
        >
          <option value="all">全部项目</option>
          <option value="unassigned">未关联项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Project tree */}
      <ul className="session-list">
        {/* 有项目的会话分组 */}
        {renderedProjects.map((p) => {
          if (projectFilter !== 'all' && projectFilter !== p.id) return null;
          const sessionsInProject = projectGroups.get(p.id) || [];
          const sourceMissing = projectMenuSourceMissing && projectMenu?.project.id === p.id;
          return renderProjectGroup(p, sessionsInProject, sourceMissing);
        })}

        {/* 空状态 */}
        {sessions.length === 0 && (
          <li className="session-empty">
            {search ? '无匹配结果' : '暂无会话'}
          </li>
        )}
      </ul>

      {unassigned.length > 0 && (
        <section className="sidebar-recent" aria-label="最近">
          <h2 className="sidebar-section-title">最近</h2>
          <ul className="session-list">
            {unassigned.map(renderSession)}
          </ul>
        </section>
      )}

      <div className="sidebar-tools">
        <button className="sidebar-tool" type="button" onClick={() => onNavigate('memory')}>
          <Icon name="database" size={15} />
          <span>记忆</span>
        </button>
        <button className="sidebar-tool" type="button" onClick={() => onNavigate('files')}>
          <Icon name="file-tree" size={15} />
          <span>文件</span>
        </button>
        <button className="sidebar-tool" type="button" onClick={onOpenSettings}>
          <Icon name="settings" size={15} />
          <span>设置</span>
        </button>
      </div>
      </aside>

      {projectDialogPresence.mounted && openProject && createPortal(
        <ProjectDialog
          presence={projectDialogPresence}
          mode="edit"
          project={openProject}
          workDir={openProject.workDir}
          onRename={onProjectRename}
          onUpdateFile={onProjectFileUpdate}
          onClose={closeProjectDialog}
        />,
        document.body,
      )}

      {sessionMenuPresence.mounted && sessionMenu && createPortal(
        <div
          ref={sessionMenuRef}
          className="session-menu"
          role="menu"
          aria-label={`${sessionMenu.session.title} 会话操作`}
          data-motion="menu"
          data-side={sessionMenu.side}
          {...presenceRootProps(sessionMenuPresence)}
          style={{ left: sessionMenu.left, top: sessionMenu.top }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleSessionMenuKeyDown}
        >
          <button
            className="session-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              if (!closeSessionMenu(false)) return;
              startEdit(sessionMenu.session);
            }}
          >
            重命名
          </button>
          <button
            className="session-menu-item session-menu-item--danger"
            type="button"
            role="menuitem"
            onClick={() => {
              const sessionId = sessionMenu.session.id;
              if (!closeSessionMenu(true)) return;
              onDelete(sessionId);
            }}
          >
            删除
          </button>
          {onExport && (
            <button
              className="session-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                const sessionId = sessionMenu.session.id;
                if (!closeSessionMenu(true)) return;
                onExport(sessionId);
              }}
            >
              导出 JSON
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
