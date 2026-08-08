import { useEffect, useState } from 'react';
import type {
  AppInfo, ConfiguredModel, ModelPreset, SessionSummary, ProjectSummary, ThemeName,
} from '../shared/ipc';
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from '../shared/shortcuts';
import { useShortcuts } from './hooks/useShortcuts';
import { Onboarding } from './components/Onboarding';
import { MainView } from './components/MainView';
import { resolveTheme } from './lib/theme';

type AppState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'onboarding'; presets: ModelPreset[]; info: AppInfo; projects: ProjectSummary[]; initialConfig?: ConfiguredModel | null }
  | {
      kind: 'ready';
      config: ConfiguredModel;
      info: AppInfo;
      projects: ProjectSummary[];
      sessions: SessionSummary[];
      activeSessionId: string | null;
      sidebarOpen: boolean;
      workspaceOpen: boolean;
    };

/**
 * App 根：根据是否已配置模型，决定显示 Onboarding 还是主界面
 * 主界面状态额外管 sessions 列表和 activeSessionId
 */
export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' });

  // 原生菜单（macOS）动作 → 渲染层 UI
  useEffect(() => {
    const off = window.electronAPI.menu?.onAction((action) => {
      if (action === 'open-settings') {
        void window.electronAPI.app.openSettingsWindow();
      } else {
        // MainView 处理：命令面板 / 新建会话
        window.dispatchEvent(new CustomEvent('menu-action', { detail: action }));
      }
    });
    return () => off?.();
  }, []);

  // 设置窗口变更 → 主窗口实时同步
  useEffect(() => {
    return window.electronAPI.app.onSettingsChanged(() => {
      void window.electronAPI.models.list().then((modelList) => {
        const configured = modelList.configured;
        if (configured) {
          setState((s) => s.kind === 'ready' ? { ...s, config: configured } : s);
        }
      });
      void window.electronAPI.settings.get().then((st) => {
        if (st.theme) setTheme(st.theme);
        if (st.shortcuts) setShortcuts({ ...DEFAULT_SHORTCUTS, ...st.shortcuts });
        if (st.workspaceMode) setWorkspaceMode(st.workspaceMode);
      });
      void window.electronAPI.sessions.list().then((sessions) => {
        setState((s) => s.kind === 'ready' ? { ...s, sessions } : s);
      });
    });
  }, []);
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [theme, setTheme] = useState<ThemeName>('light');
  const [workspaceMode, setWorkspaceMode] = useState<'sidebar' | 'tabs'>('sidebar');

  // 主题写到 documentElement.dataset.theme（global.css 用 [data-theme="dark"] 选择器）
  useEffect(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.dataset.theme = resolved;
  }, [theme]);

  // 'system' 时跟随系统 prefers-color-scheme 变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      document.documentElement.dataset.theme = resolveTheme('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // 平台写到 documentElement.dataset.platform（workbench.css 用 [data-platform='darwin'] 选择器）
  useEffect(() => {
    void window.electronAPI.app.getInfo().then((info) => {
      document.documentElement.dataset.platform = info.platform;
    });
  }, []);

  useEffect(() => {
    Promise.all([
      window.electronAPI.app.getInfo(),
      window.electronAPI.models.list(),
      window.electronAPI.sessions.list(),
      window.electronAPI.projects.list(),
      window.electronAPI.settings.get(),
    ])
      .then(([info, modelList, sessions, projects, settings]) => {
        if (settings.shortcuts) setShortcuts({ ...DEFAULT_SHORTCUTS, ...settings.shortcuts });
        if (settings.theme) setTheme(settings.theme);
        if (settings.workspaceMode) setWorkspaceMode(settings.workspaceMode);
        if (modelList.configured) {
          const activeId = sessions[0]?.id ?? null;
          setState({
            kind: 'ready',
            config: modelList.configured,
            info,
            projects,
            sessions,
            activeSessionId: activeId,
            sidebarOpen: true,
            workspaceOpen: false,
          });
        } else {
          setState({ kind: 'onboarding', presets: modelList.presets, info, projects });
        }
      })
      .catch((e) => {
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  // Tab 快捷键需要的 closed-tab history
  const [closedTabHistory, setClosedTabHistory] = useState<string[]>([]);

  // 快捷键：左 sidebar + 右 workspace + tab 操作
  useShortcuts(shortcuts, {
    toggleSidebar: () => {
      setState((s) => s.kind === 'ready' ? { ...s, sidebarOpen: !s.sidebarOpen } : s);
    },
    toggleWorkspace: () => {
      setState((s) => s.kind === 'ready' ? { ...s, workspaceOpen: !s.workspaceOpen } : s);
    },
    switchTab1: () => switchToTab(0),
    switchTab2: () => switchToTab(1),
    switchTab3: () => switchToTab(2),
    switchTab4: () => switchToTab(3),
    switchTab5: () => switchToTab(4),
    switchTab6: () => switchToTab(5),
    switchTab7: () => switchToTab(6),
    switchTab8: () => switchToTab(7),
    switchTab9: () => switchToTab(8),
    closeActiveTab: () => {
      if (state.kind !== 'ready' || !state.activeSessionId) return;
      const id = state.activeSessionId;
      // 仅从 UI 列表移除，不删除数据库记录
      setClosedTabHistory((h) => [id, ...h]);
      const remaining = state.sessions.filter((x) => x.id !== id);
      const nextId = remaining[0]?.id ?? null;
      setState({ ...state, sessions: remaining, activeSessionId: nextId });
      // 不调用 sessions.delete —— session 保留在数据库中，可通过 Ctrl+Shift+T 恢复
    },
    reopenClosedTab: () => {
      if (closedTabHistory.length === 0) return;
      const [id, ...rest] = closedTabHistory;
      setClosedTabHistory(rest);
      void window.electronAPI.sessions.get(id).then((result) => {
        if (result?.session) {
          const s = result.session;
          const summary: SessionSummary = { id: s.id, title: s.title, modelId: s.modelId, messageCount: s.messageCount, updatedAt: s.updatedAt, workDir: s.workDir, projectId: s.projectId };
          setState((prev) => {
            if (prev.kind !== 'ready') return prev;
            return {
              ...prev,
              sessions: [summary, ...prev.sessions],
              activeSessionId: s.id,
            };
          });
        }
      }).catch(() => {});
    },
  });

  function switchToTab(index: number) {
    if (state.kind !== 'ready') return;
    const session = state.sessions[index];
    if (session) setState({ ...state, activeSessionId: session.id });
  }

  if (state.kind === 'loading') {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <p>连接主进程...</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="app-error">
        <h1>启动出错</h1>
        <pre>{state.message}</pre>
      </div>
    );
  }

  if (state.kind === 'onboarding') {
    return (
      <Onboarding
        presets={state.presets}
        projects={state.projects}
        initialConfig={state.initialConfig}
        onComplete={(config, projectId) => {
          // 模型配置与项目分离：首次完成后进入空工作台或已选项目，由用户继续创建。
          Promise.all([
            window.electronAPI.sessions.list(),
            window.electronAPI.projects.list(),
          ])
            .then(([sessions, projects]) => {
              const projectSession = projectId
                ? sessions.find((s) => s.projectId === projectId)
                : undefined;
              setState({
                kind: 'ready',
                config,
                info: state.info,
                projects,
                sessions,
                activeSessionId: projectSession?.id ?? sessions[0]?.id ?? null,
                sidebarOpen: true,
                workspaceOpen: false,
              });
            })
            .catch((e) => setState({ kind: 'error', message: e.message }));
        }}
      />
    );
  }

  return (
    <>
      <MainView
        config={state.config}
        info={state.info}
        sidebarOpen={state.sidebarOpen}
        workspaceOpen={state.workspaceOpen}
        workspaceMode={workspaceMode}
        shortcuts={shortcuts}
        theme={theme}
        onThemeChange={setTheme}
        activeSessionId={state.activeSessionId}
        projects={state.projects}
        sessions={state.sessions}
        onToggleSidebar={() => setState((s) => s.kind === 'ready' ? { ...s, sidebarOpen: !s.sidebarOpen } : s)}
        onToggleWorkspace={() => setState((s) => s.kind === 'ready' ? { ...s, workspaceOpen: !s.workspaceOpen } : s)}
        onReconfigure={() => {
          void window.electronAPI.models.list().then((modelList) => {
            setState({
              kind: 'onboarding',
              presets: modelList.presets,
              info: state.info,
              projects: state.projects,
              initialConfig: state.config,
            });
          });
        }}
        // MainView 的回调会被按钮直接调用；显式包一层，避免 MouseEvent 被误当成设置 tab。
        onOpenSettings={(tab) => void window.electronAPI.app.openSettingsWindow(tab)}
        onProjectCreated={(project) => {
          setState((s) => s.kind === 'ready'
            ? { ...s, projects: [{ id: project.id, name: project.name, workDir: project.workDir, entryFile: project.entryFile, updatedAt: project.updatedAt, sessionCount: 0 }, ...s.projects] }
            : s);
        }}
        onProjectDeleted={(id) => {
          setState((s) => {
            if (s.kind !== 'ready') return s;
            // 把被删项目的会话移到未分组
            const sessions = s.sessions.map((sess) => sess.projectId === id ? { ...sess, projectId: undefined } : sess);
            const projects = s.projects.filter((p) => p.id !== id);
            return { ...s, projects, sessions };
          });
        }}
        onProjectRenamed={(id, name) => {
          setState((s) => s.kind === 'ready'
            ? { ...s, projects: s.projects.map((p) => p.id === id ? { ...p, name } : p) }
            : s);
        }}
        onProjectFileUpdated={(project) => {
          setState((s) => s.kind === 'ready'
            ? {
                ...s,
                projects: s.projects.map((item) => item.id === project.id
                  ? { ...item, workDir: project.workDir, entryFile: project.entryFile, updatedAt: project.updatedAt }
                  : item),
              }
            : s);
        }}
        onSessionCreated={(session) => {
          setState((s) => s.kind === 'ready'
            ? { ...s, sessions: [session, ...s.sessions], activeSessionId: session.id }
            : s);
        }}
        onSessionSwitched={async (id) => {
          setState((s) => s.kind === 'ready' ? { ...s, activeSessionId: id } : s);
        }}
        onSessionDeleted={async (id) => {
          setState((s) => {
            if (s.kind !== 'ready') return s;
            const remaining = s.sessions.filter((x) => x.id !== id);
            return {
              ...s,
              sessions: remaining,
              activeSessionId: s.activeSessionId === id ? remaining[0]?.id ?? null : s.activeSessionId,
            };
          });
        }}
        onSessionRenamed={async (id, title) => {
          setState((s) => {
            if (s.kind !== 'ready') return s;
            return {
              ...s,
              sessions: s.sessions.map((x) => x.id === id ? { ...x, title } : x),
            };
          });
        }}
        onSessionsChanged={(sessions) => {
          setState((s) => s.kind === 'ready' ? { ...s, sessions } : s);
        }}
        onModelChanged={(newConfig) => {
          setState((s) => s.kind === 'ready' ? { ...s, config: newConfig } : s);
        }}
      />
    </>
  );
}
