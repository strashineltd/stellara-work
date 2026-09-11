import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type {
  AppInfo, ApprovalRequest, AttachmentMeta, ChatRequest, ConfiguredModel, ModelListItem,
  SessionSummary, Session, SkillDef, Project, ContextStateView, ChatStreamEvent,
} from '../../shared/ipc';
import {
  type DisplayEntry,
  type EntryEnterMotion,
  messagesToEntries, entriesToMessages, buildHistory,
  applyStreamEventToEntries, generateReportFromEntries, clearEntryEnterMotion,
} from '../lib/chat-utils';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useNavHistory } from '../hooks/useNavHistory';
import { INITIAL_NAV, type AppSection, type ApprovalMode, type ExecutionTarget } from '../lib/navigation';
import { Sidebar } from './Sidebar';
import { FileTreeModal } from './FileTreeModal';
import { WorkspacePanel, type Goal, type Deliverable, type MemoryContextItem, type ContextStats, type SubagentInfo } from './WorkspacePanel';
import { ChatStream } from './chat/ChatStream';
import { InputArea, type SlashState } from './chat/InputArea';
import { ModelSwitcher } from './chat/ModelSwitcher';
import { TabBar, type TabBarTab } from './chat/TabBar';
import { HomeView } from './home/HomeView';
import { ProjectDialog } from './ProjectDialog';
import { MemoryCenter } from './memory/MemoryCenter';
import { SidebarFileView } from './files/SidebarFileView';
import { AppTopBar } from './shell/AppTopBar';
import { ServerTargetSelector } from './shell/ServerTargetSelector';
import { PlaceholderPage } from './shell/PlaceholderPage';
import { CommandPalette } from './CommandPalette';
import { BrowserTab, isBrowserStreamEvent } from './BrowserTab';
import { type OpenSettings } from './SettingsPanel';
import { useShortcuts } from '../hooks/useShortcuts';
import { useServers } from '../hooks/useServers';
import { usePresence } from '../hooks/usePresence';
import { captureFocusTarget, presenceRootProps, restoreFocusTarget } from '../lib/presence-ui';

interface MainViewProps {
  /** 可为 null：跳过引导后无模型配置；发送任务前会校验并提示打开设置 */
  config: ConfiguredModel | null;
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
  onOpenSettings: OpenSettings;
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
    onToggleSidebar, onOpenSettings,
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
  const activeWorkDir = activeProject?.workDir ?? activeSession?.workDir ?? config?.workDir;
  const sidebarPresence = usePresence(sidebarOpen);
  const workspacePresent = props.workspaceOpen && Boolean(activeWorkDir);
  const workspacePresence = usePresence(workspacePresent);
  const retainedWorkDirRef = useRef<string | null>(activeWorkDir ?? null);
  if (activeWorkDir) retainedWorkDirRef.current = activeWorkDir;

