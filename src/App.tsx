import { useEffect, useState } from 'react';
import type {
  AppInfo, ModelConfig, ModelPreset, SessionSummary,
} from '../shared/ipc';
import { Onboarding } from './components/Onboarding';
import { MainView } from './components/MainView';
import { SettingsModal } from './components/SettingsModal';

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
    };

/**
 * App 根：根据是否已配置模型，决定显示 Onboarding 还是主界面
 * 主界面状态额外管 sessions 列表和 activeSessionId
 */
export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      window.electronAPI.app.getInfo(),
      window.electronAPI.models.list(),
      window.electronAPI.sessions.list(),
    ])
      .then(([info, modelList, sessions]) => {
        if (modelList.configured) {
          const activeId = sessions[0]?.id ?? null;
          setState({
            kind: 'ready',
            config: modelList.configured,
            info,
            sessions,
            activeSessionId: activeId,
            sidebarOpen: true,
          });
        } else {
          setState({ kind: 'onboarding', presets: modelList.presets, info });
        }
      })
      .catch((e) => {
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

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
        activeSessionId={state.activeSessionId}
        sessions={state.sessions}
        onToggleSidebar={() => setState((s) => s.kind === 'ready' ? { ...s, sidebarOpen: !s.sidebarOpen } : s)}
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
        onOpenSettings={() => setSettingsOpen(true)}
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
        />
      )}
    </>
  );
}
