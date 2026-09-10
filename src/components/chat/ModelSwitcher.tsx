import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import type { ConfiguredModel, ModelListItem } from '../../../shared/ipc';
import { usePresence } from '../../hooks/usePresence';
import { getPointerFocusTarget, restoreFocusTarget } from '../../lib/presence-ui';
import { Icon } from '../Icon';

export interface ModelSwitcherHandle {
  close: (restoreFocus?: boolean) => boolean;
}

interface ModelSwitcherProps {
  config: ConfiguredModel | null;
  modelList: ModelListItem[];
  switchingModel: boolean;
  onSwitchModel: (id: string) => void;
  onReconfigure: (returnFocus?: HTMLButtonElement | null) => void;
  /** 模型菜单打开前调用，供调用方先收起自己的菜单 */
  onWillOpen?: () => void;
  /** model trigger 不可用时的焦点回退目标 */
  focusFallbackRef?: RefObject<HTMLElement | null>;
  ref?: Ref<ModelSwitcherHandle>;
}

export function ModelSwitcher(props: ModelSwitcherProps) {
  const config = props.config;
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelPresence = usePresence(modelMenuOpen, 120);
  const modelSwitcherRef = useRef<HTMLSpanElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelMenuOpenRef = useRef(modelMenuOpen);
  const modelFocusOwnedRef = useRef(false);
  const retainedModelConfigRef = useRef<ConfiguredModel | null>(config);
  const retainedModelListRef = useRef<ModelListItem[]>(props.modelList);
  const modelTriggerUsable = config !== null && !props.switchingModel;

  if (config) {
    retainedModelConfigRef.current = config;
    retainedModelListRef.current = props.modelList;
  } else if (!modelPresence.mounted) {
    retainedModelConfigRef.current = null;
    retainedModelListRef.current = [];
  }
  const retainedModelConfig = retainedModelConfigRef.current;
  const retainedModelList = retainedModelListRef.current;

  modelMenuOpenRef.current = modelMenuOpen;

  function closeModelMenu(restoreFocus = true): boolean {
    if (!modelMenuOpenRef.current) return false;
    modelMenuOpenRef.current = false;
    if (restoreFocus) {
      restoreFocusTarget(modelTriggerRef.current, props.focusFallbackRef?.current ?? null);
    }
    setModelMenuOpen(false);
    return true;
  }

  function toggleModelMenu() {
    if (modelMenuOpenRef.current) {
      closeModelMenu();
      return;
    }
    props.onWillOpen?.();
    modelMenuOpenRef.current = true;
    setModelMenuOpen(true);
  }

  useImperativeHandle(props.ref, () => ({ close: closeModelMenu }));

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      modelFocusOwnedRef.current = event.target instanceof Node
        && Boolean(modelSwitcherRef.current?.contains(event.target));
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useLayoutEffect(() => {
    if (!modelTriggerUsable) {
      const activeElement = document.activeElement;
      const modelOwnsFocus = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && activeElement.isConnected
        ? Boolean(modelSwitcherRef.current?.contains(activeElement))
        : modelFocusOwnedRef.current;
      if (modelMenuOpenRef.current) {
        closeModelMenu(modelOwnsFocus);
      } else if (modelOwnsFocus) {
        restoreFocusTarget(modelTriggerRef.current, props.focusFallbackRef?.current ?? null);
      }
    }
  }, [modelTriggerUsable, modelMenuOpen]);

  // 点外部关闭 model 下拉
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.model-switcher')) return;
      closeModelMenu(getPointerFocusTarget(e.target) === null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModelMenu();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modelMenuOpen]);

  if (!config && !(modelPresence.mounted && retainedModelConfig)) return null;

  return (
    <span ref={modelSwitcherRef} className="model-switcher">
      {config && (
        <button
          ref={modelTriggerRef}
          className={`main-model ${modelMenuOpen ? 'open' : ''}`}
          onClick={toggleModelMenu}
          type="button"
          title={`${config.label} · ${config.model}（点击切换）`}
          disabled={props.switchingModel}
          aria-expanded={modelMenuOpen}
          aria-haspopup="listbox"
        >
          <span className="main-model-label">{config.label}</span>
          <Icon className="main-model-caret" name="chevron-down" size={13} />
        </button>
      )}
      {modelPresence.mounted && retainedModelConfig && (
        <div
          className="model-switcher-menu"
          role="listbox"
          data-motion="menu"
          data-motion-state={modelPresence.state}
          data-side="bottom"
          inert={modelPresence.state === 'closing' ? true : undefined}
          aria-hidden={modelPresence.state === 'closing' ? true : undefined}
          onTransitionEnd={modelPresence.completeExit}
        >
          {retainedModelList.length === 0 && <div className="empty-hint" role="status">还没有模型</div>}
          {retainedModelList.map((m) => (
            <button
              key={m.id}
              className={`model-switcher-item ${m.id === retainedModelConfig.id ? 'active' : ''} ${!m.hasKey ? 'no-key' : ''}`}
              onClick={() => {
                if (!closeModelMenu()) return;
                props.onSwitchModel(m.id);
              }}
              type="button"
              title={!m.hasKey ? '该 model 未配 API key' : m.model}
              disabled={props.switchingModel}
              role="option"
              aria-selected={m.id === retainedModelConfig.id}
            >
              <span className="model-switcher-item-name">{m.label}</span>
              <span className="model-switcher-item-meta">
                {m.id === retainedModelConfig.id && <span className="badge">活跃</span>}
                {!m.hasKey && <span className="badge-warn">无 key</span>}
              </span>
            </button>
          ))}
          <div className="model-switcher-footer">
            <button
              className="model-switcher-add"
              onClick={() => {
                const returnFocus = modelTriggerRef.current;
                if (!closeModelMenu(false)) return;
                props.onReconfigure(returnFocus);
              }}
              type="button"
            >
              添加 / 管理模型
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
