// Status dot glyph (HTML entities, no emoji)
const DOT = { active: '●', waiting: '◐', idle: '◯' } as const;

export type TabBarTab = {
  id: string;
  title: string;
  status: 'active' | 'waiting' | 'idle';
};

interface TabBarProps {
  tabs: TabBarTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose }: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          data-tab-id={t.id}
          className={`tab-chip${t.id === activeId ? ' tab-chip--active' : ''}`}
          onClick={() => onSelect(t.id)}
        >
          <span className={`tab-chip-dot tab-chip-dot--${t.status}`}>{DOT[t.status]}</span>
          <span className="tab-chip-title">{t.title}</span>
          <span
            className="tab-chip-close"
            aria-label="close tab"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
