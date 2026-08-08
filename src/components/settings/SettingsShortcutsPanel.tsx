import { useEffect, useState } from 'react';
import { DEFAULT_SHORTCUTS, SHORTCUT_DEFS, eventToBinding, formatBinding, type ShortcutAction, type ShortcutBindings } from '../../../shared/shortcuts';
import { Icon } from '../Icon';

interface SettingsShortcutsPanelProps {
  /** 设置变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

const TAB_ACTIONS = Array.from({ length: 9 }, (_, i) => `switchTab${i + 1}`) as ShortcutAction[];

const SHORTCUT_GROUPS: Array<{ title: string; actions: ShortcutAction[] }> = [
  { title: '导航', actions: ['toggleSidebar', 'toggleWorkspace', 'openCommandPalette'] },
  { title: '操作', actions: ['togglePlanMode', 'sendMessage', 'rejectApproval'] },
  { title: '标签页', actions: [...TAB_ACTIONS, 'closeActiveTab', 'reopenClosedTab'] },
];

function displayBinding(s: string): string {
  const shown = formatBinding(s);
  return document.documentElement.dataset.platform === 'darwin' ? shown.replace(/Ctrl/g, 'Cmd') : shown;
}

/**
 * 设置窗口「快捷键」面板：按 导航/操作/标签页 三组展示 SHORTCUT_DEFS，
 * 点击行进入录制（"按任意键…"），keydown 捕获 eventToBinding 后持久化；
 * 面板头部提供「重置全部」清空所有自定义绑定。逻辑迁移自 SettingsModal 的 shortcuts 部分。
 */
export function SettingsShortcutsPanel({ onChanged, refreshKey = 0 }: SettingsShortcutsPanelProps) {
  const [bindings, setBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI.settings
      .get()
      .then((st) => {
        if (st.shortcuts) setBindings({ ...DEFAULT_SHORTCUTS, ...st.shortcuts });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshKey]);

  function commit(next: ShortcutBindings) {
    setBindings(next);
    void window.electronAPI.settings
      .update({ shortcuts: next })
      .then(() => onChanged?.())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  // 录制模式：全局 keydown 监听下一次按键
  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setRecording(null);
        e.preventDefault();
        return;
      }
      const binding = eventToBinding(e);
      if (!binding || !recording) return;
      commit({ ...bindings, [recording]: binding });
      setRecording(null);
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recording, bindings, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleResetAll() {
    commit({});
  }

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>快捷键</h2>
          <div className="sub">点击按键组合可重新录制；按 Esc 取消录制</div>
        </div>
        <button className="btn btn-secondary" onClick={handleResetAll} type="button" title="恢复所有快捷键为默认值">
          重置全部
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      {SHORTCUT_GROUPS.map((group) => (
        <div className="settings-section" key={group.title}>
          <div className="settings-section__title">{group.title}</div>
          <div className="settings-group">
            {group.actions.map((action) => {
              const def = SHORTCUT_DEFS.find((d) => d.action === action);
              if (!def) return null;
              const current = bindings[action] ?? def.defaultBinding;
              const isRecording = recording === action;
              return (
                <div
                  key={action}
                  className={`settings-item settings-shortcut-row ${isRecording ? 'recording' : ''}`}
                  data-action={action}
                  role="button"
                  tabIndex={0}
                  aria-label={`${def.label}，点击录制`}
                  onClick={() => setRecording(isRecording ? null : action)}
                  onKeyDown={(e) => {
                    // 录制中按键统一走 window keydown 捕获路径（Enter/Space 也会被录成绑定），行内 handler 不参与
                    if (isRecording) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setRecording(action);
                    }
                  }}
                >
                  <div className="settings-item__grow">
                    <div className="settings-item__label">{def.label}</div>
                  </div>
                  <span className={`kbd ${isRecording ? 'rec' : ''}`}>
                    {isRecording ? '按任意键…' : displayBinding(current)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
