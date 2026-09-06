import { useEffect, useState } from 'react';
import type { BrowserConfigView } from '../../../shared/ipc';
import { Icon } from '../Icon';

const PROVIDERS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'duck', label: 'DuckDuckGo（免 Key）' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave' },
];

const DEFAULT_CONFIG: BrowserConfigView = {
  searchProvider: 'auto',
  execJsEnabled: false,
  hasTavilyKey: false,
  hasBraveKey: false,
};

export function SettingsBrowserPanel({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [config, setConfig] = useState<BrowserConfigView>(DEFAULT_CONFIG);
  const [keys, setKeys] = useState<{ tavily: string; brave: string }>({ tavily: '', brave: '' });
  const [saved, setSaved] = useState<{ tavily: boolean; brave: boolean }>({ tavily: false, brave: false });
  const [error, setError] = useState<string | null>(null);
  // 其他窗口改了浏览器配置 → 主进程广播 settings-changed → 本地递增 refresh 触发重新拉取
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.electronAPI.app.onSettingsChanged(() => {
      if (active) setLocalRefresh((k) => k + 1);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await window.electronAPI.browser.getConfig());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshKey, localRefresh]);

  function apply(patch: { searchProvider?: string; execJsEnabled?: boolean }) {
    setConfig((c) => ({ ...c, ...patch }));
    void window.electronAPI.browser.updateConfig(patch).then(() => onChanged?.()).catch((e: Error) => setError(e.message));
  }

  async function saveKey(provider: 'tavily' | 'brave') {
    const key = keys[provider].trim();
    if (!key) return;
    try {
      await window.electronAPI.browser.setSearchKey(provider, key);
      setConfig((c) => ({ ...c, [provider === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey']: true }));
      setKeys((k) => ({ ...k, [provider]: '' }));
      setSaved((s) => ({ ...s, [provider]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [provider]: false })), 2000);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function clearKey(provider: 'tavily' | 'brave') {
    try {
      await window.electronAPI.browser.clearSearchKey(provider);
      setConfig((c) => ({ ...c, [provider === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey']: false }));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const provider = config.searchProvider;
  const providerMissingKey = (provider === 'tavily' && !config.hasTavilyKey) || (provider === 'brave' && !config.hasBraveKey);

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>AI 浏览器</h2>
          <div className="sub">搜索服务与页面 JS 执行权限</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      <section className="settings-section" aria-label="AI 浏览器">
        <div className="settings-section__title">执行权限</div>
        <div className="settings-group">
          <label className="settings-item">
            <span className="settings-item__grow">
              <span className="settings-item__label">允许 Agent 执行页面 JS</span>
              <span className="settings-item__hint">高风险：仅建议对可信站点开启（browser_exec_js 仍每次审批）</span>
            </span>
            <input
              type="checkbox"
              checked={config.execJsEnabled}
              onChange={(e) => apply({ execJsEnabled: e.target.checked })}
            />
          </label>
        </div>
      </section>

      <section className="settings-section" aria-label="搜索服务">
        <div className="settings-section__title">默认搜索服务</div>
        <div className="settings-group">
          <label className="settings-item">
            <span className="settings-item__grow">
              <span className="settings-item__label">搜索服务</span>
              <span className="settings-item__hint">Tavily / Brave 需在下方配置 API Key；DuckDuckGo 免 Key</span>
            </span>
            <select
              value={provider}
              onChange={(e) => apply({ searchProvider: e.target.value })}
              aria-label="搜索服务"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {providerMissingKey && (
        <p className="empty-hint">当前搜索服务尚未配置 API Key，web_search 会回退到 DuckDuckGo。</p>
      )}

      <section className="settings-section" aria-label="API Key">
        <div className="settings-section__title">API Key</div>
        <div className="settings-group">
          {(['tavily', 'brave'] as const).map((p) => (
            <div className="settings-item" key={p}>
              <div className="settings-item__grow">
                <div className="settings-item__label">{p === 'tavily' ? 'Tavily' : 'Brave'} API Key</div>
                <div className="settings-item__hint">
                  {config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] ? '✔ 已配置' : '未配置'}
                </div>
              </div>
              <div className="settings-item__ops">
                <input
                  type="password"
                  placeholder={config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] ? '已配置，输入可覆盖' : '粘贴 Key'}
                  value={keys[p]}
                  onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))}
                  aria-label={`${p} API Key`}
                />
                <button type="button" className="btn btn-secondary" onClick={() => void saveKey(p)}>
                  {saved[p] ? '已保存' : '保存'}
                </button>
                {config[p === 'tavily' ? 'hasTavilyKey' : 'hasBraveKey'] && (
                  <button type="button" className="btn btn-ghost" onClick={() => void clearKey(p)}>
                    清除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}