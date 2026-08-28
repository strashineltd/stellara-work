import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, Root } from 'react-dom/client';
import { act, useInsertionEffect, useState } from 'react';
import { Header } from './Header';
import type { ConfiguredModel, ModelListItem } from '../../../shared/ipc';

const MODEL_CONFIG: ConfiguredModel = {
  id: 'deepseek-v4-pro',
  label: 'DeepSeek v4',
  model: 'deepseek-v4-pro',
  workDir: 'D:/test',
  hasKey: true,
  isCustom: false,
  baseUrl: 'https://api.deepseek.com',
  contextWindow: 128000,
};

const MODEL_LIST: ModelListItem[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek v4', model: 'deepseek-v4-pro', hasKey: true, baseUrl: 'https://api.deepseek.com', isActive: true, createdAt: '2026-01-01' },
  { id: 'glm-5.2', label: 'GLM-5', model: 'glm-5.2', hasKey: false, baseUrl: 'https://open.bigmodel.cn', isActive: false, createdAt: '2026-01-01' },
];

type HeaderProps = React.ComponentProps<typeof Header>;

interface MountedView {
  readonly container: HTMLDivElement;
  readonly root: Root;
}

const mountedViews = new Set<MountedView>();

function headerProps(overrides: Partial<HeaderProps> = {}): HeaderProps {
  return {
    config: MODEL_CONFIG,
    sidebarOpen: true,
    workspaceOpen: false,
    modelList: MODEL_LIST,
    switchingModel: false,
    busy: false,
    hasEntries: true,
    onToggleSidebar: vi.fn(),
    onToggleWorkspace: vi.fn(),
    onChangeWorkDir: vi.fn(),
    onOpenFileTree: vi.fn(),
    onOpenSettings: vi.fn(),
    onReconfigure: vi.fn(),
    onNewSession: vi.fn(),
    onNewTask: vi.fn(),
    onSwitchModel: vi.fn(),
    ...overrides,
  };
}

function render(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const view = { container, root };
  mountedViews.add(view);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    rerender: (nextUi: React.ReactElement) => {
      act(() => {
        root.render(nextUi);
      });
    },
    unmount: () => {
      if (!mountedViews.delete(view)) return;
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    getByText: (text: string | RegExp) => {
      const pattern = typeof text === 'string' ? text : text;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.textContent && (typeof pattern === 'string' ? node.textContent.includes(pattern) : pattern.test(node.textContent))) {
          return node.parentElement!;
        }
      }
      return null;
    },
    querySelector: (sel: string) => container.querySelector(sel),
    querySelectorAll: (sel: string) => container.querySelectorAll(sel),
  };
}

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  let props = headerProps(overrides);
  const view = render(<Header {...props} />);
  return {
    ...view,
    rerender: (nextOverrides: Partial<HeaderProps>) => {
      props = { ...props, ...nextOverrides };
      view.rerender(<Header {...props} />);
    },
  };
}

