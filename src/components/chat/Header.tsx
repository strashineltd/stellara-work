import { useEffect, useState } from 'react';
import type { ModelConfig, ModelListItem } from '../../../shared/ipc';
import { basename } from '../../lib/chat-utils';
import { Icon } from '../Icon';

const brandIconUrl = new URL('../../../assets/icon-256.png', import.meta.url).href;

interface HeaderProps {
  config: ModelConfig;
  sidebarOpen: boolean;
  workspaceOpen: boolean;
  modelList: ModelListItem[];
  /** Header 自己的 state：model 下拉、menu 下拉、是否在切换 model */
  switchingModel: boolean;
  busy: boolean;
  hasEntries: boolean;
  workDir?: string;
  projectName?: string;
  onToggleSidebar: () => void;
  onToggleWorkspace: () => void;
  onChooseProject?: () => void;
  /** @deprecated Kept for older component integrations; projects own directories now. */
  onChangeWorkDir?: () => void;
  onOpenFileTree: () => void;
  onOpenSettings: () => void;
  onReconfigure: () => void;
  onNewSession: () => void;
  onNewTask: () => void;
  onSwitchModel: (id: string) => void;
}

/**
 * 顶部 bar：sidebar toggle / 工作目录 / model 切换 / workspace toggle / file tree / 菜单
 */
export function Header(props: HeaderProps) {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const effectiveWorkDir = props.workDir ?? props.config.workDir;

  // 点外部关闭 model 下拉
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.model-switcher')) return;
      setModelMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.header-menu-wrap')) return;
      setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="main-header">
      <div className="main-header-left">
        <div className="header-product" aria-label="Stellara Work">
          <img className="header-product-mark" src={brandIconUrl} alt="" />
          <span>Stellara Work</span>
          <Icon className="header-product-caret" name="chevron-down" size={12} />
        </div>
        <button
          className="btn-icon sidebar-toggle"
          onClick={props.onToggleSidebar}
          type="button"
          title={props.sidebarOpen ? '隐藏会话列表' : '显示会话列表'}
          aria-label={props.sidebarOpen ? '隐藏会话列表' : '显示会话列表'}
          aria-pressed={props.sidebarOpen}
        >
          <Icon name="panel-left" />
        </button>
      </div>

      <div className="main-header-center">
        <button
          className="main-workdir"
          onClick={props.onChooseProject ?? props.onChangeWorkDir}
          title={effectiveWorkDir ?? '创建项目并选择入口文件'}
          type="button"
        >
          <Icon name="folder" size={15} />
          <span className="main-workdir-name">
            {props.projectName ?? (effectiveWorkDir ? basename(effectiveWorkDir) : '选择项目…')}
          </span>
        </button>
        <span className="model-switcher">
          <button
            className={`main-model ${modelMenuOpen ? 'open' : ''}`}
            onClick={() => setModelMenuOpen((v) => !v)}
            type="button"
            title={`${props.config.label} · ${props.config.model}（点击切换）`}
            disabled={props.switchingModel}
            aria-expanded={modelMenuOpen}
            aria-haspopup="listbox"
          >
            <span className="main-model-label">{props.config.label}</span>
            <Icon className="main-model-caret" name="chevron-down" size={13} />
          </button>
          {modelMenuOpen && (
            <div className="model-switcher-menu" role="listbox">
              {props.modelList.length === 0 && <div className="empty-hint" role="status">还没有模型</div>}
              {props.modelList.map((m) => (
                <button
                  key={m.id}
                  className={`model-switcher-item ${m.id === props.config.id ? 'active' : ''} ${!m.hasKey ? 'no-key' : ''}`}
                  onClick={() => void props.onSwitchModel(m.id)}
                  type="button"
                  title={!m.hasKey ? '该 model 未配 API key' : m.model}
                  disabled={props.switchingModel}
                  role="option"
                  aria-selected={m.id === props.config.id}
                >
                  <span className="model-switcher-item-name">{m.label}</span>
                  <span className="model-switcher-item-meta">
                    {m.id === props.config.id && <span className="badge">活跃</span>}
                    {!m.hasKey && <span className="badge-warn">无 key</span>}
                  </span>
                </button>
              ))}
              <div className="model-switcher-footer">
                <button
                  className="model-switcher-add"
                  onClick={() => { setModelMenuOpen(false); props.onOpenSettings(); }}
                  type="button"
                >
                  添加 / 管理模型
                </button>
              </div>
            </div>
          )}
        </span>
      </div>

      <div className="main-header-right">
        {effectiveWorkDir && (
          <button
            className={`btn-icon workspace-toggle ${props.workspaceOpen ? 'open' : ''}`}
            onClick={props.onToggleWorkspace}
            type="button"
            title={props.workspaceOpen ? '隐藏工作区' : '显示工作区'}
            aria-label={props.workspaceOpen ? '隐藏工作区' : '显示工作区'}
            aria-pressed={props.workspaceOpen}
            aria-expanded={props.workspaceOpen}
            aria-controls="workspace-panel"
          >
            <Icon name="panel-right" />
          </button>
        )}
        {effectiveWorkDir && (
          <button
            className="btn-icon"
            onClick={props.onOpenFileTree}
            type="button"
            title="浏览文件"
            aria-label="浏览文件"
          >
            <Icon name="file-tree" />
          </button>
        )}
        <div className="header-menu-wrap">
          <button
            className="btn-icon"
            onClick={() => setMenuOpen((o) => !o)}
            title="菜单"
            aria-label="打开主菜单"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            type="button"
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="header-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onNewTask(); }}
                type="button"
                disabled={props.busy || !props.hasEntries}
                title={!props.hasEntries ? '当前没有任务' : '清空聊天历史，开新任务'}
                role="menuitem"
              >
                新任务（清空当前）
              </button>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onNewSession(); }}
                type="button"
                title="新建一个会话"
                role="menuitem"
              >
                新建会话
              </button>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onReconfigure(); }}
                type="button"
                title="切换模型或更新 API key"
                role="menuitem"
              >
                模型连接向导
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
