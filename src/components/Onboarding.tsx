import { useState, useEffect } from 'react';
import type { ModelPreset, ModelConfig, ConfiguredModel, PresetModelId } from '../../shared/ipc';

interface OnboardingProps {
  presets: ModelPreset[];
  /** 已有配置（用于"重新配置"模式：无 apiKey，仅 hasKey 提示已配） */
  initialConfig?: ConfiguredModel | null;
  /** 完成（配置成功传 ConfiguredModel）或跳过（传 null） */
  onComplete: (config: ConfiguredModel | null) => void;
}

/** Wizard: welcome → model pick → connection；三步均可跳过 */
export function Onboarding({ presets, initialConfig, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<'welcome' | 'pick' | 'connection'>(
    initialConfig ? 'connection' : 'welcome',
  );
  const [selectedId, setSelectedId] = useState<PresetModelId>(
    initialConfig?.id ?? 'deepseek-v4-pro',
  );
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl ?? '');
  const [model, setModel] = useState(initialConfig?.model ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'testing' | 'saving' | 'ok' | 'fail'>('idle');
  const [saveError, setSaveError] = useState('');

  // Seed baseUrl + model from selected preset (unless custom)
  useEffect(() => {
    const preset = presets.find((p) => p.id === selectedId);
    if (preset && !preset.isCustom) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }, [selectedId, presets]);

  /** 跳过：不校验 key，直接完成；重配置（已有配置）时跳过 = 保留原配置 */
  function handleSkip() {
    onComplete(initialConfig ?? null);
  }

  async function handleComplete() {
    // 渲染进程拿不到旧 key：initialConfig 只有 hasKey；留空 = 保留主进程中的旧 key
    const hasExistingKey = !!initialConfig?.hasKey;
    if (!apiKey && !hasExistingKey) {
      setSaveError('请输入 API 密钥');
      setSaveStatus('fail');
      return;
    }
    const preset = presets.find((p) => p.id === selectedId);
    if (!preset) return;
    const finalApiKey = apiKey || '';
    if (!finalApiKey && !hasExistingKey) {
      setSaveError('API 密钥为必填项');
      setSaveStatus('fail');
      return;
    }

    setSaveError('');
    // 提交载荷带 apiKey（只经 models.test/configure IPC 传主进程）
    const submitConfig: ModelConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: baseUrl || preset.baseUrl,
      model: model || preset.model,
      apiKey: finalApiKey,
      isCustom: preset.isCustom,
    };

    // Phase 1: 测试连接
    setSaveStatus('testing');
    const testResult = await window.electronAPI.models.test(submitConfig);
    if (!testResult.ok) {
      setSaveStatus('fail');
      setSaveError(testResult.error ?? '连接测试失败');
      return;
    }

    // Phase 2: 保存配置
    setSaveStatus('saving');
    const result = await window.electronAPI.models.configure(submitConfig);
    if (result.ok) {
      setSaveStatus('ok');
      // onComplete 传不含 apiKey 的视图（key 永远留在主进程）
      const view: ConfiguredModel = {
        id: submitConfig.id,
        label: submitConfig.label,
        baseUrl: submitConfig.baseUrl,
        model: submitConfig.model,
        isCustom: submitConfig.isCustom,
        hasKey: !!submitConfig.apiKey,
      };
      onComplete(view);
    } else {
      setSaveStatus('fail');
      setSaveError(result.error ?? '保存失败');
    }
  }

  return (
    <div className="onboarding">
      {step === 'welcome' ? (
        <WelcomePage onStart={() => setStep('pick')} onSkip={handleSkip} />
      ) : step === 'pick' ? (
        <PickPage
          presets={presets}
          selectedId={selectedId}
          onPick={setSelectedId}
          onNext={() => setStep('connection')}
          onSkip={handleSkip}
        />
      ) : (
        <ConnectionPage
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
          model={model}
          onModelChange={setModel}
          initialConfig={initialConfig}
          saveStatus={saveStatus}
          saveError={saveError}
          onComplete={handleComplete}
          onSkip={handleSkip}
          onBack={() => setStep('pick')}
        />
      )}
    </div>
  );
}

// ---- Page 0: Welcome ----

