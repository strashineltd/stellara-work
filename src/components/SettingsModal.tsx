import { useEffect, useState } from 'react';
import type {
  ModelListItem, AppSettings, SessionSummary, ModelConfig,
  ModelPreset, PresetModelId,
} from '../../shared/ipc';
import { ModelCard } from './ModelCard';

interface SettingsModalProps {
  onClose: () => void;
  /** 切换活跃 model 后通知父组件更新 */
  onModelChanged: (config: ModelConfig) => void;
}

type Tab = 'providers' | 'sessions' | 'app';

/**
 * 设置 Modal（3 tab：Providers / Sessions / App）
 * - Providers：列出 model、添加、编辑 key、设活跃、删除
 * - Sessions：列出所有会话、删除、清空全部
 * - App：默认 workDir、数据目录、日志、清空所有数据（危险区）
 */
export function SettingsModal({ onClose, onModelChanged }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('providers');
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState('');
  const [confirmClear, setConfirmClear] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 添加 model 的子表单
  const [showAdd, setShowAdd] = useState(false);
  const [addPresetId, setAddPresetId] = useState<PresetModelId>('deepseek-v4-pro');
  const [addApiKey, setAddApiKey] = useState('');
  const [addBaseUrl, setAddBaseUrl] = useState('');
  const [addModelName, setAddModelName] = useState('');
  const [addWorkDir, setAddWorkDir] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addTest, setAddTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

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

  async function handleTestAdd() {
    const p = presets.find((x) => x.id === addPresetId);
    if (!p) return;
    setAddTest('testing');
    setAddError(null);
    const config: ModelConfig = {
      id: p.id,
      label: p.label,
      baseUrl: addBaseUrl || p.baseUrl,
      model: addModelName || p.model,
      apiKey: addApiKey,
      isCustom: p.isCustom,
    };
    const r = await window.electronAPI.models.test(config);
    if (r.ok) setAddTest('ok');
    else { setAddTest('fail'); setAddError(r.error ?? '未知错误'); }
  }

  async function handleSaveAdd() {
    const p = presets.find((x) => x.id === addPresetId);
    if (!p) return;
    if (!addApiKey) { setAddError('请填 API key'); setAddTest('fail'); return; }
    if (!addWorkDir) { setAddError('请选工作目录'); setAddTest('fail'); return; }
    setAddBusy(true);
    setAddError(null);
    const config: ModelConfig = {
      id: p.id,
      label: p.label,
      baseUrl: addBaseUrl || p.baseUrl,
      model: addModelName || p.model,
      apiKey: addApiKey,
      isCustom: p.isCustom,
      workDir: addWorkDir,
    };
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
        </div>
        <div className="settings-body">
          {error && <div className="error-banner"><span className="error-icon">⚠</span><span className="error-text">{error}</span></div>}
          {tab === 'providers' && (
            <div className="providers-list">
              <div className="providers-actions">
                {!showAdd && (
                  <button className="btn btn-primary" onClick={() => setShowAdd(true)} type="button">
                    ➕ 添加模型
                  </button>
                )}
              </div>

              {showAdd && (
                <div className="add-model-form">
                  <h4>添加新模型</h4>
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
                  {addError && <div className="error-banner"><span className="error-icon">⚠</span><span className="error-text">{addError}</span></div>}
                  {addTest === 'ok' && <div className="status-ok">✓ 连接测试通过</div>}
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => void handleTestAdd()} disabled={addBusy || addTest === 'testing' || !addApiKey} type="button">
                      {addTest === 'testing' ? '测试中…' : '测试连接'}
                    </button>
                    <button className="btn btn-primary" onClick={() => void handleSaveAdd()} disabled={addBusy || !addApiKey} type="button">
                      {addBusy ? '保存中…' : '保存'}
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
                <span className="hint">v0.9 暂未启用</span>
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
        </div>
      </div>
    </div>
  );
}
