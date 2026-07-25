import { useEffect, useState } from 'react';
import type { AppInfo, ModelConfig, ModelPreset } from '../shared/ipc';
import { Onboarding } from './components/Onboarding';
import { MainView } from './components/MainView';

type AppState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'onboarding'; presets: ModelPreset[]; info: AppInfo; initialConfig?: ModelConfig | null }
  | { kind: 'ready'; config: ModelConfig; info: AppInfo };

/**
 * App 根：根据是否已配置模型，决定显示 Onboarding 还是主界面
 */
export default function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' });

  useEffect(() => {
    Promise.all([
      window.electronAPI.app.getInfo(),
      window.electronAPI.models.list(),
    ])
      .then(([info, modelList]) => {
        if (modelList.configured) {
          setState({ kind: 'ready', config: modelList.configured, info });
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
        onComplete={(config) => setState({ kind: 'ready', config, info: state.info })}
      />
    );
  }

  return (
    <MainView
      config={state.config}
      info={state.info}
      onReconfigure={() => {
        // 拿一份新的 presets（可能用户换了电脑、预设更新了）
        void window.electronAPI.models.list().then((modelList) => {
          setState({
            kind: 'onboarding',
            presets: modelList.presets,
            info: state.info,
            initialConfig: state.config,
          });
        });
      }}
      onSwitchModel={(newConfig) => {
        // 切换到另一个已配模型：直接更新 state（config 已 saveModelConfig 写好）
        setState({ kind: 'ready', config: newConfig, info: state.info });
      }}
    />
  );
}