function WelcomePage({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="ob-page">
      <div className="ob-card">
        <div className="ob-brand">
          <div className="ob-logo" aria-hidden="true">S</div>
          <p className="ob-kicker">STELLARA WORK</p>
          <h1 className="ob-title">本地优先的 AI 任务工作台</h1>
          <p className="ob-sub">
            把任务交给 Agent，它会在你的本地工作区执行并记录结果。
          </p>
        </div>

        <div className="value-points">
          <div className="value-point">
            <span className="ic" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path d="M8 1.8 13 4v3.7c0 3-1.9 5.3-5 6.5-3.1-1.2-5-3.5-5-6.5V4l5-2.2Z" />
              </svg>
            </span>
            <div>
              <div className="t">数据本地</div>
              <div className="d">密钥、会话与配置只保存在本机，不上传任何数据。</div>
            </div>
          </div>
          <div className="value-point">
            <span className="ic" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path d="M3 8.5 8 3l5 5.5M4.5 7.5V13h7V7.5" />
              </svg>
            </span>
            <div>
              <div className="t">模型自由</div>
              <div className="d">支持 GLM·DeepSeek·Kimi·MiniMax 与任意 OpenAI 兼容模型。</div>
            </div>
          </div>
          <div className="value-point">
            <span className="ic" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <path d="M1.8 2.5h12.4v11H1.8zM4.5 6l2 2-2 2M8.5 10h3" />
              </svg>
            </span>
            <div>
              <div className="t">本地执行</div>
              <div className="d">Agent 直接在你的工作区读写文件、运行命令，全程可见可控。</div>
            </div>
          </div>
        </div>

        <div className="ob-actions center">
          <button className="btn btn-ghost" onClick={onSkip} type="button">
            先逛逛
          </button>
          <button className="btn btn-primary" onClick={onStart} type="button">
            开始配置
          </button>
        </div>
      </div>
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
}: {
  presets: ModelPreset[];
  selectedId: PresetModelId;
  onPick: (id: PresetModelId) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="ob-page">
      <div className="ob-card">
        <div className="ob-brand ob-brand--tight">
          <div className="ob-steps" aria-hidden="true">
            <span className="ob-step on" />
            <span className="ob-step" />
          </div>
          <p className="ob-kicker">第 1 步 / 共 2 步</p>
          <h1 className="ob-title">选择模型</h1>
          <p className="ob-sub">选择后可在设置中随时更换；也可以先跳过。</p>
        </div>

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
                {p.isCustom ? 'OpenAI 兼容' : '中文模型'}
              </span>
            </button>
          ))}
        </div>

        <div className="ob-actions">
          <button className="btn btn-ghost" onClick={onSkip} type="button">
            跳过
          </button>
          <button className="btn btn-primary" onClick={onNext} type="button">
            下一步
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Page 2: Connection details ----

function ConnectionPage({
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  initialConfig,
  saveStatus,
  saveError,
  onComplete,
  onSkip,
  onBack,
}: {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  initialConfig?: ConfiguredModel | null;
  saveStatus: string;
  saveError: string;
  onComplete: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const isReconfig = !!initialConfig;

  return (
    <div className="ob-page">
      <div className="ob-card">
        <button className="btn btn-ghost ob-back" onClick={onBack} type="button">
          返回
        </button>

        <div className="ob-brand ob-brand--tight">
          <div className="ob-steps" aria-hidden="true">
            <span className="ob-step on" />
            <span className="ob-step on" />
          </div>
          <p className="ob-kicker">第 2 步 / 共 2 步</p>
          <h1 className="ob-title">配置密钥</h1>
          <p className="ob-sub">密钥只保存在本机。也可以先跳过，稍后在设置中配置。</p>
        </div>

        {/* Base URL / Model */}
        <div className="field-row">
          <div className="field">
            <label htmlFor="ob-base-url">Base URL</label>
            <input
              id="ob-base-url"
              className="input"
              type="text"
              placeholder="任意 OpenAI 兼容端点"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ob-model">Model</label>
            <input
              id="ob-model"
              className="input"
              type="text"
              placeholder="模型名称（如 my-custom-model）"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
            />
          </div>
        </div>

        {/* API key */}
        <div className="field">
          <label htmlFor="ob-api-key">API 密钥</label>
          {isReconfig && initialConfig?.hasKey && (
            <p className="field-hint">
              当前配置: <code>{initialConfig?.id}</code>。已配置密钥，留空保持不变。
            </p>
          )}
          <input
            id="ob-api-key"
            className="input"
            type="password"
            placeholder={isReconfig ? '留空保留旧密钥' : 'sk-xxx 或提供商 API 密钥'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            autoComplete="off"
          />
          <span className="field-hint">密钥经加密后仅存本机，主进程之外不可见。</span>
        </div>

        {/* Status */}
        {saveStatus === 'testing' && (
          <div className="status-busy" role="status">正在测试连接…</div>
        )}
        {saveStatus === 'saving' && (
          <div className="status-busy" role="status">正在保存配置…</div>
        )}
        {saveStatus === 'ok' && (
          <div className="status-ok">连接成功 · 配置已保存</div>
        )}
        {saveStatus === 'fail' && (
          <div className="status-fail">
            {saveError}
            <div className="status-fail-hint">
              连接测试失败。请检查：API 密钥 / Base URL / 网络。
            </div>
          </div>
        )}

        <div className="ob-actions">
          <button className="btn btn-ghost" onClick={onSkip} type="button">
            跳过
          </button>
          <button
            className="btn btn-primary"
            onClick={onComplete}
            disabled={saveStatus === 'saving' || saveStatus === 'testing'}
            type="button"
          >
            {saveStatus === 'testing' ? '测试中…' : saveStatus === 'saving' ? '保存中…' : '完成配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
