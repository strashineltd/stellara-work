import type { ModelPreset } from '../../shared/ipc';

interface ModelCardProps {
  preset: ModelPreset;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 单个模型预设卡片
 * 显示 label、base_url、model 名称
 */
export function ModelCard({ preset, selected, onSelect }: ModelCardProps) {
  return (
    <button
      className={`model-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <div className="model-card-name">{preset.label}</div>
      <div className="model-card-base">{preset.baseUrl || '任意 OpenAI 兼容 endpoint'}</div>
      <div className="model-card-model">{preset.model || '（自定义填入）'}</div>
    </button>
  );
}
