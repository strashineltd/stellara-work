import { useEffect, useState } from 'react';
import type { ModelPreset, ModelConfig, PresetModelId } from '../../shared/ipc';
import { ModelCard } from './ModelCard';

interface OnboardingProps {
  presets: ModelPreset[];
  /** 已有配置（用于"重新配置"模式：保留 workDir 和原 model 的 key，提示已配） */
  initialConfig?: ModelConfig | null;
  onComplete: (config: ModelConfig) => void;
}

/**
 * Onboarding 流程（单页布局，所有字段都在屏幕上）
 * 1. 选模型（5 个卡片）
 * 2. 填 API key + 可选改 base_url + model
 * 3. 选工作目录
 * 4. 测试连接 + 保存
 *
 * 接受 initialConfig → "重新配置"模式：
 * - 预填模型、workDir
 * - API key 显示一个 hint（"已配，跳过则保留"），用户留空就保留
 */
export function Onboarding({ presets, initialConfig, onComplete }: OnboardingProps) {
  const [selectedId, setSelectedId] = useState<PresetModelId>(initialConfig?.id ?? 'deepseek-v4-pro');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [workDir, setWorkDir] = useState<string>(initialConfig?.workDir ?? '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const isReconfig = !!initialConfig;

  // 选预设时，自动填 base_url + model（自定义不动）
  useEffect(() => {
    const preset = presets.find((p) => p.id === selectedId);
    if (preset && !preset.isCustom) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }, [selectedId, presets]);

  const isCustom = selectedId === 'custom';

  async function handlePickDir() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) setWorkDir(dir);
  }

  async function handleTest() {
    setTestStatus('testing');
    setTestError('');
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) {
      setTestStatus('fail');
      setTestError('请先选择模型');
      return;
    }
    const config: ModelConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: baseUrl || preset.baseUrl,
      model: model || preset.model,
      apiKey,
      isCustom: preset.isCustom,
    };
    const result = await window.electronAPI.models.test(config);
    if (result.ok) {
      setTestStatus('ok');
    } else {
      setTestStatus('fail');
      setTestError(result.error ?? '未知错误');
    }
  }

  async function handleComplete() {
    // 重新配置模式下，apiKey 留空就保留旧的
    if (!isReconfig && !apiKey) {
      setTestError('请填 API key');
      setTestStatus('fail');
      return;
    }
    if (!workDir) {
      setTestError('请选工作目录');
      setTestStatus('fail');
      return;
    }
    setSaving(true);
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) return;
    // 决定用哪个 apiKey
    const finalApiKey = apiKey || initialConfig?.apiKey || '';
    if (!finalApiKey) {
      setTestError('API key 为空（重新配置模式下必须填新的）');
      setTestStatus('fail');
      setSaving(false);
      return;
    }
    const config: ModelConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: baseUrl || preset.baseUrl,
      model: model || preset.model,
      apiKey: finalApiKey,
      isCustom: preset.isCustom,
      workDir,
    };
    const result = await window.electronAPI.models.configure(config);
    setSaving(false);
    if (result.ok) {
      onComplete(config);
    } else {
      setTestError(result.error ?? '保存失败');
      setTestStatus('fail');
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-header">
        <h1>Stellara Work</h1>
        <p className="tagline">
          {isReconfig ? '重新配置' : '数据本地的 Codex 风格桌面 Agent · 首次配置'}
        </p>
      </div>

      <div className="onboarding-body">
        <section className="onboarding-section">
          <h2>1. 选择模型</h2>
          <div className="model-grid">
            {presets.map((p) => (
              <ModelCard
                key={p.id}
                preset={p}
                selected={p.id === selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
          </div>
        </section>

        <section className="onboarding-section">
          <h2>2. API key</h2>
          {isReconfig && (
            <p className="field-hint">
              当前已配 <code>{initialConfig?.id}</code>。留空 = 保留旧 key。
            </p>
          )}
          <input
            className="input"
            type="password"
            placeholder={isReconfig ? '留空保留旧 key' : 'sk-xxx 或对应厂商的 API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          {isCustom ? (
            <div className="custom-fields">
              <input
                className="input"
                type="text"
                placeholder="Base URL（任意 OpenAI 兼容 endpoint）"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <input
                className="input"
                type="text"
                placeholder="Model 名（如 my-custom-model）"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          ) : (
            <div className="readonly-fields">
              <div className="readonly-field">
                <span className="label">Base URL</span>
                <code>{baseUrl || '（自动填入）'}</code>
              </div>
              <div className="readonly-field">
                <span className="label">Model</span>
                <code>{model || '（自动填入）'}</code>
              </div>
            </div>
          )}
        </section>

        <section className="onboarding-section">
          <h2>3. 工作目录</h2>
          <div className="dir-picker">
            <input
              className="input dir-input"
              type="text"
              placeholder="选个目录，agent 在这里读 / 写文件"
              value={workDir}
              readOnly
            />
            <button className="btn btn-secondary" onClick={handlePickDir} type="button">
              选择...
            </button>
          </div>
        </section>

        <section className="onboarding-section">
          {testStatus === 'ok' && (
            <div className="status-ok">✓ 连接测试通过</div>
          )}
          {testStatus === 'fail' && <div className="status-fail">✗ {testError}</div>}
        </section>
      </div>

      <div className="onboarding-footer">
        <button
          className="btn btn-secondary"
          onClick={handleTest}
          disabled={testStatus === 'testing' || !apiKey}
          type="button"
        >
          {testStatus === 'testing' ? '测试中...' : '测试连接'}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleComplete}
          disabled={saving || !apiKey || !workDir}
          type="button"
        >
          {saving ? '保存中...' : '完成配置'}
        </button>
      </div>
    </div>
  );
}
