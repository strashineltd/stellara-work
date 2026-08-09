import { useEffect, useState } from 'react';
import type { SkillDef, SkillLoadError } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { SettingsMcpSection } from './SettingsMcpSection';

interface SettingsSkillsPanelProps {
  /** 设置变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

/** 「复制模板」按钮写入剪贴板的新技能文件模板（markdown frontmatter） */
export const SKILL_TEMPLATE = `---
name: my-skill
description: 描述
---

技能内容`;

/**
 * 设置窗口「技能与 MCP」面板：workDir 从 models.list() 的 configured.workDir 获取，
 * 展示 skills.list() 返回的可用技能（搜索过滤 + 格式徽章 + 可展开 prompt + 复制模板引导），
 * 以及技能目录；下方渲染 MCP 服务器管理区块（SettingsMcpSection）。
 */
export function SettingsSkillsPanel({ onChanged, refreshKey = 0 }: SettingsSkillsPanelProps) {
  const [workDir, setWorkDir] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [skillErrors, setSkillErrors] = useState<SkillLoadError[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [templateCopied, setTemplateCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.electronAPI.models.list();
        const dir = list.configured?.workDir ?? null;
        setWorkDir(dir);
        if (!dir) return;
        setSkillsLoading(true);
        const res = await window.electronAPI.skills.listDetailed(dir);
        setSkills(res.items);
        setSkillErrors(res.errors);
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

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(SKILL_TEMPLATE);
      setTemplateCopied(true);
      setTimeout(() => setTemplateCopied(false), 2000);
    } catch {
      setError('复制模板失败：剪贴板不可用');
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
      )
    : skills;

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>技能与 MCP</h2>
          <div className="sub">项目技能与 MCP 服务器</div>
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
            <div className="settings-skill-search">
              <Icon name="search" size={14} />
              <input
                type="text"
                placeholder="搜索技能…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="搜索技能"
              />
            </div>
            {skillErrors.length > 0 && (
              <div className="settings-skill-errors" role="alert">
                <div className="settings-skill-errors__title">
                  {`${skillErrors.length} 个文件格式错误`}
                </div>
                <ul className="settings-skill-errors__list">
                  {skillErrors.map((e) => (
                    <li key={e.file} className="settings-skill-errors__item">
                      <code>{e.file}</code>（{e.reason}）
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="settings-group">
              {skills.length === 0 && !skillsLoading && (
                <div className="settings-item">
                  <div className="settings-item__grow">
                    <div className="settings-item__hint">
                      当前 workDir 下没有 skill 文件。在 <code>{`${workDir}/skills/`}</code> 里创建{' '}
                      <code>name.md</code>（frontmatter 声明 <code>name</code> /{' '}
                      <code>description</code>，正文为 prompt）或 <code>name.json</code>。
                    </div>
                  </div>
                </div>
              )}
              {filtered.length === 0 && skills.length > 0 && (
                <div className="settings-item">
                  <div className="settings-item__grow">
                    <div className="settings-item__hint">没有匹配「{query}」的技能。</div>
                  </div>
                </div>
              )}
              {filtered.map((s) => {
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
                      <div className="settings-item__top">
                        <div className="settings-item__title">{s.name}</div>
                        {s.format && (
                          <span className={`settings-skill-badge settings-skill-badge--${s.format}`}>
                            {s.format}
                          </span>
                        )}
                      </div>
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
            <div className="settings-section__title">新建技能</div>
            <div className="settings-group">
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    在 <code>{`${workDir}/skills/`}</code> 里创建 <code>.md</code> 文件，
                    文件头用 frontmatter 声明 <code>name</code> 与 <code>description</code>，
                    正文为技能内容（也可用 <code>.json</code> 格式）。
                  </div>
                </div>
                <button
                  className="btn btn-secondary settings-skill-template-copy"
                  onClick={() => void copyTemplate()}
                  type="button"
                  title="复制 markdown 模板到剪贴板"
                >
                  {templateCopied ? '已复制' : '复制模板'}
                </button>
              </div>
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

      <SettingsMcpSection refreshKey={refreshKey} onChanged={onChanged} />
    </div>
  );
}
