import { useState } from 'react';
import type { AttachmentMeta, SkillDef } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { formatFileSize } from '../../lib/chat-utils';

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
  attachments: AttachmentMeta[];
  onInputChange: (value: string) => void;
  onPlanToggle: () => void;
  onSend: () => void;
  onAttachmentsChange: (next: AttachmentMeta[]) => void;
  onPickAttachments: () => void;
  onAddAttachmentPaths: (paths: string[]) => void;
  onSlashApply: (skill: SkillDef) => void;
  onSlashOpen: () => void;
  onSlashClose: () => void;
  onSlashIdxChange: (idx: number) => void;
  onLazyLoadSkills: () => void;
}

/**
 * 底部输入区：textarea + slash 自动补全 + 附件（选择/拖拽/chip）+ plan toggle + 发送按钮
 */
export function InputArea(props: InputAreaProps) {
  const [dropActive, setDropActive] = useState(false);

  function handleChange(v: string) {
    props.onInputChange(v);
    // `/` 后没空格 → 显示补全菜单
    if (/^\/\S*$/.test(v)) {
      if (!props.slash.slashOpen) props.onSlashOpen();
      if (props.hasWorkDir && !props.slash.skillsLoaded) props.onLazyLoadSkills();
    } else if (props.slash.slashOpen) {
      props.onSlashClose();
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    if (props.busy) return;
    const paths: string[] = [];
    const files = Array.from(e.dataTransfer?.files ?? []);
    for (const file of files) {
      try {
        const p = window.electronAPI.dialog.getPathForFile(file);
        if (p) paths.push(p);
      } catch { /* 非本地文件（如浏览器预览）忽略 */ }
    }
    if (paths.length > 0) props.onAddAttachmentPaths(paths);
  }

  return (
    <footer
      className="main-input"
      aria-label="任务输入"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dropActive) setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropActive(false);
      }}
      onDrop={handleDrop}
    >
      {dropActive && (
        <div className="attach-drop-overlay" role="status">
          释放以添加附件
        </div>
      )}
      {props.slash.slashOpen && (
        <div className="slash-menu" id="slash-suggestions" role="listbox" aria-label="可用技能">
          {!props.slash.skillsLoaded && <div className="slash-item empty" role="status">正在加载技能…</div>}
          {props.slash.skillsLoaded && props.slash.slashItems.length === 0 && (
            <div className="slash-item empty" role="status">
              当前工作目录中没有可用技能
            </div>
          )}
          {props.slash.slashItems.map((s, i) => (
            <button
              key={s.name}
              id={`slash-option-${i}`}
              type="button"
              role="option"
              aria-selected={i === props.slash.slashIdx}
              className={`slash-item ${i === props.slash.slashIdx ? 'active' : ''}`}
              onClick={() => props.onSlashApply(s)}
              onMouseEnter={() => props.onSlashIdxChange(i)}
            >
              <span className="slash-item-name">/{s.name}</span>
              <span className="slash-item-desc">{s.description}</span>
            </button>
          ))}
        </div>
      )}
      {props.attachments.length > 0 && (
        <div className="attach-bar">
          <div className="attach-chips">
            {props.attachments.map((a) => (
              <span className="attach-chip" key={a.id} title={a.name}>
                <Icon name="file" size={12} />
                <span className="attach-chip-name">{a.name}</span>
                <span className="attach-chip-size">{formatFileSize(a.size)}</span>
                <button
                  className="attach-chip-remove"
                  type="button"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => props.onAttachmentsChange(props.attachments.filter((x) => x.id !== a.id))}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <textarea
        className="input-chat"
        placeholder={props.busy ? '任务正在执行，完成后可继续补充…' : '写下任务目标、涉及范围和完成标准，或输入 / 调用技能…'}
        aria-label="任务说明"
        aria-autocomplete="list"
        aria-controls={props.slash.slashOpen ? 'slash-suggestions' : undefined}
        aria-expanded={props.slash.slashOpen}
        aria-activedescendant={
          props.slash.slashOpen && props.slash.slashItems.length > 0
            ? `slash-option-${props.slash.slashIdx}`
            : undefined
        }
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
        <button
          className="attach-btn"
          type="button"
          title="添加附件（也可拖拽文件到此处）"
          aria-label="添加附件"
          onClick={() => props.onPickAttachments()}
          disabled={props.busy}
        >
          <Icon name="paperclip" size={14} />
        </button>
        <label className={`plan-toggle ${props.planMode ? 'on' : ''}`} title="计划模式只会读取和分析，不会修改文件或执行命令">
          <input
            type="checkbox"
            checked={props.planMode}
            onChange={(e) => {
              if (e.target.checked !== props.planMode) props.onPlanToggle();
            }}
            disabled={props.busy}
          />
          <span>先制定计划{props.planMode ? ' · 只读' : ''}</span>
        </label>
        <span className="hint input-shortcut">Ctrl + Enter</span>
        <button
          className="btn btn-primary"
          onClick={() => props.onSend()}
          disabled={props.busy || !props.input.trim()}
          type="button"
        >
          {props.busy ? '执行中…' : '开始执行'}
        </button>
      </div>
    </footer>
  );
}
