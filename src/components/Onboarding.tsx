import { useState, useEffect } from 'react';
import type { ModelPreset, ModelConfig, ConfiguredModel, PresetModelId, ProjectSummary } from '../../shared/ipc';
import { Icon } from './Icon';

interface OnboardingProps {
  presets: ModelPreset[];
  /** 已有配置（用于"重新配置"模式：无 apiKey，仅 hasKey 提示已配） */
  initialConfig?: ConfiguredModel | null;
  /** 已有项目列表（环境初始化步骤选择工作目录用） */
  projects?: ProjectSummary[];
  onComplete: (config: ConfiguredModel, projectId?: string) => void;
}

/** Wizard: welcome → model pick → connection details → environment init */
export function Onboarding({ presets, initialConfig, projects, onComplete }: OnboardingProps) {
  const [step, setStep] = useState<'welcome' | 'pick' | 'workdir' | 'env'>(
    initialConfig ? 'workdir' : 'welcome',
  );
  const [selectedId, setSelectedId] = useState<PresetModelId>(
    initialConfig?.id ?? 'deepseek-v4-pro',
  );
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl ?? '');
  const [model, setModel] = useState(initialConfig?.model ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'testing' | 'saving' | 'ok' | 'fail'>('idle');
  const [saveError, setSaveError] = useState('');
  const [savedConfig, setSavedConfig] = useState<ConfiguredModel | null>(null);
  const [envProjectId, setEnvProjectId] = useState<string | null>(null);

  // Seed baseUrl + model from selected preset (unless custom)
  useEffect(() => {
    const preset = presets.find((p) => p.id === selectedId);
    if (preset && !preset.isCustom) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }, [selectedId, presets]);

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
      if (initialConfig) {
        // 重新配置：跳过环境初始化，直接完成
        onComplete(view);
      } else {
        // 首次配置：进入环境初始化（选择工作目录）
        setSavedConfig(view);
        setStep('env');
      }
    } else {
      setSaveStatus('fail');
      setSaveError(result.error ?? '保存失败');
    }
  }

  const isCustom = selectedId === 'custom';

  return (
    <div className="onboarding">
      {step === 'welcome' ? (
        <WelcomePage onStart={() => setStep('pick')} />
      ) : step === 'pick' ? (
        <PickPage
          presets={presets}
          selectedId={selectedId}
          onPick={setSelectedId}
          onNext={() => setStep('workdir')}
          onSkip={() => setStep('workdir')}
        />
      ) : step === 'env' && savedConfig ? (
        <EnvPage
          projects={projects ?? []}
          selectedId={envProjectId}
          onSelect={setEnvProjectId}
          onComplete={() => onComplete(savedConfig, envProjectId ?? undefined)}
          onSkip={() => onComplete(savedConfig)}
        />
      ) : (
        <ConnectionPage
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          baseUrl={baseUrl}
          onBaseUrlChange={setBaseUrl}
          model={model}
          onModelChange={setModel}
          isCustom={isCustom}
          initialConfig={initialConfig}
          saveStatus={saveStatus}
          saveError={saveError}
          onComplete={handleComplete}
          onBack={() => setStep('pick')}
        />
      )}
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
    <div className="onboarding-page">
      <div className="onboarding-body onboarding-body--centered">
        <div className="onboarding-brand">
          <p className="onboarding-brand-kicker">Stellara Work</p>
          <h1 className="onboarding-brand-title">建立你的工作环境</h1>
          <p className="onboarding-brand-subtitle">先选择模型连接，之后可随时在设置中调整。</p>
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
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-secondary" onClick={onSkip} type="button">
          跳过
        </button>
        <button className="btn btn-primary" onClick={onNext} type="button">
          下一步
        </button>
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
  isCustom,
  initialConfig,
  saveStatus,
  saveError,
  onComplete,
  onBack,
}: {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  baseUrl: string;
  onBaseUrlChange: (v: string) => void;
  model: string;
  onModelChange: (v: string) => void;
  isCustom: boolean;
  initialConfig?: ConfiguredModel | null;
  saveStatus: string;
  saveError: string;
  onComplete: () => void;
  onBack: () => void;
}) {
  const isReconfig = !!initialConfig;

  return (
    <div className="onboarding-page">
      <div className="onboarding-body">
        <button className="btn btn-ghost onboarding-back" onClick={onBack} type="button">
          返回
        </button>

        <h1 className="onboarding-title">配置模型连接</h1>
        <p className="onboarding-subtitle">这里只保存模型连接。项目和本地文件将在进入程序后由你分别设置。</p>

        {/* API key */}
        <div className="onboarding-field">
          <label className="onboarding-label">API 密钥</label>
          {isReconfig && initialConfig?.hasKey && (
            <p className="field-hint">
              当前配置: <code>{initialConfig?.id}</code>。已配置密钥，留空保持不变。
            </p>
          )}
          <input
            className="input"
            type="password"
            placeholder={isReconfig ? '留空保留旧密钥' : 'sk-xxx 或提供商 API 密钥'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Custom model fields */}
        {isCustom && (
          <div className="onboarding-field">
            <label className="onboarding-label">自定义端点</label>
            <input
              className="input"
              type="text"
              placeholder="Base URL（任意 OpenAI 兼容端点）"
              value={baseUrl}
              onChange={(e) => onBaseUrlChange(e.target.value)}
            />
            <input
              className="input"
              type="text"
              placeholder="模型名称（如 my-custom-model）"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              style={{ marginTop: 8 }}
            />
          </div>
        )}

        {/* Status */}
        {saveStatus === 'testing' && (
          <div className="status-busy" role="status">正在测试连接…</div>
        )}
        {saveStatus === 'saving' && (
          <div className="status-busy" role="status">正在保存配置…</div>
        )}
        {saveStatus === 'ok' && (
          <div className="status-ok">配置已保存</div>
        )}
        {saveStatus === 'fail' && (
          <div className="status-fail">
            {saveError}
            <div className="status-fail-hint">
              连接测试失败。请检查：API 密钥 / Base URL / 网络。
            </div>
          </div>
        )}
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-secondary" onClick={onComplete} type="button">
          暂时跳过
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
  );
}

