import type { IconName } from '../Icon';
import { Icon } from '../Icon';

export const CAPABILITY_CARDS: ReadonlyArray<{ id: string; label: string; prompt: string; icon: IconName }> = [
  { id: 'explore', label: '探索并理解代码', prompt: '请探索并理解当前项目的代码结构与关键实现。', icon: 'search' },
  { id: 'build', label: '构建新功能、应用或工具', prompt: '请帮我构建一个新功能，并说明实现方案。', icon: 'tool' },
  { id: 'review', label: '审查代码并提出修改建议', prompt: '请审查当前代码，指出问题并给出修改建议。', icon: 'shield' },
  { id: 'fix', label: '修复问题和失败', prompt: '请定位并修复当前的问题和失败。', icon: 'alert' },
];

interface CapabilityCardsProps {
  onPick: (prompt: string) => void;
}

export function CapabilityCards({ onPick }: CapabilityCardsProps) {
  return (
    <div className="capability-cards" role="group" aria-label="能力入口">
      {CAPABILITY_CARDS.map((card) => (
        <button key={card.id} className="capability-card" type="button" onClick={() => onPick(card.prompt)}>
          <span className="capability-card__icon"><Icon name={card.icon} size={16} /></span>
          <span className="capability-card__label">{card.label}</span>
        </button>
      ))}
    </div>
  );
}
