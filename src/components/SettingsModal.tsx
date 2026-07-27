import { useEffect, useState } from 'react';
import type {
  ModelListItem, AppSettings, SessionSummary, ModelConfig,
  ModelPreset, PresetModelId, DiagnosticsInfo, ThemeName, SkillDef,
} from '../../shared/ipc';
import { CONTEXT_WINDOW_OPTIONS, DEFAULT_CONTEXT_WINDOW } from '../../shared/context-window';
import {
  SHORTCUT_DEFS,
  DEFAULT_SHORTCUTS,
  eventToBinding,
  formatBinding,
  type ShortcutBindings,
  type ShortcutAction,
} from '../../shared/shortcuts';
import { ModelCard } from './ModelCard';

interface SettingsModalProps {
  onClose: () => void;
  /** 切换活跃 model 后通知父组件更新 */
  onModelChanged: (config: ModelConfig) => void;
  /** 用户改了快捷键 → 通知父组件 */
  onShortcutsChanged?: (shortcuts: ShortcutBindings) => void;
  /** 当前主题 */
  theme?: ThemeName;
  /** 用户改主题 → 通知父组件（同时持久化） */
  onThemeChanged?: (theme: ThemeName) => void;
  /** 当前工作目录（用于加载 skills） */
  workDir?: string;
  /** 打开时默认选中的 tab（默认 'providers'） */
  initialTab?: Tab;
}

export type Tab = 'providers' | 'sessions' | 'app' | 'shortcuts' | 'skills';

/**
 * 设置 Modal（4 tab：Providers / Sessions / App / Shortcuts）
 * - Providers：列出 model、添加、编辑 key、设活跃、删除
 * - Sessions：列出所有会话、删除、清空全部
 * - App：默认 workDir、数据目录、日志、清空所有数据（危险区）
 * - Shortcuts：用户自定义快捷键
 */