// ---- Page 0: Welcome ----

function WelcomePage({ onStart }: { onStart: () => void }) {
  return (
    <div className="onboarding-page">
      <div className="onboarding-body onboarding-body--centered">
        <div className="onboarding-brand">
          <p className="onboarding-brand-kicker">Stellara Work</p>
          <h1 className="onboarding-brand-title">本地优先的 AI 任务工作台</h1>
          <p className="onboarding-brand-subtitle">
            把任务交给 Agent，它会在你的本地工作区执行并记录结果。
          </p>
        </div>
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-primary" onClick={onStart} type="button">
          开始配置
        </button>
      </div>
    </div>
  );
}

// ---- Page 3: Environment init (choose workdir) ----

function EnvPage({
  projects,
  selectedId,
  onSelect,
  onComplete,
  onSkip,
}: {
  projects: ProjectSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="onboarding-page">
      <div className="onboarding-body">
        <h1 className="onboarding-title">选择工作目录</h1>
        <p className="onboarding-subtitle">
          选择一个已有项目作为当前工作区；也可以稍后在首页创建。
        </p>

        {projects.length === 0 ? (
          <p className="env-empty">还没有项目。进入程序后可在首页创建项目。</p>
        ) : (
          <div className="env-project-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`env-project-row ${p.id === selectedId ? 'selected' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="env-project-row__icon"><Icon name="folder" size={15} /></span>
                <span className="env-project-row__body">
                  <strong>{p.name}</strong>
                  <small>{p.sessionCount} 条工作记录</small>
                </span>
                {p.id === selectedId && (
                  <span className="env-project-row__check"><Icon name="check" size={13} /></span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="onboarding-footer">
        <button className="btn btn-secondary" onClick={onSkip} type="button">
          跳过
        </button>
        <button className="btn btn-primary" onClick={onComplete} type="button">
          完成
        </button>
      </div>
    </div>
  );
}
