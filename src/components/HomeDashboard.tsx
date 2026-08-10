import { useEffect, useRef, useState } from 'react';
import type { ConfiguredModel, ProjectSummary, SessionSummary } from '../../shared/ipc';
import { basename, formatRelativeTime } from '../lib/chat-utils';
import { Icon } from './Icon';

export type DashboardSection = 'home' | 'projects';

/** 稍后提醒的时长：5 分钟 */
const BANNER_SNOOZE_MS = 300_000;

interface HomeDashboardProps {
  section: DashboardSection;
  config: ConfiguredModel | null;
  workDir?: string;
  projectName?: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  input: string;
  busy: boolean;
  /** 尚未配置模型（无可用 agent）时显示横幅 */
  modelMissing?: boolean;
  onOpenSettings?: () => void;
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

function projectBarWidth(sessionCount: number, maxCount: number): number {
  if (maxCount <= 0 || sessionCount <= 0) return 0;
  return Math.max(6, Math.min(100, Math.round((sessionCount / maxCount) * 100)));
}

export function HomeDashboard(props: HomeDashboardProps) {
  const recentSessions = props.sessions.slice(0, 3);
  const visibleProjects = props.projects.slice(0, props.section === 'projects' ? 12 : 3);
  const maxSessionCount = Math.max(1, ...visibleProjects.map((p) => p.sessionCount));
  const effectiveWorkDir = props.workDir ?? props.config?.workDir;
  const workDirName = effectiveWorkDir ? basename(effectiveWorkDir) : '尚未选择项目';

  // ---- 无模型横幅 + 稍后提醒 ----
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const snoozeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // modelMissing 变 false（模型已配置）或组件卸载时，清掉稍后提醒定时器
  useEffect(() => {
    if (!props.modelMissing) {
      if (snoozeTimer.current) {
        clearTimeout(snoozeTimer.current);
        snoozeTimer.current = null;
      }
      setBannerDismissed(false);
      return;
    }
    return () => {
      if (snoozeTimer.current) {
        clearTimeout(snoozeTimer.current);
        snoozeTimer.current = null;
      }
    };
  }, [props.modelMissing]);

  function handleSnoozeBanner() {
    setBannerDismissed(true);
    if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
    snoozeTimer.current = setTimeout(() => {
      snoozeTimer.current = null;
      setBannerDismissed(false);
    }, BANNER_SNOOZE_MS);
  }

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
            {visibleProjects.map((project) => (
              <button
                className="project-dashboard-card"
                type="button"
                key={project.id}
                onClick={() => props.onOpenProject(project.id)}
              >
                <span className="project-dashboard-card__icon"><Icon name="folder" size={16} /></span>
                <span className="project-dashboard-card__body">
                  <strong>{project.name}</strong>
                  <span>{project.sessionCount} 条工作记录 · {formatRelativeTime(project.updatedAt)}更新</span>
                </span>
                <Icon className="project-dashboard-card__arrow" name="chevron-right" size={15} />
                <span className="project-dashboard-card__progress" aria-label={`${project.sessionCount} 条工作记录`}>
                  <span style={{ width: `${projectBarWidth(project.sessionCount, maxSessionCount)}%` }} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty-state">
            <span><Icon name="folder" size={16} /></span>
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
      {props.modelMissing && !bannerDismissed && (
        <div className="no-model-banner" role="alert">
          <Icon name="alert" size={15} />
          <span>尚未配置模型，Agent 暂时无法执行任务。</span>
          <span className="no-model-banner__actions">
            <button
              className="no-model-banner__btn no-model-banner__btn--settings"
              type="button"
              onClick={props.onOpenSettings}
            >
              去设置
            </button>
            <button
              className="no-model-banner__btn"
              type="button"
              onClick={handleSnoozeBanner}
            >
              稍后提醒
            </button>
          </span>
        </div>
      )}

      <section className="task-deck">
        <div className="task-deck-intro">
          <h1 id="home-dashboard-title">把任务交给 Agent</h1>
          <p>描述目标、范围和完成标准；Agent 会在当前工作区执行并逐条记录结果。</p>
        </div>

        <div className="dashboard-composer">
          <textarea
            rows={4}
            value={props.input}
            disabled={props.busy}
            aria-label="输入任务"
            placeholder={props.busy ? '任务正在执行…' : '例如：阅读 README.md，梳理项目结构和启动方式'}
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
              aria-label="交给 Agent"
              title="交给 Agent"
              disabled={props.busy || !props.input.trim()}
              onClick={props.onSend}
            >
              <Icon name="arrow-right" size={16} />
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

        <section className="continue-band" aria-label="继续工作">
          <h2 className="continue-band__title">继续工作</h2>
          {recentSessions.length > 0 ? (
            <div className="continue-band__list">
              {recentSessions.map((session) => (
                <button className="continue-row" key={session.id} type="button" onClick={() => props.onSelectSession(session.id)}>
                  <span className="continue-row__icon"><Icon name="check" size={13} /></span>
                  <span className="continue-row__body">
                    <strong>{session.title}</strong>
                    <small>{formatRelativeTime(session.updatedAt)}</small>
                  </span>
                  <Icon className="continue-row__arrow" name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          ) : visibleProjects.length > 0 ? (
            <div className="continue-band__list">
              {visibleProjects.map((project) => (
                <button className="continue-row" key={project.id} type="button" onClick={() => props.onOpenProject(project.id)}>
                  <span className="continue-row__icon continue-row__icon--folder"><Icon name="folder" size={14} /></span>
                  <span className="continue-row__body">
                    <strong>{project.name}</strong>
                    <small>{project.sessionCount} 条工作记录</small>
                  </span>
                  <Icon className="continue-row__arrow" name="chevron-right" size={14} />
                </button>
              ))}
            </div>
          ) : (
            <p className="continue-band__empty">创建项目或发送第一个任务后，可从这里继续。</p>
          )}
        </section>
      </section>
    </main>
  );
}
