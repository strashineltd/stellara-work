import { useEffect, useState } from 'react';
import type { ModelConfig, ModelListItem } from '../../../shared/ipc';
import { basename } from '../../lib/chat-utils';

interface HeaderProps {
  config: ModelConfig;
  sidebarOpen: boolean;
  workspaceOpen: boolean;
  modelList: ModelListItem[];
  /** Header 自己的 state：model 下拉、menu 下拉、是否在切换 model */
  switchingModel: boolean;
  busy: boolean;
  hasEntries: boolean;
  onToggleSidebar: () => void;
  onToggleWorkspace: () => void;
  onChangeWorkDir: () => void;
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

  return (
    <header className="main-header">
      <div className="main-header-left">
        <button
          className="btn-icon sidebar-toggle"
          onClick={props.onToggleSidebar}
          type="button"
          title={props.sidebarOpen ? '隐藏会话列表' : '显示会话列表'}
          aria-label={props.sidebarOpen ? '隐藏会话列表' : '显示会话列表'}
        >
          {props.sidebarOpen ? '‹' : '›'}
        </button>
      </div>

      <div className="main-header-center">
        <button
          className="main-workdir"
          onClick={props.onChangeWorkDir}
          title={props.config.workDir ?? '点击选择工作目录'}
          type="button"
        >
          <span className="main-workdir-name">
            {props.config.workDir ? basename(props.config.workDir) : '选择工作目录…'}
          </span>
        </button>
        <span className="model-switcher">
          <button
            className={`main-model ${modelMenuOpen ? 'open' : ''}`}
            onClick={() => setModelMenuOpen((v) => !v)}
            type="button"
            title={`${props.config.label} · ${props.config.model}（点击切换）`}
            disabled={props.switchingModel}
          >
            <span className="main-model-label">{props.config.label}</span>
            <span className="main-model-caret" aria-hidden="true">▾</span>
          </button>
          {modelMenuOpen && (
            <div className="model-switcher-menu" role="listbox">
              {props.modelList.length === 0 && <div className="empty-hint">还没有 model</div>}
              {props.modelList.map((m) => (
                <button
                  key={m.id}
                  className={`model-switcher-item ${m.id === props.config.id ? 'active' : ''} ${!m.hasKey ? 'no-key' : ''}`}
                  onClick={() => void props.onSwitchModel(m.id)}
                  type="button"
                  title={!m.hasKey ? '该 model 未配 API key' : m.model}
                  disabled={props.switchingModel}
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
        {props.config.workDir && (
          <button
            className={`btn-icon workspace-toggle ${props.workspaceOpen ? 'open' : ''}`}
            onClick={props.onToggleWorkspace}
            type="button"
            title={props.workspaceOpen ? '隐藏工作区' : '显示工作区'}
            aria-label={props.workspaceOpen ? '隐藏工作区' : '显示工作区'}
          >
            WS
          </button>
        )}
        {props.config.workDir && (
          <button
            className="btn-icon"
            onClick={props.onOpenFileTree}
            type="button"
            title="浏览文件（弹窗）"
            aria-label="浏览文件"
          >
            FT
          </button>
        )}
        <div className="header-menu-wrap">
          <button
            className="btn-icon"
            onClick={() => setMenuOpen((o) => !o)}
            title="菜单"
            type="button"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="header-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onNewTask(); }}
                type="button"
                disabled={props.busy || !props.hasEntries}
                title={!props.hasEntries ? '当前没有任务' : '清空聊天历史，开新任务'}
              >
                新任务（清空当前）
              </button>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onNewSession(); }}
                type="button"
                title="新建一个会话"
              >
                新建会话
              </button>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onReconfigure(); }}
                type="button"
                title="切换模型 / 改 API key / 改工作目录"
              >
                重新配置
              </button>
              <button
                className="header-menu-item"
                onClick={() => { setMenuOpen(false); props.onOpenSettings(); }}
                type="button"
                title="Providers / Sessions / App 设置"
              >
                设置
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}