import { useEffect, useRef, useState } from 'react';
import type { ConfiguredModel, ModelListItem } from '../../../shared/ipc';
import { usePresence } from '../../hooks/usePresence';
import { basename } from '../../lib/chat-utils';
import { getPointerFocusTarget } from '../../lib/presence-ui';
import { Icon } from '../Icon';
import type { OpenSettings } from '../SettingsPanel';
import { ModelSwitcher, type ModelSwitcherHandle } from './ModelSwitcher';

interface HeaderProps {
  config: ConfiguredModel | null;
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
  onOpenSettings: OpenSettings;
  onReconfigure: () => void;
  onNewSession: (returnFocus?: HTMLElement | null) => true | void;
  onNewTask: (returnFocus?: HTMLElement | null) => void;
  onSwitchModel: (id: string) => void;
}

/**
 * 顶部 bar：sidebar toggle / 工作目录 / model 切换 / workspace toggle / file tree / 菜单
 */
export function Header(props: HeaderProps) {
  const config = props.config;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPresence = usePresence(menuOpen, 120);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuOpenRef = useRef(menuOpen);
  const modelSwitcherRef = useRef<ModelSwitcherHandle>(null);
  const effectiveWorkDir = props.workDir ?? config?.workDir;

  menuOpenRef.current = menuOpen;

  function closeMenu(restoreFocus = true): boolean {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    if (restoreFocus) menuTriggerRef.current?.focus({ preventScroll: true });
    setMenuOpen(false);
    return true;
  }

  function toggleMenu() {
    if (menuOpenRef.current) {
      closeMenu();
      return;
    }
    modelSwitcherRef.current?.close(false);
    menuOpenRef.current = true;
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.header-menu-wrap')) return;
      closeMenu(getPointerFocusTarget(e.target) === null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
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
        <ModelSwitcher
          ref={modelSwitcherRef}
          config={config}
          modelList={props.modelList}
          switchingModel={props.switchingModel}
          onSwitchModel={props.onSwitchModel}
          onReconfigure={(returnFocus) => props.onOpenSettings(undefined, returnFocus)}
          onWillOpen={() => {
            closeMenu(false);
          }}
          focusFallbackRef={menuTriggerRef}
        />
        {!config && (
          <button
            className="model-pill model-pill--missing"
            onClick={() => props.onOpenSettings()}
            type="button"
            title="尚未配置模型，点击前往设置"
          >
            <Icon name="alert" size={13} />
            <span>未配置模型</span>
          </button>
        )}
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
            ref={menuTriggerRef}
            className="btn-icon"
            onClick={toggleMenu}
            title="菜单"
            aria-label="打开主菜单"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            type="button"
          >
            <Icon name="more" />
          </button>
          {menuPresence.mounted && (
            <div
              className="header-menu"
              role="menu"
              data-motion="menu"
              data-motion-state={menuPresence.state}
              data-side="bottom"
              inert={menuPresence.state === 'closing' ? true : undefined}
              aria-hidden={menuPresence.state === 'closing' ? true : undefined}
              onTransitionEnd={menuPresence.completeExit}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="header-menu-item"
                onClick={() => {
                  const returnFocus = menuTriggerRef.current;
                  if (!closeMenu(false)) return;
                  props.onNewTask(returnFocus);
                }}
                type="button"
                disabled={props.busy || !props.hasEntries}
                title={!props.hasEntries ? '当前没有任务' : '清空聊天历史，开新任务'}
                role="menuitem"
              >
                新任务（清空当前）
              </button>
              <button
                className="header-menu-item"
                onClick={() => {
                  const returnFocus = menuTriggerRef.current;
                  if (!closeMenu(false)) return;
                  const destinationOwnsFocus = props.onNewSession(returnFocus) === true;
                  if (!destinationOwnsFocus) returnFocus?.focus({ preventScroll: true });
                }}
                type="button"
                title="新建一个会话"
                role="menuitem"
              >
                新建会话
              </button>
              <button
                className="header-menu-item"
                onClick={() => {
                  if (!closeMenu(false)) return;
                  props.onReconfigure();
                }}
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
