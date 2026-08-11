import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummary, Project, ProjectFileSelection, ProjectSummary } from '../../shared/ipc';
import { Icon } from './Icon';
import { ProjectDialog } from './ProjectDialog';
import { formatRelativeTime } from '../lib/chat-utils';

interface SidebarProps {
  projects: ProjectSummary[];
  /** @deprecated Project directories now come from each project record. */
  defaultWorkDir?: string;
  sessions: SessionSummary[];
  activeId: string | null;
  /** 'full' = normal sidebar with active highlight; 'compact' = skip active-highlight (used in tabs mode) */
  mode?: 'full' | 'compact';
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport?: (id: string) => void;
  onProjectCreate: () => void;
  onProjectDelete: (id: string) => void | Promise<void>;
  onProjectRename: (id: string, name: string) => void | Promise<void>;
  onProjectFileUpdate?: (id: string, selection: ProjectFileSelection) => Project | Promise<Project>;
  onNewSessionInProject: (projectId: string) => void;
  activeSection?: 'home' | 'projects' | 'tasks' | 'memory' | 'files';
  onNavigateHome?: () => void;
  onNavigateProjects?: () => void;
  onNavigateTasks?: () => void;
  onNavigateMemory?: () => void;
  onNavigateFiles?: () => void;
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

/** Truncate title to maxLen chars, appending ellipsis if needed. */
function truncateTitle(title: string, maxLen = 28): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen) + '…';
}


// 默认展开所有项目
function initExpanded(projects: ProjectSummary[]): Record<string, boolean> {
  const map: Record<string, boolean> = { '__unassigned__': true };
  for (const p of projects) map[p.id] = true;
  return map;
}

