import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type {
  AppInfo, ApprovalRequest, ConfiguredModel, ModelListItem,
  SessionSummary, Session, SkillDef, Project, ProjectFileSelection,
} from '../../shared/ipc';
import {
  type DisplayEntry,
  messagesToEntries, entriesToMessages, buildHistory,
  applyStreamEventToEntries, generateReportFromEntries,
} from '../lib/chat-utils';
import { Sidebar } from './Sidebar';
import { FileTreeModal } from './FileTreeModal';
import { WorkspacePanel, type Goal, type Deliverable } from './WorkspacePanel';
import { Header } from './chat/Header';
import { ChatStream } from './chat/ChatStream';
import { InputArea, type SlashState } from './chat/InputArea';
import { TabBar, type TabBarTab } from './chat/TabBar';
import { HomeDashboard } from './HomeDashboard';
import { ProjectDialog } from './ProjectDialog';
import { MemoryCenter } from './memory/MemoryCenter';
import { CommandPalette } from './CommandPalette';
import { useShortcuts } from '../hooks/useShortcuts';

interface MainViewProps {
  config: ConfiguredModel;
  info: AppInfo;
  sidebarOpen: boolean;
  workspaceMode?: 'sidebar' | 'tabs';
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
  shortcuts?: Partial<Record<import('../../shared/shortcuts').ShortcutAction, string>>;
  activeSessionId: string | null;
  projects: import('../../shared/ipc').ProjectSummary[];
  sessions: SessionSummary[];
  theme?: import('../../shared/ipc').ThemeName;
  onToggleSidebar: () => void;
  onReconfigure: () => void;
  onOpenSettings: () => void;
  onProjectCreated: (project: import('../../shared/ipc').Project) => void;
  onProjectDeleted: (id: string) => void;
  onProjectRenamed: (id: string, name: string) => void;
  onProjectFileUpdated: (project: Project) => void;
  onSessionCreated: (session: Session) => void;
  onSessionSwitched: (id: string) => void;
  onSessionDeleted: (id: string) => void;
  onSessionRenamed: (id: string, title: string) => void;
  onSessionsChanged: (sessions: SessionSummary[]) => void;
  onModelChanged: (config: ConfiguredModel) => void;
  onThemeChange?: (theme: import('../../shared/ipc').ThemeName) => void;
}

