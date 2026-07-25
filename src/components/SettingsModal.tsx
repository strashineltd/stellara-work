import { useEffect, useState } from 'react';
import type { ModelListItem, AppSettings, SessionSummary, ModelConfig } from '../../shared/ipc';

interface SettingsModalProps {
  onClose: () => void;
  /** 切换活跃 model 后通知父组件更新 */
  onModelChanged: (config: ModelConfig) => void;
}

type Tab = 'providers' | 'sessions' | 'app';

/**
 * 设置 Modal（3 tab：Providers / Sessions / App）
 * - Providers：列出 model、编辑 key、设活跃、删除
 * - Sessions：列出所有会话、删除、清空全部
 * - App：默认 workDir、数据目录、日志、清空所有数据（危险区）
 */
export function SettingsModal({ onClose, onModelChanged }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('providers');
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState('');
  const [confirmClear, setConfirmClear] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [m, s, st] = await Promise.all([
          window.electronAPI.models.getAll(),
          window.electronAPI.sessions.list(),
          window.electronAPI.settings.get(),
        ]);
        setModels(m);
        setSessions(s);
        setSettings(st);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

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
              {models.length === 0 && <p className="empty-hint">还没有 model。点 ⋯ → ⚙️ 重新配置加一个</p>}
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
