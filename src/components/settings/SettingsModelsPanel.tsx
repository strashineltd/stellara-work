import { useEffect, useState } from 'react';
import type { ModelConfig, ModelListItem, ModelPreset, PresetModelId } from '../../../shared/ipc';
import { DEFAULT_CONTEXT_WINDOW } from '../../../shared/context-window';
import { Icon } from '../Icon';
import { ModelCard } from '../ModelCard';

interface SettingsModelsPanelProps {
  /** 任何模型变更成功后回调（SettingsWindow 用于跨窗口同步） */
  onChanged: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

const DEFAULT_PRESET_ID: PresetModelId = 'deepseek-v4-pro';

function formatContextWindow(cw: number | undefined): string {
  const value = cw ?? DEFAULT_CONTEXT_WINDOW;
  return value >= 1_000_000 ? '1M' : `${Math.round(value / 1000)}K`;
}

/**
 * 设置窗口「模型」面板：活跃模型切换、模型列表（key 编辑 / 删除）、
 * 添加模型（预设 + 自定义）与危险区删除。逻辑迁移自 SettingsModal 的 providers 部分。
 */
export function SettingsModelsPanel({ onChanged, refreshKey = 0 }: SettingsModelsPanelProps) {
  const [models, setModels] = useState<ModelListItem[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showSwitch, setShowSwitch] = useState(false);

  // 行内编辑 key
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState('');

  // 添加模型子表单
  const [showAdd, setShowAdd] = useState(false);
  const [addPresetId, setAddPresetId] = useState<PresetModelId>(DEFAULT_PRESET_ID);
  const [addApiKey, setAddApiKey] = useState('');
  const [addBaseUrl, setAddBaseUrl] = useState('');
  const [addModelName, setAddModelName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addTest, setAddTest] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [m, list] = await Promise.all([
          window.electronAPI.models.getAll(),
          window.electronAPI.models.list(),
        ]);
        setModels(m);
        setPresets(list.presets);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refreshKey]);

  // 切预设时自动填 baseUrl + model（custom 保持手填）
  useEffect(() => {
    if (!showAdd) return;
    const p = presets.find((x) => x.id === addPresetId);
    if (p && !p.isCustom) {
      setAddBaseUrl(p.baseUrl);
      setAddModelName(p.model);
    }
  }, [addPresetId, presets, showAdd]);

  async function refreshModels() {
    setModels(await window.electronAPI.models.getAll());
  }

  async function handleSetActive(id: string) {
    try {
      await window.electronAPI.models.setActive(id);
      await refreshModels();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(id: string) {
    const label = models.find((m) => m.id === id)?.label ?? id;
    if (!confirm(`删除 model「${label}」？已配的 key 也会从 .env 删除。`)) return;
    try {
      await window.electronAPI.models.remove(id);
      await refreshModels();
      onChanged();
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
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function resetAddForm() {
    setShowAdd(false);
    setAddPresetId(DEFAULT_PRESET_ID);
    setAddApiKey('');
    setAddBaseUrl('');
    setAddModelName('');
    setAddBusy(false);
    setAddTest('idle');
    setAddError(null);
  }

  async function handleSaveAdd() {
    const p = presets.find((x) => x.id === addPresetId);
    if (!p) return;
    if (!addApiKey) {
      setAddError('请填 API key');
      setAddTest('fail');
      return;
    }
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
    };
    // 后端会自动先测连接再保存；测试不通过 → 不写入
    const r = await window.electronAPI.models.configure(config);
    setAddBusy(false);
    if (r.ok) {
      await refreshModels();
      resetAddForm();
      onChanged();
    } else {
      setAddError(r.error ?? '保存失败');
      setAddTest('fail');
    }
  }

  const active = models.find((m) => m.isActive);

  return (
    <div className="settings-panel">
      <div className="settings-panel-head">
        <div>
          <h2>模型</h2>
          <div className="sub">管理 API 提供商与模型连接</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section__title">活跃模型</div>
        <div className="active-model">
          <div className="active-model__logo" aria-hidden="true">{active ? active.label.slice(0, 2) : '—'}</div>
          <div className="settings-row__grow">
            <div className="active-model__name">{active?.label ?? '未设置'}</div>
            <div className="active-model__meta">
              {active
                ? `${active.baseUrl} · ${formatContextWindow(active.contextWindow)} 上下文 · key ${active.hasKey ? '已配置' : '未配置'}`
                : '在下方列表中添加并设为活跃'}
            </div>
          </div>
          {models.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowSwitch((v) => !v)}
              aria-expanded={showSwitch}
              type="button"
            >
              {showSwitch ? '收起' : '切换'}
            </button>
          )}
        </div>
        {showSwitch && (
          <div className="switch-list">
            {models.map((m) => (
              <button
                key={m.id}
                className="switch-row"
                role="radio"
                aria-checked={m.isActive}
                onClick={() => {
                  setShowSwitch(false);
                  void handleSetActive(m.id);
                }}
                type="button"
              >
                <span className="active-model__logo" aria-hidden="true">{m.label.slice(0, 2)}</span>
                <span className="settings-row__grow">
                  <span className="nm">{m.label}</span>
                  <span className="hint">{m.baseUrl} · key {m.hasKey ? '已配置' : '未配置'}</span>
                </span>
                {m.isActive && <span className="badge badge--active">活跃</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section__title">模型列表 <span className="count">{models.length}</span></div>
        <div className="settings-group">
          {models.length === 0 && <p className="empty-hint">还没有 model。点下方「添加模型」按钮加一个</p>}
          {models.map((m) => (
            <div key={m.id} className="settings-row provider-row">
              <div className="settings-row__grow">
                <div className="settings-row__top">
                  <span className="settings-row__title">{m.label}</span>
                  {m.isActive && <span className="badge badge--active">活跃</span>}
                  <span className={`badge ${m.hasKey ? 'badge--ok' : 'badge--warn'}`}>
                    {m.hasKey ? '已连接' : '无 Key'}
                  </span>
                </div>
                <div className="settings-row__base">
                  {m.baseUrl} · model: {m.model} · {formatContextWindow(m.contextWindow)}
                </div>
              </div>
              <div className="settings-row__ops">
                {editingKey === m.id ? (
                  <>
                    <input
                      type="password"
                      placeholder="新 API key"
                      aria-label={`更新 ${m.label} 的 API key`}
                      value={editingKeyValue}
                      onChange={(e) => setEditingKeyValue(e.target.value)}
                      autoComplete="off"
                    />
                    <button className="btn btn-primary" onClick={() => void handleUpdateKey(m.id)} type="button">保存</button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => { setEditingKey(null); setEditingKeyValue(''); }}
                      type="button"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="icon-btn"
                      title="编辑 Key"
                      aria-label={`编辑 ${m.label} 的 API key`}
                      onClick={() => { setEditingKey(m.id); setEditingKeyValue(''); }}
                      type="button"
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="删除"
                      aria-label={`删除 ${m.label}`}
                      onClick={() => void handleRemove(m.id)}
                      type="button"
                    >
                      <Icon name="x" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="add-model-trigger">
          <button
            className="btn btn-primary"
            onClick={() => setShowAdd((v) => !v)}
            aria-expanded={showAdd}
            type="button"
          >
            <Icon name={showAdd ? 'chevron-down' : 'plus'} size={13} />
            <span>{showAdd ? '收起' : '添加模型'}</span>
          </button>
        </div>
        {showAdd && (
          <div className="add-model-form">
            <div className="form-row">
              <label>选择预设</label>
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
            </div>
            {addPresetId === 'custom' ? (
              <>
                <div className="form-row">
                  <label htmlFor="add-model-base-url">Base URL</label>
                  <input
                    id="add-model-base-url"
                    type="text"
                    placeholder="任意 OpenAI 兼容 endpoint"
                    value={addBaseUrl}
                    onChange={(e) => setAddBaseUrl(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="add-model-name">Model</label>
                  <input
                    id="add-model-name"
                    type="text"
                    placeholder="model 名（如 my-custom-model）"
                    value={addModelName}
                    onChange={(e) => setAddModelName(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="form-row">
                <label>Base URL / Model</label>
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
              </div>
            )}
            <div className="form-row">
              <label htmlFor="add-model-api-key">API key</label>
              <input
                id="add-model-api-key"
                type="password"
                placeholder="sk-xxx 或对应厂商的 key"
                value={addApiKey}
                onChange={(e) => setAddApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            {addTest === 'saving' && (
              <div className="status-busy" role="status">正在测试连接并保存…</div>
            )}
            {addError && (
              <div className="error-banner" role="alert">
                <span className="error-icon"><Icon name="alert" size={17} /></span>
                <div>
                  <div className="error-text">{addError}</div>
                  <div className="status-fail-hint">
                    连接测试未通过，配置未写入。请检查 API key / baseUrl / 网络。
                  </div>
                </div>
              </div>
            )}
            <div className="add-model-actions">
              <button className="btn btn-primary" onClick={() => void handleSaveAdd()} disabled={addBusy || !addApiKey} type="button">
                {addBusy ? '测试并保存中…' : '保存'}
              </button>
              <button className="btn btn-secondary" onClick={resetAddForm} type="button">取消</button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section__title">危险区</div>
        <div className="settings-group danger-zone">
          {models.map((m) => (
            <div key={m.id} className="settings-row">
              <div className="settings-row__grow">
                <div className="settings-row__label">{m.label}</div>
                <div className="settings-row__hint">同时从 .env 移除对应 API key</div>
              </div>
              <button className="btn btn-danger" onClick={() => void handleRemove(m.id)} type="button">删除</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
