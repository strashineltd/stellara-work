import { useEffect, useState } from 'react';
import type { SkillDetailedItem, SkillLoadError } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { SettingsMcpSection } from './SettingsMcpSection';

interface SettingsSkillsPanelProps {
  /** 设置变更后通知 SettingsPanel（同窗口刷新同步） */
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

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 设置窗口「技能与 MCP」面板：workDir 从 models.list() 的 configured.workDir 获取，
 * 展示 skills.listDetailed() 返回的全部技能（含禁用项与格式错误），支持：
 * 新建/编辑折叠表单（.md）、启用开关（写 frontmatter enabled）、内联删除确认、
 * 展开 prompt / 复制模板；下方渲染 MCP 服务器管理区块（SettingsMcpSection）。
 */
export function SettingsSkillsPanel({ onChanged, refreshKey = 0 }: SettingsSkillsPanelProps) {
  const [workDir, setWorkDir] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillDetailedItem[]>([]);
  const [skillErrors, setSkillErrors] = useState<SkillLoadError[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [templateCopied, setTemplateCopied] = useState(false);

  const [showForm, setShowForm] = useState<'new' | 'edit' | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  /** 内联删除确认（与 MCP 区块一致的确认模式） */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  async function refreshSkills(dir: string) {
    setSkillsLoading(true);
    try {
      const res = await window.electronAPI.skills.listDetailed(dir);
      setSkills(res.items);
      setSkillErrors(res.errors);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSkillsLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.electronAPI.models.list();
        const dir = list.configured?.workDir ?? null;
        setWorkDir(dir);
        if (!dir) return;
        await refreshSkills(dir);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [refreshKey]);

  function toggleSkill(file: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  }

  function toggleEnabled(s: SkillDetailedItem) {
    const next = !(s.enabled !== false);
    void window.electronAPI.skills
      .update(workDir!, s.file, { enabled: next })
      .then(() => {
        setSkills((prev) => prev.map((x) => (x.file === s.file ? { ...x, enabled: next } : x)));
      })
      .catch((e) => setError(errorMessage(e)));
    onChanged?.();
  }

  function confirmDelete(s: SkillDetailedItem) {
    setConfirmingDelete(s.file);
  }

  async function doDelete(s: SkillDetailedItem) {
    try {
      await window.electronAPI.skills.delete(workDir!, s.file);
      setSkills((prev) => prev.filter((x) => x.file !== s.file));
      setConfirmingDelete(null);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
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

  function openCreate() {
    if (!workDir) {
      setError('请先创建或选择项目，技能保存在项目的 skills/ 目录中');
      return;
    }
    setShowForm('new');
    setEditingFile(null);
    setFormName('');
    setFormDesc('');
    setFormPrompt('');
    setFormError(null);
  }

  function openEdit(s: SkillDetailedItem) {
    setShowForm('edit');
    setEditingFile(s.file);
    setFormName(s.name);
    setFormDesc(s.description);
    setFormPrompt(s.prompt);
    setFormError(null);
  }

  async function handleSave() {
    const name = formName.trim();
    const description = formDesc.trim();
    const prompt = formPrompt.trim();
    if (!name || !description || !prompt) {
      setFormError('名称、描述与内容不能为空');
      return;
    }
    try {
      if (showForm === 'edit' && editingFile) {
        await window.electronAPI.skills.update(workDir!, editingFile, { name, description, prompt });
      } else {
        await window.electronAPI.skills.create(workDir!, { name, description, prompt });
      }
      setShowForm(null);
      setFormError(null);
      if (workDir) await refreshSkills(workDir);
      onChanged?.();
    } catch (e) {
      setFormError(errorMessage(e));
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
      )
    : skills;
  const formFileName = `skills/${formName.trim() || 'name'}.md`;

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

      <div className="settings-skill-toolbar">
        <div className="settings-skill-search">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="搜索技能名称或描述…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索技能"
            disabled={!workDir}
          />
        </div>
        <button
          className="btn btn-secondary settings-skill-template-copy"
          onClick={() => void copyTemplate()}
          type="button"
          title="复制 markdown 模板到剪贴板"
        >
          <Icon name="copy" size={14} />
          {templateCopied ? '已复制' : '复制模板'}
        </button>
        <button
          className="btn btn-primary settings-skill-create"
          onClick={openCreate}
          type="button"
          title="新建技能"
        >
          <Icon name="plus" size={14} />
          新建技能
        </button>
      </div>

      {workDir && (
        <>
          <div className="settings-section">
            <div className="settings-section__title">
              技能 <span className="count">{skillsLoading ? '加载中…' : skills.length}</span>
            </div>

            {showForm && (
              <div className="settings-add-form settings-skill-form">
                <div className="settings-skill-form__title">
                  {showForm === 'edit' ? '编辑技能' : '新建技能'}
                </div>
                <div className="form-row settings-skill-field-name">
                  <label htmlFor="skill-name">名称</label>
                  <input
                    id="skill-name"
                    type="text"
                    placeholder="如 code-review"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                  <div className="form-hint">{`将生成 ${formFileName}`}</div>
                </div>
                <div className="form-row settings-skill-field-desc">
                  <label htmlFor="skill-desc">描述</label>
                  <input
                    id="skill-desc"
                    type="text"
                    placeholder="何时使用这个技能"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                  />
                </div>
                <div className="form-row settings-skill-field-prompt">
                  <label htmlFor="skill-prompt">内容（prompt）</label>
                  <textarea
                    id="skill-prompt"
                    placeholder="技能的执行指令，支持 Markdown…"
                    value={formPrompt}
                    onChange={(e) => setFormPrompt(e.target.value)}
                  />
                </div>
                {formError && (
                  <div className="settings-skill-form__error" role="alert">
                    {formError}
                  </div>
                )}
                <div className="settings-add-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowForm(null)}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="btn btn-primary settings-skill-save"
                    onClick={() => void handleSave()}
                    type="button"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}

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
                      当前 workDir 下没有 skill 文件。点击「新建技能」创建 <code>.md</code> 技能，
                      或把 <code>name.md</code>（frontmatter 声明 <code>name</code> /{' '}
                      <code>description</code>，正文为 prompt）放入 <code>{`${workDir}/skills/`}</code>。
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
                const isOpen = expanded.has(s.file);
                const enabled = s.enabled !== false;
                const isJson = s.format === 'json';
                return (
                  <div
                    key={s.file}
                    className={`settings-item settings-skill-row${enabled ? '' : ' settings-skill-row--disabled'}`}
                    data-skill={s.file}
                    onClick={() => toggleSkill(s.file)}
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
                      <div className="settings-item__hint settings-skill-desc">{s.description}</div>
                      {isOpen && (
                        <>
                          <div className="settings-skill-path">
                            {`skills/${s.file}`}
                            {isJson && ' · 旧格式仅可删除'}
                          </div>
                          <pre className="settings-skill-prompt">{s.prompt}</pre>
                        </>
                      )}
                    </div>
                    <div className="settings-skill-ops">
                      {!isJson && (
                        <button
                          className={`settings-switch${enabled ? ' on' : ''}`}
                          role="switch"
                          aria-checked={enabled}
                          aria-label={`${enabled ? '停用' : '启用'} ${s.name}`}
                          title={enabled ? '停用该技能' : '启用该技能'}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleEnabled(s);
                          }}
                          type="button"
                        />
                      )}
                      <button
                        className="icon-btn settings-skill-expand"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `收起 ${s.name} 详情` : `展开 ${s.name} 详情`}
                        title={isOpen ? '收起 prompt' : '展开 prompt'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSkill(s.file);
                        }}
                        type="button"
                      >
                        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                      </button>
                      {!isJson && (
                        <button
                          className="icon-btn settings-skill-edit"
                          aria-label={`编辑 ${s.name}`}
                          title="编辑技能"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(s);
                          }}
                          type="button"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      )}
                      {confirmingDelete === s.file ? (
                        <div className="settings-item__ops">
                          <button
                            className="btn btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              void doDelete(s);
                            }}
                            type="button"
                          >
                            确认删除
                          </button>
                          <button
                            className="icon-btn"
                            aria-label="取消删除"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmingDelete(null);
                            }}
                            type="button"
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="icon-btn danger settings-skill-delete"
                          aria-label={`删除 ${s.name}`}
                          title="删除技能"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(s);
                          }}
                          type="button"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      )}
                    </div>
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

      <SettingsMcpSection refreshKey={refreshKey} onChanged={onChanged} />
    </div>
  );
}
