import type { ModelPreset } from '../../shared/ipc';

interface ModelCardProps {
  preset: ModelPreset;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 单个模型预设卡片
 * 显示 label、base_url、model 名称、Responses 徽标
 */
export function ModelCard({ preset, selected, onSelect }: ModelCardProps) {
  const isResponses = preset.wireApi === 'responses';
  const isIncompatible = preset.compatibility === 'incompatible';
  const isVerified = preset.compatibility === 'verified';

  return (
    <button
      className={`model-card ${selected ? 'selected' : ''} ${isIncompatible ? 'incompatible' : ''}`}
      onClick={onSelect}
      type="button"
      disabled={isIncompatible}
    >
      <div className="model-card-header">
        <div className="model-card-name">{preset.label}</div>
        {isResponses && (
          <span className={`model-card-badge ${isVerified ? 'verified' : 'unverified'}`}>
            Responses API
          </span>
        )}
      </div>
      <div className="model-card-base">{preset.baseUrl || '任意 Responses API endpoint'}</div>
      <div className="model-card-model">{preset.model || '（自定义填入）'}</div>
      {isIncompatible && (
        <div className="model-card-status">配置已保留，当前不可执行</div>
      )}
    </button>
  );
}
