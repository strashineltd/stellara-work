import { useEffect, useState } from 'react';
import type { ThemeName } from '../../shared/ipc';
import { Icon, type IconName } from './Icon';
import { SettingsModelsPanel } from './settings/SettingsModelsPanel';
import { SettingsSessionsPanel } from './settings/SettingsSessionsPanel';
import { SettingsAppPanel } from './settings/SettingsAppPanel';
import { SettingsSkillsPanel } from './settings/SettingsSkillsPanel';
import { SettingsShortcutsPanel } from './settings/SettingsShortcutsPanel';
import { resolveTheme } from '../lib/theme';

export const SETTINGS_TABS = [
  { id: 'models', label: '模型' },
  { id: 'sessions', label: '会话' },
  { id: 'app', label: '应用' },
  { id: 'skills', label: '技能' },
  { id: 'shortcuts', label: '快捷键' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

const TAB_ICONS: Record<SettingsTab, IconName> = {
  models: 'settings',
  sessions: 'list',
  app: 'monitor',
  skills: 'tool',
  shortcuts: 'more',
};

/**
 * 独立设置窗口外壳：顶栏（darwin 红绿灯由系统绘制，左侧留白）+ 左导航 + 面板容器。
 * 各 panel 挂载时自行加载数据；模型变更后由主进程广播 settings-changed，
 * 本窗口监听并递增 refreshKey，让已挂载的 panel 重新拉取数据。
 */
export function SettingsWindow({ initialTab = 'models' }: { initialTab?: string }) {
  const [tab, setTab] = useState<SettingsTab>(
    SETTINGS_TABS.some((t) => t.id === initialTab) ? (initialTab as SettingsTab) : 'models',
  );
  const [version, setVersion] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<ThemeName>('light');

  useEffect(() => {
    void window.electronAPI.app.getInfo().then((info) => {
      document.documentElement.dataset.platform = info.platform;
      setVersion(info.version);
    });
  }, []);

  // 主题写到 documentElement.dataset.theme（global.css 用 [data-theme="dark"] 选择器）
  useEffect(() => {
    void window.electronAPI.settings.get().then((st) => {
      if (st.theme) setTheme(st.theme);
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
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

  // 其他窗口（主窗口等）改了模型配置 → 主进程广播 settings-changed → 刷新当前面板
  useEffect(() => {
    return window.electronAPI.app.onSettingsChanged(() => setRefreshKey((k) => k + 1));
  }, []);

  return (
    <div className="settings-window">
      <div className="settings-window__titlebar">
        <span className="settings-window__title">设置</span>
        <span className="settings-window__spacer" />
        <span className="settings-window__version">Stellara Work {version}</span>
      </div>
      <div className="settings-window__body">
        <nav className="settings-nav" role="tablist" aria-label="设置分类" aria-orientation="vertical">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item.id}
              id={`settings-tab-${item.id}`}
              data-tab={item.id}
              className={`settings-nav__item ${tab === item.id ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`settings-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <Icon name={TAB_ICONS[item.id]} size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <main
          className="settings-panels"
          id={`settings-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          {tab === 'models' && (
            <SettingsModelsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === 'sessions' && (
            <SettingsSessionsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === 'app' && (
            <SettingsAppPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === 'skills' && (
            <SettingsSkillsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
          {tab === 'shortcuts' && (
            <SettingsShortcutsPanel refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
        </main>
      </div>
    </div>
  );
}
