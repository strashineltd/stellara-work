import { useEffect, useState } from 'react';
import type {
  AppInfo, ModelConfig, ModelPreset, SessionSummary, ThemeName,
} from '../shared/ipc';
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from '../shared/shortcuts';
import { useShortcuts } from './hooks/useShortcuts';
import { Onboarding } from './components/Onboarding';
import { MainView } from './components/MainView';
import { SettingsModal, type Tab as SettingsTab } from './components/SettingsModal';

/** 把 theme（light/dark/system）解析成实际写到 data-theme 的值 */
function resolveTheme(theme: ThemeName): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

type AppState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'onboarding'; presets: ModelPreset[]; info: AppInfo; initialConfig?: ModelConfig | null }
  | {
      kind: 'ready';
      config: ModelConfig;
      info: AppInfo;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('providers');

  function openSettingsAt(tab: SettingsTab) {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }
  const [shortcuts, setShortcuts] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [theme, setTheme] = useState<ThemeName>('dark'); // v0.9 主推暗色
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

  useEffect(() => {
    Promise.all([
      window.electronAPI.app.getInfo(),
      window.electronAPI.models.list(),
      window.electronAPI.sessions.list(),
      window.electronAPI.settings.get(),
    ])
      .then(([info, modelList, sessions, settings]) => {
        if (settings.shortcuts) setShortcuts({ ...DEFAULT_SHORTCUTS, ...settings.shortcuts });
        if (settings.theme) setTheme(settings.theme);
        if (settings.workspaceMode) setWorkspaceMode(settings.workspaceMode);
        if (modelList.configured) {
          const activeId = sessions[0]?.id ?? null;
          setState({
            kind: 'ready',
            config: modelList.configured,
            info,
            sessions,
            activeSessionId: activeId,
            sidebarOpen: true,
            workspaceOpen: false,
          });
        } else {
          setState({ kind: 'onboarding', presets: modelList.presets, info });
        }
      })
      .catch((e) => {
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  // 快捷键：左 sidebar + 右 workspace（MainView 自己处理 Plan / Send / Esc）
  useShortcuts(shortcuts, {
    toggleSidebar: () => {
      setState((s) => s.kind === 'ready' ? { ...s, sidebarOpen: !s.sidebarOpen } : s);
    },
    toggleWorkspace: () => {
      setState((s) => s.kind === 'ready' ? { ...s, workspaceOpen: !s.workspaceOpen } : s);
    },
  });

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
        initialConfig={state.initialConfig}
        onComplete={(config) => {
          // Onboarding 完成后建一个新会话
          window.electronAPI.sessions.create({ modelId: config.id, workDir: config.workDir })
            .then(async (session) => {
              const sessions = await window.electronAPI.sessions.list();
              setState({
                kind: 'ready',
                config,
                info: state.info,
                sessions,
                activeSessionId: session.id,
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
        sessions={state.sessions}
        onToggleSidebar={() => setState((s) => s.kind === 'ready' ? { ...s, sidebarOpen: !s.sidebarOpen } : s)}
        onToggleWorkspace={() => setState((s) => s.kind === 'ready' ? { ...s, workspaceOpen: !s.workspaceOpen } : s)}
        onReconfigure={() => {
          void window.electronAPI.models.list().then((modelList) => {
            setState({
              kind: 'onboarding',
              presets: modelList.presets,
              info: state.info,
              initialConfig: state.config,
            });
          });
        }}
        onOpenSettings={(tab?: SettingsTab) => { openSettingsAt(tab ?? 'providers'); }}
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
        onChangeWorkDir={async () => {
          const dir = await window.electronAPI.dialog.openDirectory();
          if (!dir) return;
          try {
            await window.electronAPI.models.updateWorkDir(state.config.id, dir);
            setState((s) => s.kind === 'ready' ? { ...s, config: { ...s.config, workDir: dir } } : s);
          } catch (e) {
            console.error('设置 workDir 失败:', e);
          }
        }}
      />
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onModelChanged={(newConfig) => {
            setState((s) => s.kind === 'ready' ? { ...s, config: newConfig } : s);
          }}
          onShortcutsChanged={(newShortcuts) => {
            setShortcuts({ ...DEFAULT_SHORTCUTS, ...newShortcuts });
          }}
          theme={theme}
          onThemeChanged={setTheme}
          workDir={state.kind === 'ready' ? state.config.workDir : undefined}
          initialTab={settingsInitialTab}
        />
      )}
    </>
  );
}