export function MainView(props: MainViewProps) {
  const {
    config, info: _info, sidebarOpen, workspaceMode, activeSessionId, projects, sessions,
    onToggleSidebar, onReconfigure, onOpenSettings,
    onProjectCreated, onProjectDeleted, onProjectRenamed, onProjectFileUpdated,
    onSessionCreated, onSessionSwitched, onSessionDeleted, onSessionRenamed, onSessionsChanged,
    onModelChanged,
  } = props;
  void _info;

  const tabBarTabs = useMemo<TabBarTab[]>(() =>
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.id === activeSessionId ? 'active' : 'idle',
    })),
    [sessions, activeSessionId],
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeProject = projects.find((project) => project.id === activeSession?.projectId);
  const activeWorkDir = activeProject?.workDir ?? activeSession?.workDir ?? config.workDir;

  // ---- State ----
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [lastUserForRetry, setLastUserForRetry] = useState<string | null>(null);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  // 仅当会话引用的模型已从配置中删除时才提示（切换活跃模型不算）
  const modelMissing = !!activeSession && !modelList.some((m) => m.id === activeSession.modelId);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<import('../../shared/ipc').PlanApprovalRequest | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'home' | 'projects' | 'tasks' | 'memory'>('home');
  const [slash, setSlash] = useState<SlashState>({
    slashOpen: false, slashItems: [], slashIdx: 0, skillsLoaded: false,
  });

  // ---- Model list ----
  useEffect(() => {
    void window.electronAPI.models.getAll().then(setModelList).catch(() => { /* ignore */ });
  }, [config.id]);

  async function handleSwitchModel(id: string) {
    if (id === config.id || switchingModel) return;
    setSwitchingModel(true);
    try {
      await window.electronAPI.models.setActive(id);
      const list = await window.electronAPI.models.list();
      if (list.configured) onModelChanged(list.configured);
    } catch (e) {
      console.error('切换 model 失败:', e);
    } finally {
      setSwitchingModel(false);
    }
  }

  // ---- Session lifecycle ----
  const entriesSessionRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!activeSessionId) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
          if (entriesSessionRef.current) {
            await window.electronAPI.sessions.saveMessages(entriesSessionRef.current, entriesToMessages(entries, entriesSessionRef.current))
              .catch((e) => console.error('Flush save failed:', e));
          }
        }
        if (cancelled) return;
        setEntries([]);
        entriesSessionRef.current = null;
        return;
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (entriesSessionRef.current && entriesSessionRef.current !== activeSessionId) {
          await window.electronAPI.sessions.saveMessages(entriesSessionRef.current, entriesToMessages(entries, entriesSessionRef.current))
            .catch((e) => console.error('Flush save failed:', e));
        }
      }
      if (cancelled) return;
      entriesSessionRef.current = null;
      void window.electronAPI.sessions.get(activeSessionId).then(({ messages }) => {
        if (cancelled) return;
        setEntries(messagesToEntries(messages));
        entriesSessionRef.current = activeSessionId;
        setPlanMode(false);
        setLastUserForRetry(null);
        setPendingPlanApproval(null);
      }).catch((e) => {
        console.error('Failed to load session:', e);
      });
    })();
    return () => { cancelled = true; };
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save: debounce 300ms
  useEffect(() => {
    if (!activeSessionId) return;
    if (entriesSessionRef.current !== activeSessionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void window.electronAPI.sessions.saveMessages(activeSessionId, entriesToMessages(entries, activeSessionId))
        .then(() => window.electronAPI.sessions.list())
        .then(onSessionsChanged)
        .catch((e) => console.error('Auto-save failed:', e));
    }, 300);
  }, [entries, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  const chatRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  // 原生菜单（macOS）动作：命令面板 / 新建会话 / 打开路径（App 已处理 open-settings）
  useEffect(() => {
    const onMenuAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'open-command-palette') {
        setCommandPaletteOpen(true);
      } else if (action === 'new-session') {
        void handleNewSession();
      } else if (action.startsWith('open-path:')) {
        handleOpenPath(action.slice('open-path:'.length));
      }
    };
    window.addEventListener('menu-action', onMenuAction);
    return () => window.removeEventListener('menu-action', onMenuAction);
  });

  // M2.4: Finder/ Dock 拖入的文件 → 打开所在项目（或跳到项目页）
  function handleOpenPath(filePath: string) {
    const project = projects.find((p) => p.workDir != null && filePath.startsWith(p.workDir));
    if (project) {
      const session = sessions.find((s) => s.projectId === project.id);
      if (session) void props.onSessionSwitched(session.id);
      else setActiveSection('projects');
    } else {
      setActiveSection('projects');
    }
  }

  useEffect(() => {
    if (!confirmNew) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmNew(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmNew]);

  // Auto-rename session on first user message
  useEffect(() => {
    if (!activeSessionId) return;
    if (entriesSessionRef.current !== activeSessionId) return;
    const firstUser = entries.find((e) => e.kind === 'user');
    if (!firstUser || firstUser.kind !== 'user') return;
    const title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '');
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (currentSession && currentSession.title === 'New session') {
      void window.electronAPI.sessions.rename(activeSessionId, title)
        .then(() => window.electronAPI.sessions.list())
        .then(onSessionsChanged)
        .catch(() => { /* ignore */ });
    }
  }, [entries, activeSessionId, sessions, onSessionsChanged]);

  // ---- Workspace data (computed from entries) ----
  const workspaceGoal = useMemo<Goal | null>(() => {
    // Find the first user message as the goal
    const firstUser = entries.find((e) => e.kind === 'user');
    return firstUser ? { kind: 'userMessage', content: firstUser.content } : null;
  }, [entries]);

  const workspaceDeliverables = useMemo<Deliverable[]>(() => {
    const seen = new Set<string>();
    const out: Deliverable[] = [];
    for (const e of entries) {
      if (e.kind === 'tool_result' && e.meta?.kind === 'edit' && !seen.has(e.meta.path)) {
        seen.add(e.meta.path);
        out.push({ path: e.meta.path, kind: e.meta.before === null ? 'write' : 'edit', ts: Date.now() });
      }
    }
    return out;
  }, [entries]);

  const touchedFiles = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'tool_result' && e.meta?.kind === 'edit') s.add(e.meta.path);
    }
    return s;
  }, [entries]);

  const toolCallCount = useMemo(() => entries.filter((e) => e.kind === 'tool_call').length, [entries]);
  const toolResultCount = useMemo(() => entries.filter((e) => e.kind === 'tool_result').length, [entries]);

  // ---- Chat handlers ----
  function handleNewTask() {
    if (busy || entries.length === 0) return;
    setConfirmNew(true);
  }

  function doNewTask() {
    setEntries([]);
    setConfirmNew(false);
    setLastUserForRetry(null);
  }

  async function handleSend() {
    if (!input.trim() || busy) return;
    if (!activeSessionId) {
      setEntries((prev) => [...prev, { kind: 'error', message: '请先创建并选择一个会话后再发送任务。' }]);
      return;
    }
    const userContent = input;
    const history = [...buildHistory(entries), { role: 'user' as const, content: userContent }];
    const usePlanMode = planMode;
    setLastUserForRetry(null);

    setEntries((prev) => [
      ...prev,
      { kind: 'user', content: userContent },
      { kind: 'assistant', content: '' },
    ]);
    setInput('');
    setBusy(true);
    setStreamId(null);

    try {
      const result = await window.electronAPI.chat.start({ sessionId: activeSessionId, messages: history, planMode: usePlanMode });
      setStreamId(result.streamId);
      for await (const ev of result.events) {
        setEntries((prev) => {
          const next = applyStreamEventToEntries(prev, ev, setPendingApproval, setPendingPlanApproval);
          return next ?? prev;
        });
        if (ev.type === 'task_complete') {
          setEntries((prev) => {
            const report = generateReportFromEntries(prev);
            return report ? [...prev, report] : prev;
          });
        }
        if (ev.type === 'error') {
          setLastUserForRetry(userContent);
        }
        if (ev.type === 'done' || ev.type === 'error') {
          setPendingApproval(null);
          setPendingPlanApproval(null);
          break;
        }
      }
    } catch (err) {
      setEntries((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        const msg = err instanceof Error ? err.message : String(err);
        if (last && last.kind === 'assistant') {
          copy[copy.length - 1] = { ...last, content: last.content + `\n\n[连接错误] ${msg}` };
        } else {
          copy.push({ kind: 'error', message: msg });
        }
        return copy;
      });
      setLastUserForRetry(userContent);
      setPendingApproval(null);
      setPendingPlanApproval(null);
    } finally {
      setBusy(false);
      setStreamId(null);
    }
  }

  function handleAbort() {
    if (streamId) {
      window.electronAPI.chat.abort(streamId);
    }
    setPendingApproval(null);
    setPendingPlanApproval(null);
    setBusy(false);
    setStreamId(null);
  }

  function handleRetry() {
    if (!lastUserForRetry) return;
    setInput(lastUserForRetry);
    setEntries((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.kind === 'assistant' && last.content.includes('[连接错误]')) {
        copy[copy.length - 1] = { ...last, content: last.content.replace(/\n\n\[连接错误\][\s\S]*$/, '') };
      } else if (last && last.kind === 'error') {
        copy.pop();
      }
      return copy;
    });
    setLastUserForRetry(null);
    requestAnimationFrame(() => { void handleSend(); });
  }

  // ---- 快捷键（plan 模式 / 发送 / 拒绝批准 / 命令面板；其余在 App）----
  useShortcuts(
    props.shortcuts,
    {
      togglePlanMode: () => setPlanMode((v) => !v),
      sendMessage: () => {
        if (!busy && input.trim()) void handleSend();
      },
      rejectApproval: () => {
        if (pendingApproval) {
          window.electronAPI.chat.approve(pendingApproval.id, false);
          setPendingApproval(null);
        }
      },
      openCommandPalette: () => setCommandPaletteOpen(true),
    },
    !commandPaletteOpen,
  );

  // ---- Slash / Skills ----
  function handleLoadSkills() {
    if (!activeWorkDir) return;
    void window.electronAPI.skills.list(activeWorkDir).then((items) => {
      setSlash((s) => ({ ...s, skillsLoaded: true, slashItems: items }));
    }).catch(() => {
      setSlash((s) => ({ ...s, skillsLoaded: true, slashItems: [] }));
    });
  }

  function handleSlashApply(skill: SkillDef) {
    setInput(skill.prompt);
    setSlash((s) => ({ ...s, slashOpen: false }));
  }

  // ---- Session CRUD ----
  async function handleNewSession(projectId?: string) {
    if (busy) return;
    const targetProjectId = projectId ?? activeSession?.projectId;
    if (!targetProjectId) {
      setActiveSection('projects');
      if (projects.length === 0) setCreateProjectOpen(true);
      return;
    }
    try {
      const s = await window.electronAPI.sessions.create({ modelId: config.id, projectId: targetProjectId });
      onSessionCreated(s);
      setActiveSection('tasks');
    } catch (e) {
      console.error('New session failed:', e);
    }
  }

  async function handleCreateProject(name: string, selection: ProjectFileSelection) {
    const project = await window.electronAPI.projects.create({
      name,
      workDir: selection.workDir,
      entryFile: selection.path,
    });
    onProjectCreated(project);
    setCreateProjectOpen(false);
  }

  function handleSelectSession(id: string) {
    setActiveSection('tasks');
    onSessionSwitched(id);
  }

  function handleOpenProject(projectId: string) {
    const firstSession = sessions.find((session) => session.projectId === projectId);
    if (firstSession) {
      handleSelectSession(firstSession.id);
      return;
    }
    void handleNewSession(projectId);
  }

  async function handleDeleteSession(id: string, skipConfirm = false) {
    if (!skipConfirm && !window.confirm('删除该会话？该操作不可撤销，聊天记录将一并清除。')) return;
    try {
      await window.electronAPI.sessions.delete(id);
      onSessionDeleted(id);
    } catch (e) {
      console.error('Delete session failed:', e);
    }
  }

  async function handleRenameSession(id: string, title: string) {
    try {
      await window.electronAPI.sessions.rename(id, title);
      onSessionRenamed(id, title);
    } catch (e) {
      console.error('Rename session failed:', e);
    }
  }

  // ---- Render ----
  return (
    <div className="main-view">
      {activeSection === 'tasks' && <a className="skip-link" href="#task-stream">跳到工作记录</a>}
      <Header
        config={config}
        sidebarOpen={sidebarOpen}
        workspaceOpen={props.workspaceOpen}
        modelList={modelList}
        switchingModel={switchingModel}
        busy={busy}
        hasEntries={entries.length > 0}
        onToggleSidebar={onToggleSidebar}
        onToggleWorkspace={props.onToggleWorkspace}
        workDir={activeWorkDir}
        projectName={activeProject?.name}
        onChooseProject={() => {
          setActiveSection('projects');
          if (!activeProject && projects.length === 0) setCreateProjectOpen(true);
        }}
        onOpenFileTree={() => setFileTreeOpen(true)}
        onOpenSettings={onOpenSettings}
        onReconfigure={onReconfigure}
        onNewSession={() => void handleNewSession()}
        onNewTask={handleNewTask}
        onSwitchModel={(id) => void handleSwitchModel(id)}
      />

      <div className="main-layout">
        {sidebarOpen && (
          <Sidebar
            projects={projects}
            sessions={sessions}
            activeId={activeSessionId}
            mode={workspaceMode === 'tabs' ? 'compact' : 'full'}
            activeSection={activeSection}
            onNavigateHome={() => setActiveSection('home')}
            onNavigateProjects={() => setActiveSection('projects')}
            onNavigateTasks={() => setActiveSection('tasks')}
            onNavigateMemory={() => setActiveSection('memory')}
            onOpenFiles={() => activeWorkDir ? setFileTreeOpen(true) : setCreateProjectOpen(true)}
            onOpenSettings={onOpenSettings}
            onSelect={handleSelectSession}
            onNew={() => void handleNewSession()}
            onDelete={(id) => void handleDeleteSession(id)}
            onRename={(id, title) => void handleRenameSession(id, title)}
            onProjectCreate={() => setCreateProjectOpen(true)}
            onProjectDelete={async (id) => {
              await window.electronAPI.projects.delete(id);
              onProjectDeleted(id);
            }}
            onProjectRename={async (id, name) => {
              await window.electronAPI.projects.rename(id, name);
              onProjectRenamed(id, name);
            }}
            onProjectFileUpdate={async (id, selection) => {
              const project = await window.electronAPI.projects.updateFile(id, selection);
              onProjectFileUpdated(project);
              return project;
            }}
            onNewSessionInProject={(projectId) => void handleNewSession(projectId)}
          />
        )}
        <div className="main-content">
          {activeSection === 'tasks' ? (
            <>
              {workspaceMode === 'tabs' && (
                <TabBar
                  tabs={tabBarTabs}
                  activeId={activeSessionId ?? ''}
                  onSelect={handleSelectSession}
                  onClose={(id) => void handleDeleteSession(id)}
                  onNewTab={() => void handleNewSession()}
                  onRename={(id) => {
                    const tab = sessions.find((s) => s.id === id);
                    if (tab) {
                      const newTitle = prompt('重命名会话', tab.title);
                      if (newTitle) void handleRenameSession(id, newTitle);
                    }
                  }}
                  onCloseOthers={(keepId) => {
                    const others = sessions.filter((s) => s.id !== keepId);
                    if (others.length === 0) return;
                    if (!window.confirm(`关闭并删除其他 ${others.length} 个会话？该操作不可撤销。`)) return;
                    for (const s of others) void handleDeleteSession(s.id, true);
                  }}
                />
              )}
              <ChatStream
                entries={entries}
                busy={busy}
                streamId={streamId}
                chatRef={chatRef}
                lastUserForRetry={lastUserForRetry}
                modelMissing={modelMissing}
                onOpenSettings={onOpenSettings}
                onRetry={handleRetry}
                onAbort={handleAbort}
                onApprove={(approved) => {
                  if (!pendingApproval) return;
                  window.electronAPI.chat.approve(pendingApproval.id, approved);
                  setPendingApproval(null);
                }}
                pendingApproval={pendingApproval}
                pendingPlanApproval={pendingPlanApproval}
                onApprovePlan={() => {
                  if (!pendingPlanApproval) return;
                  window.electronAPI.chat.approve(pendingPlanApproval.id, true);
                  setPendingPlanApproval(null);
                }}
                onRejectPlan={() => {
                  if (!pendingPlanApproval) return;
                  window.electronAPI.chat.approve(pendingPlanApproval.id, false);
                  setPendingPlanApproval(null);
                }}
              />
              <InputArea
                input={input}
                busy={busy}
                planMode={planMode}
                slash={slash}
                hasWorkDir={!!activeWorkDir}
                onInputChange={setInput}
                onPlanToggle={() => setPlanMode((v) => !v)}
                onSend={() => void handleSend()}
                onSlashApply={handleSlashApply}
                onSlashOpen={() => setSlash((s) => ({ ...s, slashOpen: true, slashIdx: 0 }))}
                onSlashClose={() => setSlash((s) => ({ ...s, slashOpen: false }))}
                onSlashIdxChange={(idx) => setSlash((s) => ({ ...s, slashIdx: idx }))}
                onLazyLoadSkills={handleLoadSkills}
              />
            </>
          ) : activeSection === 'memory' ? (
            <MemoryCenter />
          ) : (
            <HomeDashboard
              section={activeSection}
              config={config}
              workDir={activeWorkDir}
              projectName={activeProject?.name}
              projects={projects}
              sessions={sessions}
              input={input}
              busy={busy}
              onInputChange={setInput}
              onSend={() => {
                if (!activeSessionId) {
                  void handleNewSession();
                  return;
                }
                setActiveSection('tasks');
                void handleSend();
              }}
              onSelectSession={handleSelectSession}
              onOpenProject={handleOpenProject}
              onCreateProject={() => setCreateProjectOpen(true)}
              onOpenFiles={() => activeWorkDir ? setFileTreeOpen(true) : setCreateProjectOpen(true)}
            />
          )}
        </div>
        {props.workspaceOpen && activeWorkDir && (
          <WorkspacePanel
            workDir={activeWorkDir}
            goal={workspaceGoal}
            progress={{ completed: toolResultCount, total: toolCallCount }}
            deliverables={workspaceDeliverables}
            touchedFiles={touchedFiles}
          />
        )}
      </div>

      {confirmNew && (
        <div className="modal-backdrop" onClick={() => setConfirmNew(false)}>
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-new-title"
            aria-describedby="confirm-new-description"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-new-title">清空当前聊天？</h3>
            <p id="confirm-new-description">当前 {entries.length} 条记录会被清除，任务上下文也会重新开始。</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmNew(false)} type="button" autoFocus>
                取消
              </button>
              <button className="btn btn-danger" onClick={doNewTask} type="button">
                清空
              </button>
            </div>
          </div>
        </div>
      )}

      {fileTreeOpen && activeWorkDir && (
        <FileTreeModal
          workDir={activeWorkDir}
          onClose={() => setFileTreeOpen(false)}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          onClose={() => setCommandPaletteOpen(false)}
          sessions={sessions}
          modelList={modelList}
          activeSessionId={activeSessionId}
          activeModelId={config.id}
          theme={props.theme ?? 'light'}
          onSelectSession={handleSelectSession}
          onNewSession={() => void handleNewSession()}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onSetActiveModel={(id) => void handleSwitchModel(id)}
          onSetTheme={(t) => props.onThemeChange?.(t)}
          onOpenSettings={() => props.onOpenSettings()}
          onOpenFileTree={() => setFileTreeOpen(true)}
          onToggleSidebar={props.onToggleSidebar}
          onToggleWorkspace={props.onToggleWorkspace}
          onTogglePlanMode={() => setPlanMode((v) => !v)}
          onNewTask={handleNewTask}
        />
      )}

      {createProjectOpen && createPortal(
        <ProjectDialog
          mode="create"
          onCreate={handleCreateProject}
          onClose={() => setCreateProjectOpen(false)}
        />,
        document.body,
      )}
    </div>
  );
}
