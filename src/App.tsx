import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/ipc';

/**
 * W1 最小 React 骨架
 *
 * W1 目标：渲染进程能起来，能调主进程 IPC（验证主进程/渲染进程连通）
 * 完整聊天 UI 在 W2 实现
 */
export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.app
      .getInfo()
      .then(setAppInfo)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Stellara Work</h1>
        <p className="tagline">数据本地的 Codex 风格桌面 Agent · W1 后端核心闭环</p>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-box">
            <strong>错误：</strong>
            {error}
          </div>
        )}

        {appInfo ? (
          <div className="info-box">
            <h2>主进程连通 ✓</h2>
            <ul>
              <li>版本：{appInfo.version}</li>
              <li>平台：{appInfo.platform}</li>
              <li>数据目录：{appInfo.appDataPath}</li>
              <li>配置文件：{appInfo.envPath}</li>
            </ul>
            <p className="hint">
              完整聊天 UI 在 W2 实现。
              <br />
              W1 验收：跑 <code>npm run verify:w1</code> 验证后端 agent 循环。
            </p>
          </div>
        ) : (
          !error && <div className="loading">连接主进程...</div>
        )}
      </main>
    </div>
  );
}