export function Sidebar({
  projects, sessions, activeId, mode,
  onSelect, onNew, onDelete, onRename, onExport,
  onProjectCreate, onProjectDelete, onProjectRename, onProjectFileUpdate, onNewSessionInProject,
  activeSection = 'tasks', onNavigateHome, onNavigateProjects, onNavigateTasks, onNavigateMemory,
  onNavigateFiles, onOpenSettings,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [search, setSearch] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuType, setMenuType] = useState<'session' | 'project'>('session');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initExpanded(projects));
  const [projectBusyId, setProjectBusyId] = useState<string | null>(null);
  const [projectFeedback, setProjectFeedback] = useState<ProjectFeedback | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState<SessionMenuPosition | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);

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

  // 按项目分组会话
  const { projectGroups, unassigned } = useMemo(() => {
    const filtered = search
      ? sessions.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
      : sessions;
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
      unassigned: unassignedList,
    };
  }, [projects, sessions, search]);

  // 搜索时展开包含匹配项的分组，避免在 render/useMemo 中更新 state。
  useEffect(() => {
    if (!search) return;
    const query = search.toLowerCase();
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const session of sessions) {
        if (!session.title.toLowerCase().includes(query)) continue;
        const groupId = session.projectId ?? '__unassigned__';
        if (!next[groupId]) {
          next[groupId] = true;
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

  // Close menu on outside click
  useEffect(() => {
    if (!menuId) return;
    const closeMenu = () => {
      setMenuId(null);
      setSessionMenuPosition(null);
    };
    const onClick = () => { closeMenu(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const onViewportChange = () => {
      if (menuType === 'session') closeMenu();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [menuId, menuType]);

  useLayoutEffect(() => {
    if (!menuId || menuType !== 'session' || !sessionMenuPosition || !sessionMenuRef.current) return;

    const menu = sessionMenuRef.current;
    const rect = menu.getBoundingClientRect();
    const gutter = 8;
    const viewportMaxLeft = window.innerWidth - rect.width - gutter;
    const sidebarMaxLeft = sessionMenuPosition.boundaryRight - rect.width - gutter;
    const maxLeft = Math.max(gutter, Math.min(viewportMaxLeft, sidebarMaxLeft));
    const maxTop = Math.max(gutter, window.innerHeight - rect.height - gutter);
    const nextLeft = Math.min(Math.max(sessionMenuPosition.anchorLeft, gutter), maxLeft);
    const visibleBottom = Math.min(window.innerHeight - gutter, sessionMenuPosition.boundaryBottom - gutter);
    const preferredTop = sessionMenuPosition.anchorTop + rect.height > visibleBottom
      ? sessionMenuPosition.flipBottom - rect.height
      : sessionMenuPosition.anchorTop;
    const nextTop = Math.min(Math.max(preferredTop, gutter), maxTop);

    if (nextLeft !== sessionMenuPosition.left || nextTop !== sessionMenuPosition.top) {
      setSessionMenuPosition((current) => current ? { ...current, left: nextLeft, top: nextTop } : current);
      return;
    }

    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menuId, menuType, sessionMenuPosition]);

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
    const confirmed = window.confirm(`删除项目“${p.name}”？\n项目中的会话会保留，并移动到“未分组”。`);
    if (!confirmed) return;
    setMenuId(null);
    setProjectBusyId(p.id);
    setProjectFeedback(null);
    try {
      await onProjectDelete(p.id);
      if (openProjectId === p.id) setOpenProjectId(null);
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

  function openSessionMenu(s: SessionSummary, left: number, top: number, boundaryRight: number, boundaryBottom: number, flipBottom: number) {
    setMenuType('session');
    setMenuId(s.id);
    setSessionMenuPosition({ anchorLeft: left, anchorTop: top, boundaryRight, boundaryBottom, flipBottom, left, top });
  }

  function handleSessionContextMenu(e: React.MouseEvent, s: SessionSummary) {
    e.preventDefault();
    e.stopPropagation();
    const rowTop = e.currentTarget.getBoundingClientRect().top;
    const listRect = e.currentTarget.closest('.session-list')?.getBoundingClientRect();
    openSessionMenu(s, e.clientX, e.clientY, listRect?.right ?? window.innerWidth, listRect?.bottom ?? window.innerHeight, rowTop - 4);
  }

  function handleProjectContextMenu(e: React.MouseEvent, p: ProjectSummary) {
    e.preventDefault();
    e.stopPropagation();
    setMenuType('project');
    setMenuId(menuId === p.id ? null : p.id);
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
        aria-expanded={menuId === s.id && menuType === 'session'}
        onClick={() => onSelect(s.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const listRect = event.currentTarget.closest('.session-list')?.getBoundingClientRect();
            openSessionMenu(s, rect.right - 8, rect.bottom - 4, listRect?.right ?? window.innerWidth, listRect?.bottom ?? window.innerHeight, rect.top - 4);
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
  function renderProjectGroup(p: ProjectSummary, sessionsInProject: SessionSummary[]) {
    const isExpanded = expanded[p.id] ?? true;

    return (
      <li key={p.id} className="project-group">
        <div
          className={`project-header${isExpanded ? ' project-header--expanded' : ''}`}
          data-project-id={p.id}
          onContextMenu={(e) => handleProjectContextMenu(e, p)}
        >
          <button
            className="project-toggle-button"
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? '收起' : '展开'}项目：${p.name}`}
            onClick={(event) => {
              event.stopPropagation();
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
            aria-expanded={menuId === p.id && menuType === 'project'}
            disabled={projectBusyId === p.id}
            onClick={(event) => {
              event.stopPropagation();
              setMenuType('project');
              setMenuId(menuId === p.id && menuType === 'project' ? null : p.id);
            }}
          >
            <Icon name="more" size={14} />
          </button>
        </div>
        {menuId === p.id && menuType === 'project' && (
          <div className="project-action-panel" role="menu" aria-label={`${p.name} 项目操作`} onClick={(e) => e.stopPropagation()}>
            <button className="session-menu-item" type="button" role="menuitem" onClick={() => { setOpenProjectId(p.id); setMenuId(null); }}>编辑项目</button>
            <button className="session-menu-item" type="button" role="menuitem" onClick={() => { onNewSessionInProject(p.id); setMenuId(null); }}>新建会话</button>
            <button className="session-menu-item session-menu-item--danger" type="button" role="menuitem" onClick={() => void deleteProject(p)}>删除项目</button>
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

  const menuSession = menuType === 'session' && menuId
    ? sessions.find((session) => session.id === menuId) ?? null
    : null;
  const openProject = openProjectId
    ? projects.find((project) => project.id === openProjectId) ?? null
    : null;

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
      <aside className="sidebar">
      <nav className="sidebar-primary" aria-label="主要导航">
        <button
          className={`sidebar-primary-item${activeSection === 'home' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'home' ? 'page' : undefined}
          onClick={onNavigateHome}
        >
          <Icon name="home" size={16} />
          <span>首页</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'projects' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'projects' ? 'page' : undefined}
          onClick={onNavigateProjects}
        >
          <Icon name="folder" size={16} />
          <span>项目</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'tasks' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'tasks' ? 'page' : undefined}
          onClick={onNavigateTasks}
        >
          <Icon name="list" size={16} />
          <span>工作记录</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'memory' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'memory' ? 'page' : undefined}
          onClick={onNavigateMemory}
        >
          <Icon name="database" size={16} />
          <span>记忆</span>
        </button>
        <button
          className={`sidebar-primary-item${activeSection === 'files' ? ' sidebar-primary-item--active' : ''}`}
          type="button"
          aria-current={activeSection === 'files' ? 'page' : undefined}
          onClick={onNavigateFiles}
        >
          <Icon name="file-tree" size={16} />
          <span>文件</span>
        </button>
        <button className="sidebar-primary-item sidebar-settings-link" type="button" onClick={onOpenSettings}>
          <Icon name="settings" size={16} />
          <span>设置</span>
        </button>
      </nav>

      <div className="sidebar-library-heading">
        <span>项目与会话</span>
        <span>{sessions.length}</span>
      </div>

      {/* New session / New project buttons */}
      <div className="sidebar-header">
        <button className="btn-new-session" onClick={onNew} type="button">
          <Icon name="plus" size={15} />
          <span>新建会话</span>
        </button>
        <button
          className="btn-new-project"
          onClick={() => onProjectCreate()}
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

      {/* Project tree */}
      <ul className="session-list">
        {/* 有项目的会话分组 */}
        {projects.map((p) => {
          const sessionsInProject = projectGroups.get(p.id) || [];
          return renderProjectGroup(p, sessionsInProject);
        })}

        {/* 未分组会话 */}
        {unassigned.length > 0 && (
          <li className="project-group">
            <div
              className={`project-header${expanded['__unassigned__'] ? ' project-header--expanded' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={expanded['__unassigned__']}
              aria-label={`${expanded['__unassigned__'] ? '收起' : '展开'}未分组会话`}
              onClick={() => toggleProject('__unassigned__')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleProject('__unassigned__');
                }
              }}
            >
              <span className="project-header__arrow">
                <Icon name={expanded['__unassigned__'] ? 'chevron-down' : 'chevron-right'} size={13} />
              </span>
              <span className="project-name project-name--muted">未分组</span>
              <span className="project-count">{unassigned.length}</span>
            </div>
            {expanded['__unassigned__'] && (
              <ul className="project-children">
                {unassigned.map(renderSession)}
              </ul>
            )}
          </li>
        )}

        {/* 空状态 */}
        {sessions.length === 0 && (
          <li className="session-empty">
            {search ? '无匹配结果' : '暂无会话'}
          </li>
        )}
      </ul>
      </aside>

      {openProject && createPortal(
        <ProjectDialog
          mode="edit"
          project={openProject}
          workDir={openProject.workDir}
          onRename={onProjectRename}
          onUpdateFile={onProjectFileUpdate}
          onClose={() => setOpenProjectId(null)}
        />,
        document.body,
      )}

      {menuSession && sessionMenuPosition && createPortal(
        <div
          ref={sessionMenuRef}
          className="session-menu"
          role="menu"
          aria-label={`${menuSession.title} 会话操作`}
          style={{ left: sessionMenuPosition.left, top: sessionMenuPosition.top }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleSessionMenuKeyDown}
        >
          <button
            className="session-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              startEdit(menuSession);
              setMenuId(null);
              setSessionMenuPosition(null);
            }}
          >
            重命名
          </button>
          <button
            className="session-menu-item session-menu-item--danger"
            type="button"
            role="menuitem"
            onClick={() => {
              onDelete(menuSession.id);
              setMenuId(null);
              setSessionMenuPosition(null);
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
                onExport(menuSession.id);
                setMenuId(null);
                setSessionMenuPosition(null);
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
