import { useEffect, useState } from 'react';
import type { ModelPreset, ModelConfig, PresetModelId } from '../../shared/ipc';
import { ModelCard } from './ModelCard';

interface OnboardingProps {
  presets: ModelPreset[];
  onComplete: (config: ModelConfig) => void;
}

/**
 * Onboarding 流程（单页布局，所有字段都在屏幕上）
 * 1. 选模型（5 个卡片）
 * 2. 填 API key + 可选改 base_url + model
 * 3. 选工作目录
 * 4. 测试连接 + 保存
 */
export function Onboarding({ presets, onComplete }: OnboardingProps) {
  const [selectedId, setSelectedId] = useState<PresetModelId>('deepseek-v4-pro');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [workDir, setWorkDir] = useState<string>('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState<string>('');
  const [saving, setSaving] = useState(false);

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
    if (!apiKey) {
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
    const config: ModelConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: baseUrl || preset.baseUrl,
      model: model || preset.model,
      apiKey,
      isCustom: preset.isCustom,
      workDir,
    } as ModelConfig & { workDir: string };
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
        <p className="tagline">数据本地的 Codex 风格桌面 Agent · 首次配置</p>
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
          <input
            className="input"
            type="password"
            placeholder="sk-xxx 或对应厂商的 API key"
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
