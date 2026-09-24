import type { ReactNode } from 'react';
import { Icon } from '../Icon';

interface AppTopBarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  sidebarOpen: boolean;
  workspaceOpen: boolean;
  onToggleSidebar: () => void;
  onToggleWorkspace: () => void;
  /** Plan 2 注入服务器选择器；缺省渲染静态「本地」chip */
  executionTarget?: ReactNode;
}

export function AppTopBar(props: AppTopBarProps) {
  return (
    <header className="app-topbar" aria-label="应用工具栏">
      <div className="app-topbar__nav" role="group" aria-label="历史导航">
        <button className="btn-icon app-topbar__nav-button" type="button" aria-label="后退" disabled={!props.canGoBack} onClick={props.onBack}>
          <Icon name="chevron-left" size={15} />
        </button>
        <button className="btn-icon app-topbar__nav-button" type="button" aria-label="前进" disabled={!props.canGoForward} onClick={props.onForward}>
          <Icon name="chevron-right" size={15} />
        </button>
      </div>
      <div className="app-topbar__center" aria-hidden="true" />
      <div className="app-topbar__actions" role="group" aria-label="工作区控制">
        {props.executionTarget ?? (
          <span className="execution-target-chip">
            <Icon name="server" size={13} />
            本地
          </span>
        )}
        <button
          className="btn-icon app-topbar__action-button"
          type="button"
          data-panel-toggle="sidebar"
          aria-label={props.sidebarOpen ? '隐藏侧栏' : '显示侧栏'}
          aria-pressed={props.sidebarOpen}
          onClick={props.onToggleSidebar}
        >
          <Icon name="panel-left" size={15} />
        </button>
        <button
          className="btn-icon app-topbar__action-button"
          type="button"
          data-panel-toggle="workspace"
          aria-label={props.workspaceOpen ? '隐藏工作区' : '显示工作区'}
          aria-pressed={props.workspaceOpen}
          onClick={props.onToggleWorkspace}
        >
          <Icon name="panel-right" size={15} />
        </button>
      </div>
    </header>
  );
}