function fireClick(el: Element | null) {
  if (!el) throw new Error('Element not found for click');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function fireMouseDown(el: Element | null) {
  if (!el) throw new Error('Element not found for mousedown');
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

function fireEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function fireTransitionEnd(el: Element | null) {
  if (!el) throw new Error('Element not found for transitionend');
  act(() => {
    el.dispatchEvent(new Event('transitionend', { bubbles: true }));
  });
}

type MenuKind = 'model' | 'main';

function getMenuTrigger(container: HTMLElement, kind: MenuKind): HTMLButtonElement {
  const selector = kind === 'model' ? '.main-model' : 'button[aria-label="打开主菜单"]';
  const trigger = container.querySelector<HTMLButtonElement>(selector);
  if (!trigger) throw new Error(`${kind} menu trigger not found`);
  return trigger;
}

function getMenuRoot(container: HTMLElement, kind: MenuKind): HTMLElement | null {
  return container.querySelector(kind === 'model' ? '.model-switcher-menu' : '.header-menu');
}

function openMenu(container: HTMLElement, kind: MenuKind) {
  const trigger = getMenuTrigger(container, kind);
  fireClick(trigger);
  const menu = getMenuRoot(container, kind);
  if (!menu) throw new Error(`${kind} menu did not open`);
  return { menu, trigger };
}

type ModelInvalidation = 'switching' | 'config';

function InterleavedModelInvalidationHarness(props: {
  readonly destination: HTMLElement;
  readonly invalidation: ModelInvalidation;
}) {
  const [invalidated, setInvalidated] = useState(false);

  useInsertionEffect(() => {
    if (invalidated) props.destination.focus();
  }, [invalidated, props.destination]);

  return (
    <>
      <Header
        {...headerProps({
          config: props.invalidation === 'config' && invalidated ? null : MODEL_CONFIG,
          switchingModel: props.invalidation === 'switching' && invalidated,
        })}
      />
      <button aria-label="invalidate model trigger" onClick={() => setInvalidated(true)} type="button" />
    </>
  );
}

describe('Header', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    document.body.replaceChildren();
  });

  afterEach(() => {
    mountedViews.forEach(({ container, root }) => {
      act(() => root.unmount());
      container.remove();
    });
    mountedViews.clear();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders without throwing', () => {
    expect(() =>
      render(
        <Header
          config={MODEL_CONFIG}
          sidebarOpen={true}
          workspaceOpen={false}
          modelList={MODEL_LIST}
          switchingModel={false}
          busy={false}
          hasEntries={true}
          onToggleSidebar={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onChangeWorkDir={vi.fn()}
          onOpenFileTree={vi.fn()}
          onOpenSettings={vi.fn()}
          onReconfigure={vi.fn()}
          onNewSession={vi.fn()}
          onNewTask={vi.fn()}
          onSwitchModel={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  it('uses token-driven class name main-header', () => {
    const { querySelector } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const header = querySelector('.main-header');
    expect(header).toBeTruthy();
  });

  it('does not show product branding in the desktop header', () => {
    const { getByText, querySelector } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    expect(querySelector('[aria-label="Stellara Work"]')).toBeNull();
    expect(getByText('Stellara')).toBeNull();
    expect(getByText('WORKBENCH')).toBeNull();
  });

  it('does not use emoji glyphs in rendered HTML', () => {
    const { container } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it.each([
    ['model', 'model'],
    ['main', 'main'],
  ] as const)('retains the %s menu through root-only exit with logical disclosure state', (_label, kind) => {
    const { container } = renderHeader();
    const trigger = getMenuTrigger(container, kind);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    const { menu } = openMenu(container, kind);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('data-motion')).toBe('menu');
    expect(menu.getAttribute('data-side')).toBe('bottom');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');

    const child = menu.querySelector('button')!;
    child.focus();
    fireClick(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(container, kind)).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(trigger);

    fireTransitionEnd(child);
    expect(getMenuRoot(container, kind)).toBe(menu);
    fireTransitionEnd(menu);
    expect(getMenuRoot(container, kind)).toBeNull();
  });

  it.each([
    ['model', 'model'],
    ['main', 'main'],
  ] as const)('closes the %s menu on Escape and restores its durable trigger', (_label, kind) => {
    const { container } = renderHeader();
    const { menu, trigger } = openMenu(container, kind);
    menu.querySelector<HTMLElement>('button')?.focus();

    fireEscape();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(container, kind)).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(document.activeElement).toBe(trigger);
    fireTransitionEnd(menu);
  });

  it.each([
    ['model', 'model'],
    ['main', 'main'],
  ] as const)('lets a focusable outside pointer target own focus when closing the %s menu', (_label, kind) => {
    const outside = document.createElement('button');
    const nestedTarget = document.createElement('span');
    outside.appendChild(nestedTarget);
    document.body.appendChild(outside);
    const { container } = renderHeader();
    const { menu, trigger } = openMenu(container, kind);
    const triggerFocus = vi.spyOn(trigger, 'focus');
    menu.querySelector<HTMLElement>('button')?.focus();
    outside.focus();

    fireMouseDown(nestedTarget);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(container, kind)).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    fireTransitionEnd(menu);
  });

  it.each([
    ['model', 'model'],
    ['main', 'main'],
  ] as const)('restores the %s menu trigger after nonfocusable background dismissal', (_label, kind) => {
    const background = document.createElement('div');
    const nestedTarget = document.createElement('span');
    background.appendChild(nestedTarget);
    document.body.appendChild(background);
    const { container } = renderHeader();
    const { menu, trigger } = openMenu(container, kind);
    menu.querySelector<HTMLElement>('button')?.focus();

    fireMouseDown(nestedTarget);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(container, kind)).toBe(menu);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(trigger);
    fireTransitionEnd(menu);
  });

  it.each([
    ['model', 'model'],
    ['main', 'main'],
  ] as const)('rapidly reopens the retained %s menu without replacing its root', (_label, kind) => {
    const { container } = renderHeader();
    const { menu, trigger } = openMenu(container, kind);
    fireClick(trigger);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');

    fireClick(trigger);

    expect(getMenuRoot(container, kind)).toBe(menu);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('data-motion-state')).toBe('entering');
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(menu.getAttribute('aria-hidden')).toBeNull();
    fireTransitionEnd(menu);
    expect(getMenuRoot(container, kind)).toBe(menu);

    fireClick(trigger);
    fireTransitionEnd(menu);
    expect(getMenuRoot(container, kind)).toBeNull();
  });

  it.each([
    ['model', 'main'],
    ['main', 'model'],
  ] as const)('moves logical ownership from the %s menu to the %s menu', (firstKind, secondKind) => {
    const { container } = renderHeader();
    const first = openMenu(container, firstKind);
    first.menu.querySelector<HTMLElement>('button')?.focus();
    const firstTriggerFocus = vi.spyOn(first.trigger, 'focus');
    const secondTrigger = getMenuTrigger(container, secondKind);
    secondTrigger.focus();

    fireClick(secondTrigger);

    const secondMenu = getMenuRoot(container, secondKind)!;
    expect(first.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(first.menu.dataset.motionState).toBe('closing');
    expect(first.menu.hasAttribute('inert')).toBe(true);
    expect(firstTriggerFocus).not.toHaveBeenCalled();
    expect(secondTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(secondMenu.dataset.motionState).toBe('entering');
    expect(secondMenu.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(secondTrigger);

    fireEscape();

    expect(secondTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(secondMenu.dataset.motionState).toBe('closing');
    expect(secondMenu.hasAttribute('inert')).toBe(true);
    expect(firstTriggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(secondTrigger);
  });

  it('completes each closing menu only from that menu root', () => {
    const { container } = renderHeader();
    const model = openMenu(container, 'model');
    const main = openMenu(container, 'main');
    fireEscape();

    fireTransitionEnd(model.menu);

    expect(getMenuRoot(container, 'model')).toBeNull();
    expect(getMenuRoot(container, 'main')).toBe(main.menu);
    fireTransitionEnd(main.menu);
    expect(getMenuRoot(container, 'main')).toBeNull();
  });

  it('switches models immediately, closes ordinarily, and ignores retained commands while closing', () => {
    const events: string[] = [];
    const onSwitchModel = vi.fn(() => events.push('switch'));
    const { container } = renderHeader({ onSwitchModel });
    const { menu, trigger } = openMenu(container, 'model');
    const modelItem = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('GLM-5'),
    )!;
    modelItem.focus();

    fireClick(modelItem);

    expect(events).toEqual(['switch']);
    expect(onSwitchModel).toHaveBeenCalledWith('glm-5.2');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(document.activeElement).toBe(trigger);

    fireClick(modelItem);
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
    fireTransitionEnd(menu);
    expect(onSwitchModel).toHaveBeenCalledTimes(1);
  });

  it('closes an open model menu safely before paint when model switching begins', () => {
    const onOpenSettings = vi.fn();
    const view = renderHeader({ onOpenSettings });
    const { menu, trigger } = openMenu(view.container, 'model');
    const mainTrigger = getMenuTrigger(view.container, 'main');
    const settings = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('添加 / 管理模型'),
    )!;
    menu.querySelector<HTMLElement>('button')?.focus();

    view.rerender({ switchingModel: true });

    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(mainTrigger);
    fireClick(settings);
    expect(onOpenSettings).not.toHaveBeenCalled();

    view.rerender({ switchingModel: false });

    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    fireTransitionEnd(menu);
    expect(getMenuRoot(view.container, 'model')).toBeNull();
  });

  it('moves ordinary-close focus to a usable fallback if switching begins during exit', () => {
    const view = renderHeader();
    const { menu, trigger } = openMenu(view.container, 'model');
    const mainTrigger = getMenuTrigger(view.container, 'main');
    menu.querySelector<HTMLElement>('button')?.focus();

    fireEscape();

    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');

    view.rerender({ switchingModel: true });

    expect(trigger.disabled).toBe(true);
    expect(mainTrigger.disabled).toBe(false);
    expect(document.activeElement).toBe(mainTrigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['closing owner disabled', 'switching', true, true],
    ['closing owner removed', 'config', true, false],
    ['open owner disabled', 'switching', false, true],
  ] as const)('keeps a newer pre-layout destination when the %s', (_label, invalidation, closeFirst, triggerRemains) => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);
    const { container } = render(
      <InterleavedModelInvalidationHarness destination={destination} invalidation={invalidation} />,
    );
    const { menu, trigger } = openMenu(container, 'model');
    const menuItem = menu.querySelector<HTMLElement>('button')!;
    const mainTrigger = getMenuTrigger(container, 'main');
    menuItem.focus();

    if (closeFirst) {
      fireEscape();
      expect(document.activeElement).toBe(trigger);
      expect(menu.dataset.motionState).toBe('closing');
    } else {
      expect(document.activeElement).toBe(menuItem);
    }
    const mainTriggerFocus = vi.spyOn(mainTrigger, 'focus');

    fireClick(container.querySelector('[aria-label="invalidate model trigger"]'));

    expect(mainTriggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);
    expect(trigger.isConnected).toBe(triggerRemains);
    if (triggerRemains) expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(getMenuRoot(container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    fireTransitionEnd(menu);
    expect(document.activeElement).toBe(destination);
  });

  it('retains the exact model menu when config disappears while open without stale reopening', () => {
    const replacementConfig: ConfiguredModel = {
      ...MODEL_CONFIG,
      id: 'glm-5.2',
      label: 'GLM-5',
      model: 'glm-5.2',
    };
    const onOpenSettings = vi.fn();
    const onSwitchModel = vi.fn();
    const view = renderHeader({ onOpenSettings, onSwitchModel });
    const { menu } = openMenu(view.container, 'model');
    const child = menu.querySelector('button')!;
    const settings = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('添加 / 管理模型'),
    )!;
    const mainTrigger = getMenuTrigger(view.container, 'main');
    child.focus();

    view.rerender({ config: replacementConfig });

    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(getMenuTrigger(view.container, 'model').getAttribute('aria-expanded')).toBe('true');

    view.rerender({ config: null });

    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(view.container.querySelector('.main-model')).toBeNull();
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(menu.textContent).toContain('GLM-5');
    expect(document.activeElement).toBe(mainTrigger);
    fireClick(child);
    fireClick(settings);
    expect(onSwitchModel).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();

    view.rerender({ config: replacementConfig });

    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(getMenuTrigger(view.container, 'model').getAttribute('aria-expanded')).toBe('false');
    expect(menu.dataset.motionState).toBe('closing');
    fireTransitionEnd(child);
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    fireTransitionEnd(menu);
    expect(getMenuRoot(view.container, 'model')).toBeNull();
  });

  it('retains an already-closing model menu across config removal through its fallback', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const replacementConfig: ConfiguredModel = {
      ...MODEL_CONFIG,
      id: 'glm-5.2',
      label: 'GLM-5',
      model: 'glm-5.2',
    };
    const view = renderHeader();
    const { menu, trigger } = openMenu(view.container, 'model');
    const mainTrigger = getMenuTrigger(view.container, 'main');
    fireClick(trigger);
    expect(menu.dataset.motionState).toBe('closing');
    expect(document.activeElement).toBe(trigger);

    view.rerender({ config: null });

    expect(trigger.isConnected).toBe(false);
    expect(mainTrigger.disabled).toBe(false);
    expect(document.activeElement).toBe(mainTrigger);
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    view.rerender({ config: replacementConfig });

    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    expect(getMenuTrigger(view.container, 'model').getAttribute('aria-expanded')).toBe('false');
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    act(() => vi.advanceTimersByTime(169));
    expect(getMenuRoot(view.container, 'model')).toBe(menu);
    act(() => vi.advanceTimersByTime(1));
    expect(getMenuRoot(view.container, 'model')).toBeNull();
  });

  it('retains Settings destination focus when its callback synchronously removes config', () => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);

    function SettingsHarness() {
      const [config, setConfig] = useState<ConfiguredModel | null>(MODEL_CONFIG);
      return (
        <Header
          {...headerProps({
            config,
            onOpenSettings: () => {
              destination.focus();
              setConfig(null);
            },
          })}
        />
      );
    }

    const { container } = render(<SettingsHarness />);
    const { menu, trigger } = openMenu(container, 'model');
    const mainTrigger = getMenuTrigger(container, 'main');
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const mainTriggerFocus = vi.spyOn(mainTrigger, 'focus');
    const settings = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('添加 / 管理模型'),
    )!;
    settings.focus();

    fireClick(settings);

    expect(container.querySelector('.main-model')).toBeNull();
    expect(getMenuRoot(container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(mainTriggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);
    fireTransitionEnd(menu);
    expect(getMenuRoot(container, 'model')).toBeNull();
    expect(document.activeElement).toBe(destination);
  });

  it('hands model-selection focus through a synchronous switching rerender in order', () => {
    const events: string[] = [];
    let callbackActiveElement: Element | null = null;
    let callbackTriggerDisabled: boolean | null = null;

    function SwitchingHarness() {
      const [switchingModel, setSwitchingModel] = useState(false);
      return (
        <Header
          {...headerProps({
            switchingModel,
            onSwitchModel: () => {
              const currentTrigger = document.querySelector<HTMLButtonElement>('.main-model');
              events.push('callback');
              callbackActiveElement = document.activeElement;
              callbackTriggerDisabled = currentTrigger?.disabled ?? null;
              setSwitchingModel(true);
            },
          })}
        />
      );
    }

    const { container } = render(<SwitchingHarness />);
    const { menu, trigger } = openMenu(container, 'model');
    const mainTrigger = getMenuTrigger(container, 'main');
    const restoreModelFocus = trigger.focus.bind(trigger);
    const restoreMainFocus = mainTrigger.focus.bind(mainTrigger);
    vi.spyOn(trigger, 'focus').mockImplementation((options?: FocusOptions) => {
      events.push('model-focus');
      restoreModelFocus(options);
    });
    vi.spyOn(mainTrigger, 'focus').mockImplementation((options?: FocusOptions) => {
      events.push('fallback-focus');
      restoreMainFocus(options);
    });
    const modelItem = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('GLM-5'),
    )!;
    modelItem.focus();

    fireClick(modelItem);

    expect(events).toEqual(['model-focus', 'callback', 'fallback-focus']);
    expect(callbackActiveElement).toBe(trigger);
    expect(callbackTriggerDisabled).toBe(false);
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(mainTrigger);
    expect(getMenuRoot(container, 'model')).toBe(menu);
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    fireClick(modelItem);
    expect(events).toEqual(['model-focus', 'callback', 'fallback-focus']);
  });

  it('uses independent 120ms exit fallbacks for both menus', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderHeader();
    const model = openMenu(container, 'model');
    const main = openMenu(container, 'main');
    fireClick(main.trigger);

    act(() => vi.advanceTimersByTime(169));
    expect(getMenuRoot(container, 'model')).toBe(model.menu);
    expect(getMenuRoot(container, 'main')).toBe(main.menu);

    act(() => vi.advanceTimersByTime(1));
    expect(getMenuRoot(container, 'model')).toBeNull();
    expect(getMenuRoot(container, 'main')).toBeNull();
  });

  it('removes document listeners after both logical menu owners have registered them', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const view = renderHeader();
    openMenu(view.container, 'model');
    openMenu(view.container, 'main');
    const menuListeners = addEventListener.mock.calls.filter(
      ([type]) => type === 'mousedown' || type === 'keydown',
    );

    expect(menuListeners.filter(([type]) => type === 'mousedown')).toHaveLength(2);
    expect(menuListeners.filter(([type]) => type === 'keydown')).toHaveLength(2);
    view.unmount();

    menuListeners.forEach(([type, listener]) => {
      expect(removeEventListener).toHaveBeenCalledWith(type, listener);
    });
  });

  it('removes the model focus-ownership listener on unmount', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const view = renderHeader();
    const focusListeners = addEventListener.mock.calls.filter(([type]) => type === 'focusin');

    expect(focusListeners).toHaveLength(1);
    view.unmount();

    expect(removeEventListener).toHaveBeenCalledWith('focusin', focusListeners[0]![1]);
  });

  it('clears both Presence fallback timers when the Header unmounts while closing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const setTimeout = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout');
    const view = renderHeader();
    openMenu(view.container, 'model');
    const main = openMenu(view.container, 'main');
    fireClick(main.trigger);
    expect(setTimeout.mock.calls.filter(([, delay]) => delay === 170)).toHaveLength(2);
    const clearCount = clearTimeout.mock.calls.length;

    view.unmount();

    expect(clearTimeout.mock.calls).toHaveLength(clearCount + 2);
  });

  it('does not duplicate the persistent sidebar settings control in the header', () => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);
    const onOpenSettings = vi.fn(() => destination.focus());
    const { container } = renderHeader({ onOpenSettings });
    const settingsButtons = container.querySelectorAll('button[aria-label="打开设置"]');
    expect(settingsButtons.length).toBe(0);
    const { menu, trigger } = openMenu(container, 'model');
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const menuItem = Array.from(menu.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('添加 / 管理模型'),
    )!;
    menuItem.focus();
    fireClick(menuItem);

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(menuItem.isConnected).toBe(true);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(trigger.isConnected).toBe(true);
    expect(onOpenSettings).toHaveBeenCalledWith(undefined, trigger);
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);

    fireClick(menuItem);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    fireTransitionEnd(menu);
    expect(document.activeElement).toBe(destination);
  });

  it('passes the durable main-menu trigger to clear-task actions from the transient menu', () => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);
    const onNewTask = vi.fn(() => destination.focus());
    const { container } = renderHeader({ onNewTask });
    const { menu, trigger } = openMenu(container, 'main');
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const menuItem = Array.from(menu.querySelectorAll('.header-menu-item')).find(
      (item) => item.textContent?.includes('新任务'),
    ) as HTMLButtonElement;
    menuItem.focus();

    fireClick(menuItem);

    expect(menuItem.isConnected).toBe(true);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(trigger.isConnected).toBe(true);
    expect(onNewTask).toHaveBeenCalledWith(trigger);
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);

    fireClick(menuItem);
    expect(onNewTask).toHaveBeenCalledOnce();
    fireTransitionEnd(menu);
    expect(document.activeElement).toBe(destination);
  });

  it('passes the durable main-menu trigger to New Session from the transient menu', () => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);
    const onNewSession = vi.fn(() => {
      destination.focus();
      return true as const;
    });
    const { container } = renderHeader({ onNewSession });
    const { menu, trigger } = openMenu(container, 'main');
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const menuItem = Array.from(menu.querySelectorAll('.header-menu-item')).find(
      (item) => item.textContent?.includes('新建会话'),
    ) as HTMLButtonElement;
    menuItem.focus();

    fireClick(menuItem);

    expect(menuItem.isConnected).toBe(true);
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(trigger.isConnected).toBe(true);
    expect(onNewSession).toHaveBeenCalledWith(trigger);
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);

    fireClick(menuItem);
    expect(onNewSession).toHaveBeenCalledOnce();
    fireTransitionEnd(menu);
    expect(document.activeElement).toBe(destination);
  });

  it('restores the main-menu trigger when New Session opens no focus destination', () => {
    const { container } = renderHeader({ onNewSession: vi.fn() });
    const { menu, trigger } = openMenu(container, 'main');
    const menuItem = Array.from(menu.querySelectorAll('.header-menu-item')).find(
      (item) => item.textContent?.includes('新建会话'),
    ) as HTMLButtonElement;
    menuItem.focus();

    fireClick(menuItem);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(menu.dataset.motionState).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('transfers focus ownership to the onboarding action without restoring the menu trigger', () => {
    const destination = document.createElement('button');
    document.body.appendChild(destination);
    const onReconfigure = vi.fn(() => destination.focus());
    const { container } = renderHeader({ onReconfigure });
    const { menu, trigger } = openMenu(container, 'main');
    const triggerFocus = vi.spyOn(trigger, 'focus');
    const menuItem = Array.from(menu.querySelectorAll('.header-menu-item')).find(
      (item) => item.textContent?.includes('模型连接向导'),
    ) as HTMLButtonElement;
    menuItem.focus();

    fireClick(menuItem);

    expect(onReconfigure).toHaveBeenCalledOnce();
    expect(menu.getAttribute('data-motion-state')).toBe('closing');
    expect(triggerFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(destination);
    fireClick(menuItem);
    expect(onReconfigure).toHaveBeenCalledOnce();
    fireTransitionEnd(menu);
    expect(document.activeElement).toBe(destination);
  });

  it('toggles the workspace with synchronized disclosure semantics', () => {
    const onToggleWorkspace = vi.fn();
    const { container } = render(
      <Header
        config={MODEL_CONFIG}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={onToggleWorkspace}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={vi.fn()}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );

    const button = container.querySelector('button[aria-controls="workspace-panel"]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    fireClick(button);
    expect(onToggleWorkspace).toHaveBeenCalledOnce();
  });

  it('shows a "未配置模型" warning badge and opens settings when config is null', () => {
    const onOpenSettings = vi.fn();
    const { querySelector, getByText, container } = render(
      <Header
        config={null}
        sidebarOpen={true}
        workspaceOpen={false}
        modelList={MODEL_LIST}
        switchingModel={false}
        busy={false}
        hasEntries={true}
        onToggleSidebar={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onChangeWorkDir={vi.fn()}
        onOpenFileTree={vi.fn()}
        onOpenSettings={onOpenSettings}
        onReconfigure={vi.fn()}
        onNewSession={vi.fn()}
        onNewTask={vi.fn()}
        onSwitchModel={vi.fn()}
      />,
    );
    const badge = querySelector('.model-pill--missing');
    expect(badge).toBeTruthy();
    expect(getByText('未配置模型')).toBeTruthy();
    // 无模型时不渲染模型切换下拉
    expect(querySelector('.model-switcher-menu')).toBeNull();
    expect(querySelector('.main-model')).toBeNull();
    fireClick(badge);
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledWith();
    expect(container.innerHTML).not.toContain('aria-haspopup="listbox"');
  });
});
