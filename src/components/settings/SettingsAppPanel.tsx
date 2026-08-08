import { useEffect, useState } from 'react';
import type { AppSettings, DiagnosticsInfo, ThemeName } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface SettingsAppPanelProps {
  /** 设置变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

type WorkspaceMode = 'sidebar' | 'tabs';

const THEME_OPTIONS: Array<{ value: ThemeName; label: string; swatch: string }> = [
  { value: 'light', label: '浅色', swatch: '#ffffff' },
  { value: 'dark', label: '深色', swatch: '#1e2126' },
  { value: 'system', label: '跟随系统', swatch: 'linear-gradient(135deg, #ffffff 50%, #1e2126 50%)' },
];

const WORKSPACE_OPTIONS: Array<{ value: WorkspaceMode; label: string }> = [
  { value: 'sidebar', label: '侧栏' },
  { value: 'tabs', label: '标签页' },
];

/** 诊断信息 → 可读文本（迁移自 SettingsModal.handleCopyDiagnostics） */
function buildDiagnosticsText(d: DiagnosticsInfo): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  return [
    `# Stellara Work 诊断信息`,
    `采集时间：${d.collectedAt}`,
    ``,
    `## 版本`,
    `- Stellara Work: v${d.version}`,
    `- Electron: ${d.electron}`,
    `- Chromium: ${d.chrome}`,
    `- Node.js: ${d.node}`,
    `- 平台: ${d.platform} ${d.arch}`,
    ``,
    `## 数据`,
    `- 数据目录: ${d.appDataPath}`,
    `- 日志文件: ${d.logPath}`,
    `- DB 大小: ${kb(d.dbSizeBytes)}`,
    `- 会话数: ${d.sessionCount} / 消息数: ${d.messageCount}`,
    `- 已配 model: ${d.modelCount}（已配 key: ${d.modelsWithKey.join(', ') || '无'}）`,
    `- 活跃 model: ${d.activeModelId ?? '无'}`,
    ``,
    `## main.log 最近 50 行`,
    '```',
    d.logTail,
    '```',
  ].join('\n');
}

/**
 * 设置窗口「应用」面板：界面（主题 / 工作区模式）、数据与日志、危险区（清空所有数据）。
 * 逻辑迁移自 SettingsModal 的 app 部分；清空后不 reload，改用 onChanged 同步。
 */
export function SettingsAppPanel({ onChanged, refreshKey = 0 }: SettingsAppPanelProps) {
  const [settings, setSettings] = useState<AppSettings>({});
  const [dataDir, setDataDir] = useState('');
  const [confirmClear, setConfirmClear] = useState('');
  const [copyingDiag, setCopyingDiag] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [st, info] = await Promise.all([
          window.electronAPI.settings.get(),
          window.electronAPI.app.getInfo(),
        ]);
        setSettings(st);
        setDataDir(info.appDataPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshKey]);

  function applyTheme(theme: ThemeName) {
    setSettings((s) => ({ ...s, theme }));
    void window.electronAPI.settings.update({ theme });
    onChanged?.();
  }

  function applyWorkspaceMode(mode: WorkspaceMode) {
    setSettings((s) => ({ ...s, workspaceMode: mode }));
    void window.electronAPI.settings.update({ workspaceMode: mode });
    onChanged?.();
  }

  async function handleCopyDiagnostics() {
    setCopyingDiag(true);
    try {
      const d: DiagnosticsInfo = await window.electronAPI.settings.collectDiagnostics();
      await navigator.clipboard.writeText(buildDiagnosticsText(d));
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingDiag(false);
    }
  }

  async function handleReset() {
    if (confirmClear !== 'DELETE') return;
    try {
      await window.electronAPI.settings.resetSelective('all');
      setConfirmClear('');
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const theme = settings.theme ?? 'dark';
  const workspaceMode = settings.workspaceMode ?? 'sidebar';

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>应用</h2>
          <div className="sub">界面、数据与日志</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section__title">界面</div>
        <div className="settings-group">
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">主题</div>
              <div className="settings-item__hint">跟随系统或手动指定</div>
            </div>
            <div className="radio-group">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`radio-card ${theme === opt.value ? 'on' : ''}`}
                  role="radio"
                  aria-checked={theme === opt.value}
                  aria-label={`主题：${opt.label}`}
                  onClick={() => applyTheme(opt.value)}
                  type="button"
                >
                  <span className="swatch" style={{ background: opt.swatch }} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">工作区模式</div>
              <div className="settings-item__hint">主界面右侧面板的呈现方式</div>
            </div>
            <div className="radio-group">
              {WORKSPACE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`radio-card ${workspaceMode === opt.value ? 'on' : ''}`}
                  role="radio"
                  aria-checked={workspaceMode === opt.value}
                  aria-label={`工作区模式：${opt.label}`}
                  onClick={() => applyWorkspaceMode(opt.value)}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">数据与日志</div>
        <div className="settings-group">
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">数据目录</div>
              <div className="settings-item__hint">{dataDir || '配置、密钥与数据库存放位置'}</div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void window.electronAPI.settings.openDataDir()}
              type="button"
            >
              打开
            </button>
          </div>
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">日志</div>
              <div className="settings-item__hint">主进程与渲染进程日志文件</div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void window.electronAPI.settings.openLogFile('main')}
              type="button"
            >
              查看
            </button>
          </div>
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">诊断信息</div>
              <div className="settings-item__hint">版本、系统与数据库状态</div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => void handleCopyDiagnostics()}
              disabled={copyingDiag}
              type="button"
              title="复制版本 / 系统 / DB / 日志尾巴到剪贴板，方便上报 bug"
            >
              {copyingDiag ? '采集中…' : diagCopied ? '已复制' : '复制'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section__title">危险区</div>
        <div className="settings-group settings-danger-zone">
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">清空所有数据</div>
              <div className="settings-item__hint">删除全部会话、记忆与配置，输入 DELETE 确认</div>
            </div>
            <input
              id="clear-all-confirm"
              className="settings-danger-input"
              type="text"
              placeholder="DELETE"
              value={confirmClear}
              onChange={(e) => setConfirmClear(e.target.value)}
            />
            <button
              className="btn btn-danger"
              disabled={confirmClear !== 'DELETE'}
              onClick={() => void handleReset()}
              type="button"
            >
              清空
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