export function SettingsModal({ onClose, onModelChanged, onShortcutsChanged, theme, onThemeChanged, workDir, initialTab }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'providers');
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState('');
  const [confirmClear, setConfirmClear] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 快捷键：本地 state（用户点录制 / 重置才更新）
  const [shortcutBindings, setShortcutBindings] = useState<ShortcutBindings>(DEFAULT_SHORTCUTS);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  // 添加 model 的子表单
  const [showAdd, setShowAdd] = useState(false);
  const [addPresetId, setAddPresetId] = useState<PresetModelId>('deepseek-v4-pro');
  const [addApiKey, setAddApiKey] = useState('');
  const [addBaseUrl, setAddBaseUrl] = useState('');
  const [addModelName, setAddModelName] = useState('');
  const [addWorkDir, setAddWorkDir] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addTest, setAddTest] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

  // Skills（仅在 tab === 'skills' 时加载，避免每次打开设置都跑 fs）
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [skillsDir, setSkillsDir] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState<Set<string>>(new Set());

  async function loadSkillsForPanel() {
    if (!workDir) return;
    setSkillsLoading(true);
    try {
      const list = await window.electronAPI.skills.list(workDir);
      setSkills(list);
      setSkillsDir(`${workDir}/skills`);
    } catch (e) {
      console.error('Failed to load skills:', e);
    } finally {
      setSkillsLoading(false);
    }
  }

  async function openSkillsDir() {
    if (!workDir) return;
    try {
      await window.electronAPI.fs.openPath(workDir, `${workDir}/skills`);
    } catch (e) {
      console.error('openPath failed:', e);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [m, list, s, st] = await Promise.all([
          window.electronAPI.models.getAll(),
          window.electronAPI.models.list(),
          window.electronAPI.sessions.list(),
          window.electronAPI.settings.get(),
        ]);
        setModels(m);
        setPresets(list.presets);
        setSessions(s);
        setSettings(st);
        setAddWorkDir(st.workDirDefault ?? '');
        if (st.shortcuts) setShortcutBindings({ ...DEFAULT_SHORTCUTS, ...st.shortcuts });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // 切预设时，自动填 baseUrl + model（custom 不动）
  useEffect(() => {
    if (!showAdd) return;
    const p = presets.find((x) => x.id === addPresetId);
    if (p && !p.isCustom) {
      setAddBaseUrl(p.baseUrl);
      setAddModelName(p.model);
    }
  }, [addPresetId, presets, showAdd]);

  function resetAddForm() {
    setShowAdd(false);
    setAddPresetId('deepseek-v4-pro');
    setAddApiKey('');
    setAddBaseUrl('');
    setAddModelName('');
    setAddWorkDir(settings.workDirDefault ?? '');
    setAddBusy(false);
    setAddTest('idle');
    setAddError(null);
  }

  async function refreshModels() {
    setModels(await window.electronAPI.models.getAll());
  }

  async function handleSetActive(id: string) {
    try {
      await window.electronAPI.models.setActive(id);
      const list = await window.electronAPI.models.list();
      if (list.configured) onModelChanged(list.configured);
      await refreshModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(id: string) {
    if (!confirm(`删除 model「${id}」？已配的 key 也会从 .env 删除。`)) return;
    try {
      await window.electronAPI.models.remove(id);
      await refreshModels();
      const list = await window.electronAPI.models.list();
      if (list.configured) onModelChanged(list.configured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleUpdateKey(id: string) {
    try {
      await window.electronAPI.models.updateKey(id, editingKeyValue);
      setEditingKey(null);
      setEditingKeyValue('');
      await refreshModels();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleUpdateContextWindow(id: string, cw: number) {
    try {
      await window.electronAPI.models.updateContextWindow(id, cw);
      await refreshModels();
      // 如果是活跃 model，通知 App.tsx 更新
      const isActive = models.find((m) => m.id === id)?.isActive;
      if (isActive) {
        const list = await window.electronAPI.models.list();
        if (list.configured) onModelChanged(list.configured);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleUpdateWorkDir(id: string) {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (!dir) return;
    try {
      await window.electronAPI.models.updateWorkDir(id, dir);
      await refreshModels();
      // 如果是当前活跃 model，通知 App 同步
      const stillActive = (await window.electronAPI.models.getAll()).find((m) => m.id === id && m.isActive);
      if (stillActive) {
        const list = await window.electronAPI.models.list();
        if (list.configured) onModelChanged(list.configured);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePickAddWorkDir() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) setAddWorkDir(dir);
  }

  async function handleSaveAdd() {
    const p = presets.find((x) => x.id === addPresetId);
    if (!p) return;
    if (!addApiKey) { setAddError('请填 API key'); setAddTest('fail'); return; }
    if (!addWorkDir) { setAddError('请选工作目录'); setAddTest('fail'); return; }
    setAddBusy(true);
    setAddError(null);
    setAddTest('saving');
    const config: ModelConfig = {
      id: p.id,
      label: p.label,
      baseUrl: addBaseUrl || p.baseUrl,
      model: addModelName || p.model,
      apiKey: addApiKey,
      isCustom: p.isCustom,
      workDir: addWorkDir,
    };
    // 后端会自动先测连接再保存；测试不通过 → 不写入
    const r = await window.electronAPI.models.configure(config);
    setAddBusy(false);
    if (r.ok) {
      await refreshModels();
      resetAddForm();
    } else {
      setAddError(r.error ?? '保存失败');
      setAddTest('fail');
    }
  }

  async function handleDeleteSession(id: string) {
    if (!confirm('删除该会话？')) return;
    try {
      await window.electronAPI.sessions.delete(id);
      setSessions(await window.electronAPI.sessions.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleClearAll() {
    if (confirmClear !== 'DELETE') return;
    await window.electronAPI.settings.clearAllData();
    window.close();
  }

  // 诊断信息：版本 / 系统 / DB 状态 / 日志尾巴 → 拼成可读文本 → 复制到剪贴板
  const [copyingDiag, setCopyingDiag] = useState(false);
  const [diagCopied, setDiagCopied] = useState(false);
  async function handleCopyDiagnostics() {
    setCopyingDiag(true);
    try {
      const d: DiagnosticsInfo = await window.electronAPI.settings.collectDiagnostics();
      const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
      const text = [
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
      await navigator.clipboard.writeText(text);
      setDiagCopied(true);
      setTimeout(() => setDiagCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCopyingDiag(false);
    }
  }

  // 录制模式：全局 keydown 监听下一次按键
  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      // Esc 在录制时 = 取消录制（不绑）
      if (e.key === 'Escape') {
        setRecording(null);
        e.preventDefault();
        return;
      }
      const binding = eventToBinding(e);
      if (!binding || !recording) return;
      const action = recording as ShortcutAction;
      const next: ShortcutBindings = { ...shortcutBindings, [action]: binding };
      setShortcutBindings(next);
      setRecording(null);
      // 立即持久化
      void window.electronAPI.settings.update({ shortcuts: next })
        .then(() => onShortcutsChanged?.(next))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recording, shortcutBindings, onShortcutsChanged]);

  // 切到 skills tab 时懒加载（避免每次打开 settings 都跑 fs）
  useEffect(() => {
    if (tab === 'skills' && workDir && skills.length === 0 && !skillsLoading) {
      void loadSkillsForPanel();
    }
  }, [tab, workDir]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleResetShortcut(action: ShortcutAction) {
    const def = SHORTCUT_DEFS.find((d) => d.action === action);
    if (!def) return;
    const next: ShortcutBindings = { ...shortcutBindings };
    delete next[action];
    setShortcutBindings(next);
    void window.electronAPI.settings.update({ shortcuts: next })
      .then(() => onShortcutsChanged?.(next))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>设置</h3>
          <button className="btn-icon" onClick={onClose} type="button" title="关闭">×</button>
        </div>
        <div className="settings-tabs">
          <button className={tab === 'providers' ? 'active' : ''} onClick={() => setTab('providers')} type="button">Providers</button>
          <button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')} type="button">Sessions</button>
          <button className={tab === 'app' ? 'active' : ''} onClick={() => setTab('app')} type="button">App</button>
          <button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')} type="button">Skills</button>
          <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')} type="button">快捷键</button>
        </div>
        <div className="settings-body">
          {error && <div className="error-banner"><span className="error-icon">⚠</span><span className="error-text">{error}</span></div>}
          {tab === 'providers' && (
            <div className="providers-list">
              <div className="providers-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAdd((v) => !v)}
                  type="button"
                  aria-expanded={showAdd}
                >
                  {showAdd ? '▲ 收起' : '▼ 添加模型'}
                </button>
              </div>

              {showAdd && (
                <div className="add-model-form">
                  <div className="add-model-form-header">
                    <h4>添加新模型</h4>
                    <button
                      className="btn-icon btn-icon-small"
                      onClick={resetAddForm}
                      type="button"
                      title="收起"
                    >×</button>
                  </div>
                  <div className="model-grid">
                    {presets.map((p) => (
                      <ModelCard
                        key={p.id}
                        preset={p}
                        selected={p.id === addPresetId}
                        onSelect={() => setAddPresetId(p.id)}
                      />
                    ))}
                  </div>
                  <div className="settings-row">
                    <label>API key</label>
                    <input
                      type="password"
                      placeholder="sk-xxx 或对应厂商的 key"
                      value={addApiKey}
                      onChange={(e) => setAddApiKey(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {addPresetId === 'custom' ? (
                    <>
                      <div className="settings-row">
                        <label>Base URL</label>
                        <input
                          type="text"
                          placeholder="任意 OpenAI 兼容 endpoint"
                          value={addBaseUrl}
                          onChange={(e) => setAddBaseUrl(e.target.value)}
                        />
                      </div>
                      <div className="settings-row">
                        <label>Model</label>
                        <input
                          type="text"
                          placeholder="model 名（如 my-custom-model）"
                          value={addModelName}
                          onChange={(e) => setAddModelName(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="readonly-fields">
                      <div className="readonly-field">
                        <span className="label">Base URL</span>
                        <code>{addBaseUrl || '（自动）'}</code>
                      </div>
                      <div className="readonly-field">
                        <span className="label">Model</span>
                        <code>{addModelName || '（自动）'}</code>
                      </div>
                    </div>
                  )}
                  <div className="settings-row">
                    <label>工作目录</label>
                    <div className="dir-picker">
                      <input
                        type="text"
                        value={addWorkDir}
                        readOnly
                        placeholder="选个目录"
                      />
                      <button className="btn btn-secondary" onClick={() => void handlePickAddWorkDir()} type="button">选择…</button>
                    </div>
                  </div>
                  {addError && (
                    <div className="error-banner">
                      <span className="error-icon">⚠</span>
                      <div>
                        <div className="error-text">{addError}</div>
                        <div className="status-fail-hint">
                          连接测试未通过，配置未写入。请检查 API key / baseUrl / 网络。
                        </div>
                      </div>
                    </div>
                  )}
                  {addTest === 'saving' && (
                    <div className="status-busy">⏳ 正在测试连接并保存...</div>
                  )}
                  <div className="form-actions">
                    <button className="btn btn-primary" onClick={() => void handleSaveAdd()} disabled={addBusy || !addApiKey} type="button">
                      {addBusy ? '测试并保存中…' : '保存'}
                    </button>
                    <button className="btn btn-secondary" onClick={resetAddForm} type="button">取消</button>
                  </div>
                </div>
              )}

              {models.length === 0 && !showAdd && <p className="empty-hint">还没有 model。点上方「添加模型」按钮加一个</p>}
              {models.map((m) => (
                <div key={m.id} className="provider-card">
                  <div className="provider-info">
                    <div className="provider-name">{m.label} {m.isActive && <span className="badge">活跃</span>}</div>
                    <code className="provider-base">{m.baseUrl}</code>
                    <code className="provider-model">model: {m.model}</code>
                    {m.workDir && <code className="provider-workdir">workdir: {m.workDir}</code>}
                    <div className={`provider-key ${m.hasKey ? '' : 'missing'}`}>
                      {m.hasKey ? '✓ API key 已配' : '✗ 缺 key'}
                    </div>
                    <div className="provider-context-row">
                      <span className="provider-context-label">上下文窗口</span>
                      <select
                        className="provider-context-select"
                        value={m.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
                        onChange={(e) => void handleUpdateContextWindow(m.id, Number(e.target.value))}
                      >
                        {CONTEXT_WINDOW_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="provider-actions">
                    {editingKey === m.id ? (
                      <>
                        <input
                          type="password"
                          placeholder="新 API key"
                          value={editingKeyValue}
                          onChange={(e) => setEditingKeyValue(e.target.value)}
                          autoComplete="off"
                        />
                        <button className="btn btn-primary" onClick={() => void handleUpdateKey(m.id)} type="button">保存</button>
                        <button className="btn btn-secondary" onClick={() => { setEditingKey(null); setEditingKeyValue(''); }} type="button">取消</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-secondary" onClick={() => void handleUpdateWorkDir(m.id)} type="button" title={m.workDir ?? '未选'}>
                          📂 workdir
                        </button>
                        <button className="btn btn-secondary" onClick={() => setEditingKey(m.id)} type="button">改 key</button>
                        {!m.isActive && <button className="btn btn-primary" onClick={() => void handleSetActive(m.id)} type="button">设活跃</button>}
                        <button className="btn btn-danger" onClick={() => void handleRemove(m.id)} type="button">删除</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'sessions' && (
            <div className="sessions-table">
              {sessions.length === 0 && <p className="empty-hint">还没有会话</p>}
              {sessions.map((s) => (
                <div key={s.id} className="session-row">
                  <span className="session-row-title">{s.title}</span>
                  <span className="session-row-model">{s.modelId}</span>
                  <span className="session-row-count">{s.messageCount} 条</span>
                  <span className="session-row-time">{new Date(s.updatedAt).toLocaleString()}</span>
                  <button className="btn btn-secondary btn-small" onClick={() => void handleDeleteSession(s.id)} type="button">删除</button>
                </div>
              ))}
            </div>
          )}
          {tab === 'app' && (
            <div className="app-settings">
              <div className="settings-row">
                <label>工作区模式</label>
                <div className="settings-radio-group">
                  <label>
                    <input
                      type="radio"
                      name="workspaceMode"
                      value="sidebar"
                      checked={(settings.workspaceMode ?? 'sidebar') === 'sidebar'}
                      onChange={() => {
                        setSettings((s) => ({ ...s, workspaceMode: 'sidebar' }));
                        void window.electronAPI.settings.update({ workspaceMode: 'sidebar' });
                      }}
                    />
                    {' '}紧凑 sidebar
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="workspaceMode"
                      value="tabs"
                      checked={settings.workspaceMode === 'tabs'}
                      onChange={() => {
                        setSettings((s) => ({ ...s, workspaceMode: 'tabs' }));
                        void window.electronAPI.settings.update({ workspaceMode: 'tabs' });
                      }}
                    />
                    {' '}Tab 栏
                  </label>
                </div>
              </div>
              <div className="settings-row">
                <label>默认工作目录</label>
                <input
                  type="text"
                  value={settings.workDirDefault ?? ''}
                  placeholder="新 model 默认的 workDir（可空）"
                  onChange={(e) => {
                    const v = e.target.value;
                    setSettings((s) => ({ ...s, workDirDefault: v }));
                    void window.electronAPI.settings.update({ workDirDefault: v });
                  }}
                />
              </div>
              <div className="settings-row">
                <label>数据目录</label>
                <code className="data-dir-path">~/.stellara</code>
                <button className="btn btn-secondary" onClick={() => void window.electronAPI.settings.openDataDir()} type="button">
                  在资源管理器打开
                </button>
              </div>
              <div className="settings-row">
                <label>日志</label>
                <button className="btn btn-secondary" onClick={() => void window.electronAPI.settings.openLogFile('main')} type="button">
                  查看主日志
                </button>
              </div>
              <div className="settings-row">
                <label>主题</label>
                <select
                  className="input theme-select"
                  value={theme ?? 'dark'}
                  onChange={(e) => {
                    const next = e.target.value as ThemeName;
                    onThemeChanged?.(next);
                    void window.electronAPI.settings.update({ theme: next });
                  }}
                >
                  <option value="dark">深色</option>
                  <option value="light">浅色</option>
                  <option value="system">跟随系统</option>
                </select>
              </div>
              <div className="settings-row">
                <label>诊断</label>
                <button
                  className="btn btn-secondary"
                  onClick={() => void handleCopyDiagnostics()}
                  disabled={copyingDiag}
                  type="button"
                  title="复制版本 / 系统 / DB / 日志尾巴到剪贴板，方便上报 bug"
                >
                  {copyingDiag ? '采集中...' : diagCopied ? '✓ 已复制' : '📋 复制诊断信息'}
                </button>
              </div>
              <div className="danger-zone">
                <h4>危险区</h4>
                <p>清空所有数据（config.json + .env + stellara.db）后需重启 app。</p>
                <input
                  type="text"
                  placeholder='输入 "DELETE" 确认'
                  value={confirmClear}
                  onChange={(e) => setConfirmClear(e.target.value)}
                />
                <button
                  className="btn btn-danger"
                  disabled={confirmClear !== 'DELETE'}
                  onClick={() => void handleClearAll()}
                  type="button"
                >
                  清空所有数据
                </button>
              </div>
            </div>
          )}
          {tab === 'shortcuts' && (
            <div className="shortcuts-list">
              <p className="empty-hint" style={{ textAlign: 'left' }}>
                点击「录制」后按任意组合键；按 Esc 取消录制。
              </p>
              {SHORTCUT_DEFS.map((def) => {
                const current = shortcutBindings[def.action] ?? def.defaultBinding;
                const isRecording = recording === def.action;
                return (
                  <div key={def.action} className="shortcut-row">
                    <span className="shortcut-label">{def.label}</span>
                    <code className={`shortcut-keys ${isRecording ? 'recording' : ''}`}>
                      {isRecording ? '按下任意键…' : formatBinding(current)}
                    </code>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => setRecording(def.action)}
                      type="button"
                    >
                      {isRecording ? '录制中…' : '录制'}
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => handleResetShortcut(def.action)}
                      disabled={current === def.defaultBinding}
                      type="button"
                      title={`恢复默认：${formatBinding(def.defaultBinding)}`}
                    >
                      重置
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'skills' && (
            <div className="skills-panel">
              {!workDir && (
                <div className="empty-hint">
                  未设置工作目录。设置工作目录后，<code>{'<workDir>/skills/*.json'}</code> 下的所有 skill 文件会被自动加载。
                </div>
              )}
              {workDir && (
                <>
                  <div className="skills-header">
                    <div className="skills-header-info">
                      <code className="skills-path">{skillsDir ?? `${workDir}/skills`}</code>
                      <span className="hint">
                        {skillsLoading ? '加载中…' : `${skills.length} 个 skill`}
                      </span>
                    </div>
                    <div className="skills-header-actions">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => void loadSkillsForPanel()}
                        disabled={skillsLoading}
                        type="button"
                        title="从磁盘重新读取所有 skill JSON 文件"
                      >
                        ↻ 重新加载
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => void openSkillsDir()}
                        type="button"
                        title="在文件管理器打开 skills 目录"
                      >
                        📂 打开目录
                      </button>
                    </div>
                  </div>

                  {skills.length === 0 && !skillsLoading && (
                    <div className="empty-hint">
                      当前 workDir 下没有 skill 文件。在 <code>{workDir}/skills/</code> 里创建 <code>name.json</code>，必须含 <code>name</code> / <code>description</code> / <code>prompt</code> 字段。
                    </div>
                  )}

                  <ul className="skills-list">
                    {skills.map((s) => {
                      const isOpen = skillsExpanded.has(s.name);
                      return (
                        <li key={s.name} className="skill-card">
                          <div className="skill-card-header">
                            <div className="skill-card-title">
                              <span className="skill-card-icon">🎯</span>
                              <span className="skill-card-name">/{s.name}</span>
                            </div>
                            <button
                              className="btn-icon btn-icon-small"
                              onClick={() => {
                                setSkillsExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s.name)) next.delete(s.name);
                                  else next.add(s.name);
                                  return next;
                                });
                              }}
                              title={isOpen ? '收起 prompt' : '展开 prompt'}
                              type="button"
                            >
                              {isOpen ? '▾' : '▸'}
                            </button>
                          </div>
                          <div className="skill-card-desc">{s.description}</div>
                          {isOpen && (
                            <pre className="skill-card-prompt">{s.prompt}</pre>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <p className="hint" style={{ marginTop: 12 }}>
                    在聊天框输入 <code>/skill-name</code> 调用 skill（sl 自动补全）。
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
