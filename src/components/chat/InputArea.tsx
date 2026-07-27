import type { SkillDef } from '../../../shared/ipc';

export interface SlashState {
  slashOpen: boolean;
  slashItems: SkillDef[];
  slashIdx: number;
  skillsLoaded: boolean;
}

interface InputAreaProps {
  input: string;
  busy: boolean;
  planMode: boolean;
  slash: SlashState;
  hasWorkDir: boolean;
  onInputChange: (value: string) => void;
  onPlanToggle: () => void;
  onSend: () => void;
  onSlashApply: (skill: SkillDef) => void;
  onSlashClose: () => void;
  onSlashIdxChange: (idx: number) => void;
  onLazyLoadSkills: () => void;
}

/**
 * 底部输入区：textarea + slash 自动补全 + plan toggle + 发送按钮
 */
export function InputArea(props: InputAreaProps) {
  function handleChange(v: string) {
    props.onInputChange(v);
    // `/` 后没空格 → 显示补全菜单
    if (/^\/\S*$/.test(v)) {
      if (!props.slash.slashOpen) props.onSlashClose; // noop; parent manages state
      if (props.hasWorkDir && !props.slash.skillsLoaded) props.onLazyLoadSkills();
    }
  }

  return (
    <footer className="main-input">
      {props.slash.slashOpen && (
        <div className="slash-menu">
          {!props.slash.skillsLoaded && <div className="slash-item empty">加载中...</div>}
          {props.slash.skillsLoaded && props.slash.slashItems.length === 0 && (
            <div className="slash-item empty">
              workDir 下没有 skills/ 目录，或没有 .json skill 文件
            </div>
          )}
          {props.slash.slashItems.map((s, i) => (
            <div
              key={s.name}
              className={`slash-item ${i === props.slash.slashIdx ? 'active' : ''}`}
              onClick={() => props.onSlashApply(s)}
              onMouseEnter={() => props.onSlashIdxChange(i)}
            >
              <span className="slash-item-name">/{s.name}</span>
              <span className="slash-item-desc">{s.description}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="input-chat"
        placeholder={props.busy ? 'Agent 思考中...' : '输入 / 调 skill，或直接写需求...'}
        value={props.input}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          // Slash 菜单内的按键
          if (props.slash.slashOpen) {
            if (e.key === 'Escape') {
              e.preventDefault();
              props.onSlashClose();
              return;
            }
            if (props.slash.slashItems.length > 0) {
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                props.onSlashApply(props.slash.slashItems[props.slash.slashIdx]!);
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                props.onSlashIdxChange(Math.min(props.slash.slashIdx + 1, props.slash.slashItems.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                props.onSlashIdxChange(Math.max(props.slash.slashIdx - 1, 0));
                return;
              }
            }
          }
          // Tab / Shift+Tab 切 Plan 模式
          if (e.key === 'Tab') {
            e.preventDefault();
            props.onPlanToggle();
            if (props.slash.slashOpen) props.onSlashClose();
            return;
          }
          // Ctrl+Enter 由全局快捷键 hook 处理
        }}
        disabled={props.busy}
        rows={3}
      />
      <div className="input-actions">
        <label className={`plan-toggle ${props.planMode ? 'on' : ''}`} title="Plan 模式：agent 只读文件 / 搜索，不写不执行">
          <input
            type="checkbox"
            checked={props.planMode}
            onChange={(e) => {
              if (e.target.checked !== props.planMode) props.onPlanToggle();
            }}
            disabled={props.busy}
          />
          <span>Plan 模式{props.planMode ? '（只读）' : ''}</span>
        </label>
        <span className="hint">Ctrl+Enter 发送</span>
        <button
          className="btn btn-primary"
          onClick={() => props.onSend()}
          disabled={props.busy || !props.input.trim()}
        >
          {props.busy ? '思考中...' : '发送'}
        </button>
      </div>
    </footer>
  );
}