  // ---- State ----
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [clearTask, setClearTask] = useState<{ present: boolean; entryCount: number }>({
    present: false,
    entryCount: 0,
  });
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('step');
  const planMode = approvalMode === 'plan';
  const [branch, setBranch] = useState<string | null>(null);
  const [lastUserForRetry, setLastUserForRetry] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<{ present: boolean; workDir: string | null }>({
    present: false,
    workDir: null,
  });
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  // 仅当会话引用的模型已从配置中删除时才提示（切换活跃模型不算）
  const sessionModelMissing = !!activeSession && !modelList.some((m) => m.id === activeSession.modelId);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<import('../../shared/ipc').PlanApprovalRequest | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  // 本次任务的浏览器事件（browser_* / tool_call(browser_*) / tool_result(browser_*)）
  const [browserEvents, setBrowserEvents] = useState<ChatStreamEvent[]>([]);
  const [browserPanelOpen, setBrowserPanelOpen] = useState(false);
  // 用户在本流内收起面板后，不再自动展开
  const browserPanelDismissedRef = useRef(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const nav = useNavHistory(INITIAL_NAV);
  const activeSection: AppSection = nav.current.section;
  const { servers, statuses, refresh: refreshServers } = useServers();
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>({ kind: 'local' });
  // 每会话服务器模型/Agent 选择由 Task 6 接入；当前映射恒为空，发送时透传 undefined 给主进程
  const [serverSelections] = useState<Record<string, { providerID: string; modelID: string; agent?: string }>>({});
  const [slash, setSlash] = useState<SlashState>({
    slashOpen: false, slashItems: [], slashIdx: 0, skillsLoaded: false,
  });
  // /skill 精确调用：选中的技能（发送一次后自动清除）
  const [activeSkill, setActiveSkill] = useState<SkillDef | null>(null);
  // 本次任务注入的相关记忆（memory_context 事件）
  const [memoryContext, setMemoryContext] = useState<MemoryContextItem[]>([]);
  // 本次任务的上下文统计（usage/tool_result/summary 事件累计）
  const [contextStats, setContextStats] = useState<ContextStats | null>(null);
  const [contextState, setContextState] = useState<ContextStateView | null>(null);
  // 本次任务的子代理（subagent_start/progress/done 事件）
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  // 会话结束后已沉淀记忆的提示（memories-extracted 事件）
  const [extractedNotice, setExtractedNotice] = useState<{ sessionId: string; count: number } | null>(null);
  const fileTreePresence = usePresence(fileTree.present);
  const clearTaskPresence = usePresence(clearTask.present);
  const commandPresence = usePresence(commandPaletteOpen);
  const createProjectPresence = usePresence(createProjectOpen);
  const fileTreeReturnFocusRef = useRef<HTMLElement | null>(null);
  const clearTaskReturnFocusRef = useRef<HTMLElement | null>(null);
  const commandReturnFocusRef = useRef<HTMLElement | null>(null);
  const createProjectReturnFocusRef = useRef<HTMLElement | null>(null);
  const clearTaskCancelRef = useRef<HTMLButtonElement | null>(null);

  // ---- Live entry motion metadata ----
  const reducedMotion = useReducedMotion();
  const entrySequenceRef = useRef(0);
  const activeSectionRef = useRef(activeSection);
  const activeSessionRef = useRef(activeSessionId);
  const reducedMotionRef = useRef(reducedMotion);

  activeSectionRef.current = activeSection;
  activeSessionRef.current = activeSessionId;
  reducedMotionRef.current = reducedMotion;

  function nextLiveKey(): string {
    entrySequenceRef.current += 1;
    return `live:${activeSessionRef.current ?? 'none'}:${entrySequenceRef.current}`;
  }

  function presentWithKey(
    entry: DisplayEntry,
    enter: EntryEnterMotion,
    key: string,
    sessionId: string | null = activeSessionRef.current,
  ): DisplayEntry {
    return {
      ...entry,
      presentation: {
        key,
        sessionId,
        enter: activeSectionRef.current === 'tasks' && !reducedMotionRef.current
          ? enter
          : undefined,
      },
    };
  }

  function appendLocalError(message: string) {
    const errorKey = nextLiveKey();
    setEntries((prev) => [...prev, presentWithKey({ kind: 'error', message }, 'status', errorKey)]);
  }

  function navigateToSection(next: AppSection, sessionId: string | null = null) {
    const previous = activeSectionRef.current;
    activeSectionRef.current = next;
    if (previous === 'tasks' && next !== 'tasks') {
      setEntries(clearEntryEnterMotion);
    }
    nav.push({ section: next, sessionId });
  }

  // 后退/前进切换历史会话：把 nav 里的 sessionId 应用到当前会话
  useEffect(() => {
    if (nav.current.section !== 'tasks') return;
    const navSessionId = nav.current.sessionId;
    if (!navSessionId || navSessionId === activeSessionId) return;
    if (sessions.some((session) => session.id === navSessionId)) {
      onSessionSwitched(navSessionId);
      return;
    }
    nav.replace({ section: 'tasks', sessionId: activeSessionId ?? null });
  }, [nav.current.section, nav.current.sessionId, nav.replace, activeSessionId, sessions, onSessionSwitched]);

  useLayoutEffect(() => {
    if (clearTaskPresence.state === 'entering') {
      clearTaskCancelRef.current?.focus({ preventScroll: true });
    }
  }, [clearTaskPresence.state]);

  function openFileTree(returnFocus?: HTMLElement | null): boolean {
    if (!activeWorkDir) return false;
    if (fileTree.present) {
      if (fileTree.workDir !== activeWorkDir) {
        setFileTree({ present: true, workDir: activeWorkDir });
      }
      document
        .querySelector<HTMLButtonElement>('.file-tree-modal [aria-label="关闭文件浏览"]')
        ?.focus({ preventScroll: true });
      return true;
    }
    fileTreeReturnFocusRef.current = captureFocusTarget(returnFocus);
    setFileTree({ present: true, workDir: activeWorkDir });
    return true;
  }

  function closeFileTree() {
    if (!fileTree.present) return;
    restoreFocusTarget(fileTreeReturnFocusRef.current);
    setFileTree((current) => ({ ...current, present: false }));
  }

  function openCommandPalette(returnFocus?: HTMLElement | null) {
    commandReturnFocusRef.current = captureFocusTarget(returnFocus);
    setCommandPaletteOpen(true);
  }

  function closeCommandPalette(options?: { restoreFocus?: boolean }) {
    if (!commandPaletteOpen) return;
    if (options?.restoreFocus !== false) restoreFocusTarget(commandReturnFocusRef.current);
    setCommandPaletteOpen(false);
  }

  function openCreateProject(returnFocus?: HTMLElement | null) {
    if (createProjectOpen) return;
    createProjectReturnFocusRef.current = captureFocusTarget(returnFocus);
    setCreateProjectOpen(true);
  }

  function closeCreateProject() {
    if (!createProjectOpen) return;
    restoreFocusTarget(
      createProjectReturnFocusRef.current,
      document.querySelector<HTMLButtonElement>('.btn-new-project'),
    );
    setCreateProjectOpen(false);
  }

  // ---- Model list ----
  useEffect(() => {
    void window.electronAPI.models.getAll().then(setModelList).catch(() => { /* ignore */ });
  }, [config?.id]);

  // ---- Git branch for the home composer ----
  useEffect(() => {
    let active = true;
    if (!activeWorkDir) {
      setBranch(null);
      return;
    }
    void window.electronAPI.app.getGitBranch(activeWorkDir)
      .then((value) => { if (active) setBranch(value); })
      .catch(() => { if (active) setBranch(null); });
    return () => { active = false; };
  }, [activeWorkDir]);

  // 帮我批准：审批事件到达时自动放行
  useEffect(() => {
    if (approvalMode !== 'auto' || !pendingApproval) return;
    window.electronAPI.chat.approve(pendingApproval.id, true);
    setPendingApproval(null);
  }, [approvalMode, pendingApproval]);

  // 监听主进程"会话结束已提取记忆"事件，显示轻提示
  useEffect(() => {
    return window.electronAPI.memory.onExtracted((info) => setExtractedNotice(info));
  }, []);

  async function handleSwitchModel(id: string) {
    if (!config || id === config.id || switchingModel) return;
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

  // 切换会话时清空上一个会话残留的浏览器面板状态（发送新任务时也会重置）
  useEffect(() => {
    setBrowserEvents([]);
    setBrowserPanelOpen(false);
    browserPanelDismissedRef.current = false;
  }, [activeSessionId]);

  useEffect(() => {
    let cancelled = false;
    setMemoryContext([]);
    setContextState(null);
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
        setAttachments([]);
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
      setAttachments([]);
      void window.electronAPI.sessions.get(activeSessionId).then(({ messages }) => {
        if (cancelled) return;
        setEntries(messagesToEntries(messages));
        entriesSessionRef.current = activeSessionId;
        setApprovalMode('step');
        setLastUserForRetry(null);
        setPendingPlanApproval(null);
      }).catch((e) => {
        console.error('Failed to load session:', e);
      });
      void window.electronAPI.context?.getSnapshot(activeSessionId)
        .then((snapshot) => {
          if (!cancelled) {
            setContextState(snapshot);
            setContextStats({
              promptTokens: snapshot.usage.currentInputTokens,
              completionTokens: 0,
              toolCounts: {},
              recentCalls: [],
              compressedCount: snapshot.usage.lastCompactedAt ? 1 : 0,
              estimated: true,
              contextRevision: snapshot.revision,
              workspaceRevision: snapshot.workspaceRevision,
              usableInputBudget: snapshot.usage.usableInputBudget,
              inputUsageRatio: snapshot.usage.inputUsageRatio,
              nearLimit: snapshot.usage.nearLimit,
              hardLimited: snapshot.usage.hardLimited,
            });
          }
        })
        .catch(() => { /* 旧数据或尚未初始化 Context DB 时保持空态 */ });
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

  // 运行时启用 reduced motion → 清除一次性入场标记，避免重新启用后重放旧动画
  useEffect(() => {
    if (reducedMotion) setEntries(clearEntryEnterMotion);
  }, [reducedMotion]);

  // 原生菜单（macOS）动作：命令面板 / 新建会话 / 打开路径（App 已处理 open-settings）
  useEffect(() => {
    const onMenuAction = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === 'open-command-palette') {
        openCommandPalette();
      } else if (action === 'new-session') {
        void handleNewSession();
      } else if (action.startsWith('open-path:')) {
        handleOpenPath(action.slice('open-path:'.length));
      }
    };
    window.addEventListener('menu-action', onMenuAction);
    return () => window.removeEventListener('menu-action', onMenuAction);
  });

  // M2.4: Finder/ Dock 拖入的文件 → 打开所在项目（或跳到首页）
  function handleOpenPath(filePath: string) {
    const project = projects.find((p) => p.workDir != null && filePath.startsWith(p.workDir));
    if (project) {
      const session = sessions.find((s) => s.projectId === project.id);
      if (session) navigateToSection('tasks', session.id);
      else navigateToSection('home');
    } else {
      navigateToSection('home');
    }
  }

  useEffect(() => {
    if (!clearTask.present) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeClearTask();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [clearTask.present]); // eslint-disable-line react-hooks/exhaustive-deps

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
  function handleNewTask(returnFocus?: HTMLElement | null): boolean {
    if (clearTask.present) {
      clearTaskCancelRef.current?.focus({ preventScroll: true });
      return true;
    }
    if (busy || entries.length === 0) return false;
    clearTaskReturnFocusRef.current = captureFocusTarget(returnFocus);
    setClearTask({ present: true, entryCount: entries.length });
    return true;
  }

  function closeClearTask() {
    if (!clearTask.present) return;
    restoreFocusTarget(clearTaskReturnFocusRef.current);
    setClearTask((current) => ({ ...current, present: false }));
  }

  function doNewTask() {
    if (!clearTask.present) return;
    restoreFocusTarget(clearTaskReturnFocusRef.current);
    setEntries([]);
    setAttachments([]);
    setClearTask((current) => ({ ...current, present: false }));
    setLastUserForRetry(null);
  }

  async function handleSend(returnFocus?: HTMLElement | null) {
    if (!input.trim() || busy) return;
    const activeServerSession = activeSession?.runtime === 'server';
    // 服务器会话（或服务器目标下尚无会话）不要求本地模型配置
    const serverMode = activeServerSession || (!activeSession && executionTarget.kind === 'server');
    if (!config && !serverMode) {
      appendLocalError('请先配置模型后再发送任务。');
      onOpenSettings(undefined, returnFocus ?? document.querySelector<HTMLButtonElement>('.no-model-banner__btn--settings'));
      return;
    }
    if (!activeSessionId) {
      if (activeSectionRef.current === 'tasks') {
        appendLocalError('请先创建并选择一个会话后再发送任务。');
        return;
      }
      void handleNewSession(undefined, returnFocus);
      return;
    }
    if (activeSectionRef.current !== 'tasks') {
      navigateToSection('tasks', activeSessionId);
    }
    setMemoryContext([]);
    setContextStats(null);
    setSubagents([]);
    setBrowserEvents([]);
    setBrowserPanelOpen(false);
    browserPanelDismissedRef.current = false;
    if (activeServerSession && attachments.length > 0) {
      appendLocalError('服务器会话暂不支持附件');
      return;
    }
    if (attachments.length > 0 && !activeWorkDir) {
      appendLocalError('请先创建项目或设置工作目录，再发送附件。');
      return;
    }
    const userContent = input;
    const sentAttachments = attachments.length > 0 ? attachments : undefined;
    const history = [...buildHistory(entries), { role: 'user' as const, content: userContent, attachments: sentAttachments }];
    const usePlanMode = planMode;
    setLastUserForRetry(null);
    // 服务器会话：Task 6 写入每会话选择；当前为空映射，主进程用服务器默认模型
    const serverOverrides: Pick<ChatRequest, 'serverModel' | 'serverAgent'> = {};
    if (activeServerSession && activeSessionId) {
      const selection = serverSelections[activeSessionId];
      if (selection) {
        serverOverrides.serverModel = { providerID: selection.providerID, modelID: selection.modelID };
        if (selection.agent) serverOverrides.serverAgent = selection.agent;
      }
    }

    const userKey = nextLiveKey();
    const assistantKey = nextLiveKey();
    // 流属于启动它的会话：切换会话后，残留事件仍按所属会话标记（渲染为静态）
    const streamSessionId = activeSessionId;
    setEntries((prev) => [
      ...prev,
      presentWithKey({ kind: 'user', content: userContent, attachments: sentAttachments }, 'discrete', userKey),
      presentWithKey({ kind: 'assistant', content: '' }, 'discrete', assistantKey),
    ]);
    setInput('');
    setAttachments([]);
    setBusy(true);
    setStreamId(null);

    try {
      const result = await window.electronAPI.chat.start({
        sessionId: activeSessionId,
        messages: history,
        planMode: usePlanMode,
        attachments: sentAttachments,
        activeSkillName: activeSkill?.name,
        ...serverOverrides,
      });
      setStreamId(result.streamId);
      // 技能只对本次请求生效，发送成功后清除
      setActiveSkill(null);
      for await (const ev of result.events) {
        const eventKey = nextLiveKey();
        setEntries((prev) => {
          const next = applyStreamEventToEntries(
            prev,
            ev,
            setPendingApproval,
            setPendingPlanApproval,
            (entry, enter) => presentWithKey(entry, enter, eventKey, streamSessionId),
          );
          return next ?? prev;
        });
        if (isBrowserStreamEvent(ev)) {
          // M3: 迟到的 browser_* 事件若属于已切走的流，不追加、不自动展开（面板不会挂到别的会话上）
          if (streamSessionId === activeSessionRef.current) {
            setBrowserEvents((prev) => [...prev, ev]);
            if (!browserPanelDismissedRef.current) setBrowserPanelOpen(true);
          }
        }
        if (ev.type === 'memory_context' && ev.memories) {
          setMemoryContext(ev.memories);
        }
        if (ev.type === 'usage') {
          setContextStats((prev) => ({
            promptTokens: ev.totals?.promptTokens ?? prev?.promptTokens ?? 0,
            completionTokens: ev.totals?.completionTokens ?? prev?.completionTokens ?? 0,
            toolCounts: ev.toolCounts ?? prev?.toolCounts ?? {},
            recentCalls: prev?.recentCalls ?? [],
            compressedCount: prev?.compressedCount ?? 0,
            estimated: ev.usage?.estimated ?? prev?.estimated,
          }));
        }
        if (ev.contextState) setContextState(ev.contextState);
        if (ev.type === 'context_usage' && ev.contextUsage) {
          const usage = ev.contextUsage;
          setContextStats((prev) => ({
            promptTokens: usage.currentInputTokens,
            completionTokens: prev?.completionTokens ?? 0,
            toolCounts: prev?.toolCounts ?? {},
            recentCalls: prev?.recentCalls ?? [],
            compressedCount: prev?.compressedCount ?? 0,
            estimated: true,
            contextRevision: ev.contextRevision,
            workspaceRevision: ev.workspaceRevision,
            usableInputBudget: usage.usableInputBudget,
            inputUsageRatio: usage.inputUsageRatio,
            nearLimit: usage.nearLimit,
            hardLimited: usage.hardLimited,
          }));
        }
        if (ev.type === 'tool_result' && ev.toolResult) {
          setContextStats((prev) => {
            if (!prev) return prev;
            const meta = (ev.toolResult!.result as { meta?: { kind?: string; durationMs?: number } })?.meta;
            const call = {
              name: ev.toolResult!.name,
              ok: (ev.toolResult!.result as { ok?: boolean })?.ok === true,
              durationMs: meta?.durationMs,
            };
            return { ...prev, recentCalls: [call, ...prev.recentCalls].slice(0, 5) };
          });
        }
        if (ev.type === 'summary') {
          setContextStats((prev) => ({
            promptTokens: prev?.promptTokens ?? 0,
            completionTokens: prev?.completionTokens ?? 0,
            toolCounts: prev?.toolCounts ?? {},
            recentCalls: prev?.recentCalls ?? [],
            compressedCount: (prev?.compressedCount ?? 0) + 1,
            estimated: prev?.estimated,
          }));
        }
        if (ev.type === 'subagent_start' && ev.subagentId) {
          const subagentId = ev.subagentId;
          const subagentTask = ev.subagentTask ?? '';
          setSubagents((prev) => {
            if (prev.some((s) => s.id === subagentId)) return prev;
            return [...prev, {
              id: subagentId,
              task: subagentTask,
              status: 'running' as const,
              role: ev.subagentRole,
              modelId: ev.subagentModelId,
              contextRevision: ev.subagentContextRevision,
              workspaceRevision: ev.workspaceRevision,
            }];
          });
        }
        if (ev.type === 'subagent_progress' && ev.subagentId) {
          const subagentId = ev.subagentId;
          const subagentTool = ev.subagentTool;
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === subagentId ? { ...s, lastTool: subagentTool } : s,
            ),
          );
        }
        if (ev.type === 'subagent_done' && ev.subagentId) {
          const subagentId = ev.subagentId;
          const subagentOk = ev.subagentOk;
          const subagentSummary = ev.subagentSummary;
          const subagentElapsedMs = ev.subagentElapsedMs;
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === subagentId
                ? {
                    ...s,
                    status: subagentOk ? 'done' as const : 'failed' as const,
                    summary: subagentSummary,
                    elapsedMs: subagentElapsedMs,
                    role: ev.subagentRole ?? s.role,
                    modelId: ev.subagentModelId ?? s.modelId,
                    contextRevision: ev.subagentContextRevision ?? s.contextRevision,
                    workspaceRevision: ev.workspaceRevision ?? s.workspaceRevision,
                  }
                : s,
            ),
          );
        }
        if (ev.type === 'task_complete') {
          const reportKey = nextLiveKey();
          setEntries((prev) => {
            const report = generateReportFromEntries(prev);
            return report ? [...prev, presentWithKey(report, 'discrete', reportKey, streamSessionId)] : prev;
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
      const errorKey = nextLiveKey();
      const msg = (err instanceof Error ? err.message : String(err)) || '请求失败';
      setEntries((prev) => {
        const next = applyStreamEventToEntries(
          prev,
          { type: 'error', error: msg },
          setPendingApproval,
          setPendingPlanApproval,
          (entry, enter) => presentWithKey(entry, enter, errorKey, streamSessionId),
        );
        return next ?? prev;
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

  // ---- Attachments ----
  async function handlePickAttachmentFiles() {
    if (!activeSessionId) {
      appendLocalError('请先创建并选择一个会话后再添加附件。');
      return;
    }
    if (!activeWorkDir) {
      appendLocalError('请先创建项目或设置工作目录，再添加附件。');
      return;
    }
    try {
      const paths = await window.electronAPI.dialog.openAttachmentFiles();
      if (!paths || paths.length === 0) return;
      await handleAddAttachmentPaths(paths);
    } catch (e) {
      appendLocalError(`添加附件失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleAddAttachmentPaths(paths: string[]) {
    if (paths.length === 0) return;
    if (!activeSessionId) {
      appendLocalError('请先创建并选择一个会话后再添加附件。');
      return;
    }
    if (!activeWorkDir) {
      appendLocalError('请先创建项目或设置工作目录，再添加附件。');
      return;
    }
    try {
      const { attachments: added } = await window.electronAPI.attachments.add(activeSessionId, activeWorkDir, paths);
      setAttachments((prev) => [...prev, ...added]);
    } catch (e) {
      appendLocalError(`添加附件失败：${e instanceof Error ? e.message : String(e)}`);
    }
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
      togglePlanMode: () => setApprovalMode((mode) => (mode === 'plan' ? 'step' : 'plan')),
      sendMessage: () => {
        if (!busy && input.trim()) void handleSend();
      },
      rejectApproval: () => {
        if (pendingApproval) {
          window.electronAPI.chat.approve(pendingApproval.id, false);
          setPendingApproval(null);
        }
      },
      openCommandPalette: () => openCommandPalette(),
    },
    !commandPaletteOpen,
  );

  // ---- Slash / Skills ----
  // 技能加载/重载引用最新 activeWorkDir（监听回调需在空依赖 effect 中稳定，用 ref 避免每次重绑）
  const activeWorkDirRef = useRef(activeWorkDir);
  useEffect(() => {
    activeWorkDirRef.current = activeWorkDir;
  }, [activeWorkDir]);

  function handleLoadSkills() {
    const workDir = activeWorkDirRef.current;
    if (!workDir) return;
    void window.electronAPI.skills.list(workDir).then((items) => {
      setSlash((s) => ({ ...s, skillsLoaded: true, slashItems: items }));
    }).catch(() => {
      setSlash((s) => ({ ...s, skillsLoaded: true, slashItems: [] }));
    });
  }

  // ---- Execution target ----
  // settings.defaultServerId 未加载完为 undefined；据此区分「设置未到」与「无默认」
  const [defaultServerId, setDefaultServerId] = useState<string | null | undefined>(undefined);
  const defaultServerAppliedRef = useRef(false);
  const serversSeenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await window.electronAPI?.settings?.get?.();
        if (!cancelled) setDefaultServerId(settings?.defaultServerId ?? null);
      } catch {
        if (!cancelled) setDefaultServerId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 挂载后：默认服务器指向已配置服务器 → 选中它（一次性）
  useEffect(() => {
    if (defaultServerAppliedRef.current) return;
    if (defaultServerId === undefined) return;
    if (servers.length === 0) return;
    defaultServerAppliedRef.current = true;
    if (defaultServerId && servers.some((server) => server.id === defaultServerId)) {
      setExecutionTarget({ kind: 'server', serverId: defaultServerId });
    }
  }, [defaultServerId, servers]);

  // 选中的服务器被删除 → 回退本地
  useEffect(() => {
    if (servers.length > 0) serversSeenRef.current = true;
    if (executionTarget.kind !== 'server') return;
    if (!serversSeenRef.current) return;
    if (!servers.some((server) => server.id === executionTarget.serverId)) {
      setExecutionTarget({ kind: 'local' });
    }
  }, [executionTarget, servers]);

  // 技能/MCP 等设置被其他窗口（设置窗口）修改 → 广播 settings-changed → 重载 slash 技能列表与服务器
  useEffect(() => {
    return window.electronAPI.app.onSettingsChanged(() => {
      setSlash((s) => ({ ...s, skillsLoaded: false }));
      void handleLoadSkills();
      refreshServers();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSlashApply(skill: SkillDef) {
    // 移除输入框中的 /skill 占位文本，激活技能（chip 显示；发送时随请求注入正文）
    setInput((prev) => prev.replace(/^\/\S*\s*/, ''));
    setActiveSkill(skill);
    setSlash((s) => ({ ...s, slashOpen: false }));
  }

  // ---- Session CRUD ----
  function handleNewSession(projectId?: string, returnFocus?: HTMLElement | null): true | void {
    if (busy) return;
    if (executionTarget.kind === 'server') {
      // 服务器会话不要求本地模型/项目，远端使用服务器工作目录
      void window.electronAPI.sessions.create({ runtime: 'server', serverId: executionTarget.serverId })
        .then((session) => {
          onSessionCreated(session);
          navigateToSection('tasks', session.id);
        })
        .catch((error) => console.error('New session failed:', error));
      return;
    }
    if (!config) return;
    const targetProjectId = projectId ?? activeSession?.projectId;
    if (!targetProjectId) {
      navigateToSection('home');
      if (projects.length === 0 && !createProjectOpen) {
        openCreateProject(returnFocus);
        return true;
      }
      return;
    }
    void window.electronAPI.sessions.create({ modelId: config.id, projectId: targetProjectId })
      .then((session) => {
        onSessionCreated(session);
        navigateToSection('tasks', session.id);
      })
      .catch((error) => console.error('New session failed:', error));
  }

  async function handleCreateProject(name: string, selection: { workDir: string; entryFile?: string }) {
    const project = await window.electronAPI.projects.create({
      name,
      workDir: selection.workDir,
      entryFile: selection.entryFile,
    });
    restoreFocusTarget(
      document.querySelector<HTMLButtonElement>('.btn-new-project'),
      createProjectReturnFocusRef.current,
    );
    onProjectCreated(project);
    createProjectReturnFocusRef.current = null;
    setCreateProjectOpen(false);
  }

  function handleSelectSession(id: string) {
    navigateToSection('tasks', id);
    onSessionSwitched(id);
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
      <AppTopBar
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        onBack={nav.back}
        onForward={nav.forward}
        sidebarOpen={sidebarOpen}
        workspaceOpen={props.workspaceOpen}
        onToggleSidebar={onToggleSidebar}
        onToggleWorkspace={props.onToggleWorkspace}
        executionTarget={
          <ServerTargetSelector
            servers={servers}
            statuses={statuses}
            value={executionTarget}
            onChange={setExecutionTarget}
            onManageServers={() => onOpenSettings('servers')}
            onReconnect={(id) => void window.electronAPI.servers.connect(id)}
          />
        }
      />

      <div className="main-layout">
        {sidebarPresence.mounted && (
          <Sidebar
            presence={sidebarPresence}
            projects={projects}
            sessions={sessions}
            servers={servers}
            serverStatuses={statuses}
            activeId={activeSessionId}
            mode={workspaceMode === 'tabs' ? 'compact' : 'full'}
            activeSection={activeSection}
            onNavigate={navigateToSection}
            onOpenSettings={() => onOpenSettings()}
            onSelect={handleSelectSession}
            onNew={(returnFocus) => void handleNewSession(undefined, returnFocus)}
            onDelete={(id) => void handleDeleteSession(id)}
            onRename={(id, title) => void handleRenameSession(id, title)}
            onProjectCreate={openCreateProject}
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
                  onNewTab={(returnFocus) => void handleNewSession(undefined, returnFocus)}
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
              {browserPanelOpen && activeSessionId && (
                <BrowserTab
                  sessionId={activeSessionId}
                  streamId={streamId}
                  events={browserEvents}
                  onDismiss={() => {
                    browserPanelDismissedRef.current = true;
                    setBrowserPanelOpen(false);
                  }}
                />
              )}
              <ChatStream
                entries={entries}
                busy={busy}
                streamId={streamId}
                chatRef={chatRef}
                lastUserForRetry={lastUserForRetry}
                modelMissing={sessionModelMissing}
                workDir={activeWorkDir}
                sessionId={activeSessionId ?? undefined}
                onOpenSettings={() => onOpenSettings()}
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
              {extractedNotice && activeSessionId === extractedNotice.sessionId && (
                <div className="memory-extracted-hint motion-feedback-enter" role="status">
                  本次会话已沉淀 {extractedNotice.count} 条记忆，可在记忆中心查看
                </div>
              )}
              <InputArea
                input={input}
                busy={busy}
                approvalMode={approvalMode}
                slash={slash}
                hasWorkDir={!!activeWorkDir}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                onPickAttachments={() => void handlePickAttachmentFiles()}
                onAddAttachmentPaths={(paths) => void handleAddAttachmentPaths(paths)}
                onInputChange={setInput}
                onApprovalModeChange={setApprovalMode}
                onSend={() => void handleSend()}
                onSlashApply={handleSlashApply}
                onSlashOpen={() => setSlash((s) => ({ ...s, slashOpen: true, slashIdx: 0 }))}
                onSlashClose={() => setSlash((s) => ({ ...s, slashOpen: false }))}
                onSlashIdxChange={(idx) => setSlash((s) => ({ ...s, slashIdx: idx }))}
                onLazyLoadSkills={handleLoadSkills}
                activeSkill={activeSkill}
                onActiveSkillClear={() => setActiveSkill(null)}
                modelControl={
                  <ModelSwitcher
                    config={config}
                    modelList={modelList}
                    switchingModel={switchingModel}
                    onSwitchModel={(id) => void handleSwitchModel(id)}
                    onReconfigure={(returnFocus) => onOpenSettings(undefined, returnFocus)}
                  />
                }
              />
            </>
          ) : activeSection === 'memory' ? (
            <MemoryCenter />
          ) : activeSection === 'files' ? (
            <SidebarFileView workDir={activeWorkDir ?? null} onOpenFullScreen={() => { openFileTree(); }} />
          ) : activeSection === 'pull-requests' ? (
            <PlaceholderPage
              title="Pull Request"
              description="Pull Request 将在后续版本推出"
              icon="copy"
              onBackHome={() => navigateToSection('home')}
            />
          ) : activeSection === 'scheduled' ? (
            <PlaceholderPage
              title="已安排"
              description="定时任务将在后续版本推出"
              icon="calendar"
              onBackHome={() => navigateToSection('home')}
            />
          ) : (
            <HomeView
              config={config}
              projects={projects}
              activeProjectId={activeProject?.id}
              branch={branch}
              input={input}
              busy={busy}
              attachments={attachments}
              hasWorkDir={!!activeWorkDir}
              approvalMode={approvalMode}
              modelMissing={!config && executionTarget.kind !== 'server'}
              serverTarget={
                executionTarget.kind === 'server'
                  ? { name: servers.find((server) => server.id === executionTarget.serverId)?.name ?? '服务器' }
                  : null
              }
              onOpenSettings={() => onOpenSettings()}
              onInputChange={setInput}
              onAttachmentsChange={setAttachments}
              onAddPaths={(paths) => void handleAddAttachmentPaths(paths)}
              onPickAttachments={() => void handlePickAttachmentFiles()}
              onSend={(returnFocus) => void handleSend(returnFocus)}
              onApprovalModeChange={setApprovalMode}
              modelControl={
                <ModelSwitcher
                  config={config}
                  modelList={modelList}
                  switchingModel={switchingModel}
                  onSwitchModel={(id) => void handleSwitchModel(id)}
                  onReconfigure={(returnFocus) => onOpenSettings(undefined, returnFocus)}
                />
              }
            />
          )}
        </div>
        {workspacePresence.mounted && retainedWorkDirRef.current && (
          <WorkspacePanel
            presence={workspacePresence}
            workDir={retainedWorkDirRef.current}
            goal={workspaceGoal}
            progress={{ completed: toolResultCount, total: toolCallCount }}
            deliverables={workspaceDeliverables}
            touchedFiles={touchedFiles}
            memoryContext={memoryContext}
            contextStats={contextStats}
            contextState={contextState}
            contextWindow={config?.contextWindow}
            subagents={subagents}
            onCreateCheckpoint={activeSessionId ? async () => {
              const snapshot = await window.electronAPI.context.createCheckpoint(activeSessionId);
              setContextState(snapshot);
            } : undefined}
          />
        )}
      </div>

      {clearTaskPresence.mounted && (
        <div
          className="modal-backdrop"
          {...presenceRootProps(clearTaskPresence)}
          onClick={closeClearTask}
        >
          <div
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-new-title"
            aria-describedby="confirm-new-description"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-new-title">清空当前聊天？</h3>
            <p id="confirm-new-description">当前 {clearTask.entryCount} 条工作记录会被清除，任务上下文也会重新开始。</p>
            <div className="modal-actions">
              <button ref={clearTaskCancelRef} className="btn btn-secondary" onClick={closeClearTask} type="button" autoFocus>
                取消
              </button>
              <button className="btn btn-danger" onClick={doNewTask} type="button">
                清空
              </button>
            </div>
          </div>
        </div>
      )}

      {fileTreePresence.mounted && fileTree.workDir && (
        <FileTreeModal
          presence={fileTreePresence}
          workDir={fileTree.workDir}
          onClose={closeFileTree}
        />
      )}

      {commandPresence.mounted && (
        <CommandPalette
          presence={commandPresence}
          onClose={closeCommandPalette}
          sessions={sessions}
          modelList={modelList}
          activeSessionId={activeSessionId}
          activeModelId={config?.id ?? null}
          theme={props.theme ?? 'light'}
          onSelectSession={handleSelectSession}
          onNewSession={() => handleNewSession(undefined, commandReturnFocusRef.current)}
          onDeleteSession={(id) => void handleDeleteSession(id)}
          onSetActiveModel={(id) => void handleSwitchModel(id)}
          onSetTheme={(t) => props.onThemeChange?.(t)}
          onOpenSettings={(tab) => props.onOpenSettings(tab, commandReturnFocusRef.current)}
          onOpenFileTree={() => openFileTree(commandReturnFocusRef.current)}
          onToggleSidebar={props.onToggleSidebar}
          onToggleWorkspace={props.onToggleWorkspace}
          onTogglePlanMode={() => setApprovalMode((mode) => (mode === 'plan' ? 'step' : 'plan'))}
          onNewTask={() => handleNewTask(commandReturnFocusRef.current)}
        />
      )}

      {createProjectPresence.mounted && createPortal(
        <ProjectDialog
          presence={createProjectPresence}
          mode="create"
          onCreate={handleCreateProject}
          onClose={closeCreateProject}
        />,
        document.body,
      )}
    </div>
  );
}
