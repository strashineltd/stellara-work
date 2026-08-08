import { useEffect, useState } from 'react';
import type { SkillDef } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface SettingsSkillsPanelProps {
  /** 设置变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

/**
 * 设置窗口「技能」面板：workDir 从 models.list() 的 configured.workDir 获取，
 * 展示 skills.list() 返回的可用技能（图标块 + 名称 + 描述，可展开 prompt），
 * 以及技能目录（路径 + 打开目录按钮 → fs.openPath）。
 */
export function SettingsSkillsPanel({ refreshKey = 0 }: SettingsSkillsPanelProps) {
  const [workDir, setWorkDir] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.electronAPI.models.list();
        const dir = list.configured?.workDir ?? null;
        setWorkDir(dir);
        if (!dir) return;
        setSkillsLoading(true);
        const found = await window.electronAPI.skills.list(dir);
        setSkills(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSkillsLoading(false);
      }
    })();
  }, [refreshKey]);

  function toggleSkill(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function openSkillsDir() {
    if (!workDir) return;
    void window.electronAPI.fs.openPath(workDir, `${workDir}/skills`);
  }

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>技能</h2>
          <div className="sub">项目 skills/ 目录中的自定义技能</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      {!workDir && (
        <div className="empty-hint">
          请先配置模型并选择项目，然后在项目下创建 <code>skills/</code> 目录放置技能文件。
        </div>
      )}

      {workDir && (
        <>
          <div className="settings-section">
            <div className="settings-section__title">
              可用技能 <span className="count">{skillsLoading ? '加载中…' : skills.length}</span>
            </div>
            <div className="settings-group">
              {skills.length === 0 && !skillsLoading && (
                <div className="settings-item">
                  <div className="settings-item__grow">
                    <div className="settings-item__hint">
                      当前 workDir 下没有 skill 文件。在 <code>{`${workDir}/skills/`}</code> 里创建 <code>name.json</code>，
                      必须含 <code>name</code> / <code>description</code> / <code>prompt</code> 字段。
                    </div>
                  </div>
                </div>
              )}
              {skills.map((s) => {
                const isOpen = expanded.has(s.name);
                return (
                  <div
                    key={s.name}
                    className="settings-item settings-skill-row"
                    data-skill={s.name}
                    onClick={() => toggleSkill(s.name)}
                  >
                    <span className="settings-skill-row__icon" aria-hidden="true">
                      <Icon name="tool" size={15} />
                    </span>
                    <div className="settings-item__grow">
                      <div className="settings-item__title">{s.name}</div>
                      <div className="settings-item__hint">{s.description}</div>
                      {isOpen && <pre className="settings-skill-prompt">{s.prompt}</pre>}
                    </div>
                    <button
                      className="icon-btn"
                      aria-label={isOpen ? `收起 ${s.name} 详情` : `展开 ${s.name} 详情`}
                      aria-expanded={isOpen}
                      title={isOpen ? '收起 prompt' : '展开 prompt'}
                      type="button"
                    >
                      <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">技能目录</div>
            <div className="settings-group">
              <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">skills 目录</div>
              <div className="settings-item__hint settings-skill-path">{`${workDir}/skills`}</div>
            </div>
                <button
                  className="btn btn-secondary"
                  onClick={openSkillsDir}
                  type="button"
                  title="在文件管理器打开 skills 目录"
                >
                  打开目录
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
