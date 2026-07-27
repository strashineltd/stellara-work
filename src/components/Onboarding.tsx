import { useState, useEffect } from 'react';
import type { ModelPreset, ModelConfig, PresetModelId } from '../../shared/ipc';

interface OnboardingProps {
  presets: ModelPreset[];
  /** 已有配置（用于"重新配置"模式：保留 workDir 和原 model 的 key，提示已配） */
  initialConfig?: ModelConfig | null;
  onComplete: (config: ModelConfig) => void;
}

/** Two-page wizard: page 1 = model pick, page 2 = workdir pick */
export function Onboarding({ presets, initialConfig, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<'pick' | 'workdir'>(
    initialConfig ? 'workdir' : 'pick',
  );
  const [selectedId, setSelectedId] = useState<PresetModelId>(
    initialConfig?.id ?? 'deepseek-v4-pro',
  );
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl ?? '');
  const [model, setModel] = useState(initialConfig?.model ?? '');
  const [workDir, setWorkDir] = useState<string>(initialConfig?.workDir ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'fail'>('idle');
  const [saveError, setSaveError] = useState('');

  // Seed baseUrl + model from selected preset (unless custom)
  useEffect(() => {
    const preset = presets.find((p) => p.id === selectedId);
    if (preset && !preset.isCustom) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }, [selectedId, presets]);

  async function handlePickDir() {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (dir) setWorkDir(dir);
  }

  async function handleComplete() {
    if (!apiKey && !initialConfig?.apiKey) {
      setSaveError('Please enter an API key');
      setSaveStatus('fail');
      return;
    }
    if (!workDir) {
      setSaveError('Please select a working directory');
      setSaveStatus('fail');
      return;
    }
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) return;
    const finalApiKey = apiKey || initialConfig?.apiKey || '';
    if (!finalApiKey) {
      setSaveError('API key is required');
      setSaveStatus('fail');
      return;
    }

    setSaveStatus('saving');
    setSaveError('');
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
    if (result.ok) {
      setSaveStatus('ok');
      onComplete(config);
    } else {
      setSaveStatus('fail');
      setSaveError(result.error ?? 'Save failed');
    }
  }

  const isCustom = selectedId === 'custom';

  return (
    <div className="onboarding">
      {step === 'pick' ? (
        <PickPage
          presets={presets}
          selectedId={selectedId}
          onPick={setSelectedId}
          onNext={() => setStep('workdir')}
          onSkip={() => setStep('workdir')}
          activeStep={1}
        />
      ) : (
        <WorkdirPage
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
          model={model}
          onModelChange={setModel}
          workDir={workDir}
          isCustom={isCustom}
          initialConfig={initialConfig}
          saveStatus={saveStatus}
          saveError={saveError}
          onPickDir={handlePickDir}
          onComplete={handleComplete}
          onBack={() => setStep('pick')}
          activeStep={2}
        />
      )}
    </div>
  );
}

// ---- Progress indicator ----

function StepPills({ active }: { active: number }) {
  return (
    <div className="step-pills">
      <span
        data-step-pill="1"
        className={`step-pill ${active === 1 ? 'active' : ''}`}
      >
        Step 1
      </span>
      <span
        data-step-pill="2"
        className={`step-pill ${active === 2 ? 'active' : ''}`}
      >
        Step 2
      </span>
    </div>
  );
}

// ---- Page 1: Model Pick ----

function PickPage({
  presets,
  selectedId,
  onPick,
  onNext,
  onSkip,
  activeStep,
}: {
  presets: ModelPreset[];
  selectedId: PresetModelId;
  onPick: (id: PresetModelId) => void;
  onNext: () => void;
  onSkip: () => void;
  activeStep: number;
}) {
  return (
    <div className="onboarding-page">
      <StepPills active={activeStep} />

      <div className="onboarding-body">
        <h1 className="onboarding-title">Select a model</h1>
        <p className="onboarding-subtitle">Pick a provider to get started</p>

        <div className="model-grid">
          {presets.map((p) => (
            <button
              key={p.id}
              data-model-id={p.id}
              className={`model-card ${p.id === selectedId ? 'selected' : ''}`}
              onClick={() => onPick(p.id)}
              type="button"
            >
              <span className="model-card-name">
                {p.label}
              </span>
              <span className="model-card-base">
                {p.isCustom ? 'OpenAI compatible' : 'zh-CN'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-secondary" onClick={onSkip} type="button">
          Skip
        </button>
        <button className="btn btn-primary" onClick={onNext} type="button">
          Next
        </button>
      </div>
    </div>
  );
}

// ---- Page 2: Workdir ----

function WorkdirPage({
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  workDir,
  isCustom,
  initialConfig,
  saveStatus,
  saveError,
  onPickDir,
  onComplete,
  onBack,
  activeStep,
}: {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  workDir: string;
  isCustom: boolean;
  initialConfig?: ModelConfig | null;
  saveStatus: string;
  saveError: string;
  onPickDir: () => void;
  onComplete: () => void;
  onBack: () => void;
  activeStep: number;
}) {
  const isReconfig = !!initialConfig;

  return (
    <div className="onboarding-page">
      <StepPills active={activeStep} />

      <div className="onboarding-body">
        <button className="btn btn-ghost onboarding-back" onClick={onBack} type="button">
          Back
        </button>

        <h1 className="onboarding-title">Configure workspace</h1>
        <p className="onboarding-subtitle">Set your API key and working directory</p>

        {/* Work directory */}
        <div className="onboarding-field">
          <label className="onboarding-label">Working directory</label>
          <div className="dir-picker">
            <input
              className="input dir-input"
              type="text"
              placeholder="Choose a folder for the agent"
              value={workDir}
              readOnly
            />
            <button className="btn btn-secondary" onClick={onPickDir} type="button">
              Browse...
            </button>
          </div>
        </div>

        {/* API key */}
        <div className="onboarding-field">
          <label className="onboarding-label">API key</label>
          {isReconfig && (
            <p className="field-hint">
              Currently configured: <code>{initialConfig?.id}</code>. Leave blank to keep the old key.
            </p>
          )}
          <input
            className="input"
            type="password"
            placeholder={isReconfig ? 'Leave blank to keep old key' : 'sk-xxx or provider API key'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Custom model fields */}
        {isCustom && (
          <div className="onboarding-field">
            <label className="onboarding-label">Custom endpoint</label>
            <input
              className="input"
              type="text"
              placeholder="Base URL (any OpenAI-compatible endpoint)"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
            />
            <input
              className="input"
              type="text"
              placeholder="Model name (e.g. my-custom-model)"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              style={{ marginTop: 8 }}
            />
          </div>
        )}

        {/* Status */}
        {saveStatus === 'saving' && (
          <div className="status-busy">Testing connection and saving...</div>
        )}
        {saveStatus === 'ok' && (
          <div className="status-ok">Configuration saved</div>
        )}
        {saveStatus === 'fail' && (
          <div className="status-fail">
            {saveError}
            <div className="status-fail-hint">
              Connection test failed. Check: API key / base URL / network.
            </div>
          </div>
        )}
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-secondary" onClick={onComplete} type="button">
          Skip
        </button>
        <button
          className="btn btn-primary"
          onClick={onComplete}
          disabled={saveStatus === 'saving'}
          type="button"
        >
          {saveStatus === 'saving' ? 'Saving...' : 'Complete'}
        </button>
      </div>
    </div>
  );
}
