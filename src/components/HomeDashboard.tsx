import type { ModelConfig, ProjectSummary, SessionSummary } from '../../shared/ipc';
import { basename } from '../lib/chat-utils';
import { Icon } from './Icon';

export type DashboardSection = 'home' | 'projects';

interface HomeDashboardProps {
  section: DashboardSection;
  config: ModelConfig;
  workDir?: string;
  projectName?: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  input: string;
  busy: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onSelectSession: (id: string) => void;
  onOpenProject: (id: string) => void;
  onCreateProject: () => void;
  onOpenFiles: () => void;
}

const QUICK_TASKS = [
  { label: '梳理项目计划', prompt: '请根据当前项目内容，梳理目标、范围、优先级和下一步执行计划。', icon: 'list' as const },
  { label: '总结当前进展', prompt: '请总结当前项目已完成的工作、尚未解决的问题和接下来的建议。', icon: 'check' as const },
  { label: '检查代码问题', prompt: '请检查当前项目中的错误、缺陷和潜在风险，并按优先级给出修复建议。', icon: 'tool' as const },
  { label: '整理交付清单', prompt: '请整理当前项目的交付清单，并标注仍需验证或补充的内容。', icon: 'file' as const },
];

function formatRelativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function projectProgress(project: ProjectSummary, index: number): number {
  if (project.sessionCount === 0) return 12;
  return Math.min(88, 34 + project.sessionCount * 13 + index * 7);
}

export function HomeDashboard(props: HomeDashboardProps) {
  const recentSessions = props.sessions.slice(0, 3);
  const visibleProjects = props.projects.slice(0, props.section === 'projects' ? 12 : 3);
  const effectiveWorkDir = props.workDir ?? props.config.workDir;
  const workDirName = effectiveWorkDir ? basename(effectiveWorkDir) : '尚未选择项目';

  if (props.section === 'projects') {
    return (
      <main className="dashboard dashboard--projects" aria-labelledby="projects-page-title">
        <header className="dashboard-page-header">
          <div>
            <p className="dashboard-eyebrow">本地项目</p>
            <h1 id="projects-page-title">项目</h1>
            <p>在一个位置查看项目与关联工作记录。</p>
          </div>
          <button className="btn btn-primary dashboard-create-button" type="button" onClick={props.onCreateProject}>
            <Icon name="plus" size={15} />
            新建项目
          </button>
        </header>

        {visibleProjects.length > 0 ? (
          <div className="project-dashboard-grid">
            {visibleProjects.map((project, index) => (
              <button
                className="project-dashboard-card"
                type="button"
                key={project.id}
                onClick={() => props.onOpenProject(project.id)}
              >
                <span className="project-dashboard-card__icon"><Icon name="folder" size={18} /></span>
                <span className="project-dashboard-card__body">
                  <strong>{project.name}</strong>
                  <span>{project.sessionCount} 条工作记录 · {formatRelativeTime(project.updatedAt)}更新</span>
                </span>
                <Icon className="project-dashboard-card__arrow" name="chevron-right" size={15} />
                <span className="project-dashboard-card__progress" aria-label={`项目活跃度 ${projectProgress(project, index)}%`}>
                  <span style={{ width: `${projectProgress(project, index)}%` }} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty-state">
            <span><Icon name="folder" size={22} /></span>
            <h2>还没有项目</h2>
            <p>创建一个项目，把相关工作记录整理在一起。</p>
            <button className="btn btn-secondary" type="button" onClick={props.onCreateProject}>创建第一个项目</button>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="dashboard dashboard--home" aria-labelledby="home-dashboard-title">
      <section className="dashboard-hero">
        <div className="dashboard-intro">
          <h1 id="home-dashboard-title">你好，今天想推进什么？</h1>
          <p>从一个清楚的任务开始；如果还没有项目，先选择或新建一个本地文件。</p>
        </div>

        <div className="dashboard-composer">
          <textarea
            rows={3}
            value={props.input}
            disabled={props.busy}
            aria-label="输入任务"
            placeholder={props.busy ? '任务正在执行…' : '描述任务目标、涉及范围和完成标准…'}
            onChange={(event) => props.onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                props.onSend();
              }
            }}
          />
          <div className="dashboard-composer__footer">
            <span><Icon name="folder" size={14} />{props.projectName ?? workDirName}</span>
            <button
              className="dashboard-send-button"
              type="button"
              aria-label="开始执行任务"
              title="开始执行任务"
              disabled={props.busy || !props.input.trim()}
              onClick={props.onSend}
            >
              <Icon name="send" size={17} />
            </button>
          </div>
        </div>

        <div className="dashboard-quick-actions" aria-label="快捷任务">
          {QUICK_TASKS.map((task) => (
            <button key={task.label} type="button" onClick={() => props.onInputChange(task.prompt)}>
              <Icon name={task.icon} size={15} />
              <span>{task.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-cards" aria-label="工作概览">
        <article className="dashboard-card dashboard-card--projects">
          <header><h2>项目概览</h2><span>{props.projects.length} 个项目</span></header>
          <div className="dashboard-card__content">
            {visibleProjects.length > 0 ? visibleProjects.map((project, index) => (
              <button className="dashboard-project-row" key={project.id} type="button" onClick={() => props.onOpenProject(project.id)}>
                <span><strong>{project.name}</strong><small>{project.sessionCount} 条记录</small></span>
                <span className="dashboard-progress"><span style={{ width: `${projectProgress(project, index)}%` }} /></span>
              </button>
            )) : <p className="dashboard-card__empty">创建项目后，会在这里显示进展。</p>}
          </div>
          <button className="dashboard-card__link" type="button" onClick={props.onCreateProject}>新建项目 <Icon name="chevron-right" size={13} /></button>
        </article>

        <article className="dashboard-card">
          <header><h2>最近工作记录</h2><span>{props.sessions.length} 条记录</span></header>
          <div className="dashboard-card__content">
            {recentSessions.length > 0 ? recentSessions.map((session) => (
              <button className="dashboard-session-row" key={session.id} type="button" onClick={() => props.onSelectSession(session.id)}>
                <span className="dashboard-session-check"><Icon name="check" size={12} /></span>
                <span><strong>{session.title}</strong><small>{formatRelativeTime(session.updatedAt)}</small></span>
              </button>
            )) : <p className="dashboard-card__empty">新建工作记录后，可从这里继续处理。</p>}
          </div>
        </article>

        <article className="dashboard-card dashboard-card--workspace">
          <header><h2>本地工作区</h2><span>{effectiveWorkDir ? '已连接' : '未选择'}</span></header>
          <div className="dashboard-card__content">
            <div className="workspace-summary-icon"><Icon name="folder" size={20} /></div>
            <strong className="workspace-summary-name">{props.projectName ?? workDirName}</strong>
            <p>{props.config.label} · {props.sessions.length} 条工作记录</p>
          </div>
          <button className="dashboard-card__link" type="button" onClick={props.onOpenFiles}>{effectiveWorkDir ? '浏览本地文件' : '创建项目'} <Icon name="chevron-right" size={13} /></button>
        </article>
      </section>
    </main>
  );
}
