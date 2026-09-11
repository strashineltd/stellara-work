import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerAgentSummary, ServerProvidersResult } from '../../../shared/ipc';
import { ServerSessionControls } from './ServerSessionControls';

const PROVIDERS: ServerProvidersResult = {
  providers: [
    {
      id: 'p1',
      name: 'Provider One',
      models: [
        { id: 'm1', name: '模型一' },
        { id: 'm2', name: '模型二' },
      ],
    },
    {
      id: 'p2',
      name: 'Provider Two',
      models: [{ id: 'm3', name: '模型三' }],
    },
  ],
  default: { providerID: 'p1', modelID: 'm2' },
};

const AGENTS: ServerAgentSummary[] = [
  { name: 'build', mode: 'primary' },
  { name: 'plan', mode: 'primary' },
];

function installApi(providers: ServerProvidersResult = PROVIDERS, agents: ServerAgentSummary[] = AGENTS) {
  const servers = {
    providers: vi.fn().mockResolvedValue(providers),
    agents: vi.fn().mockResolvedValue(agents),
  };
  (window as any).electronAPI = { servers };
  return servers;
}

function fireClick(element: Element | null) {
  if (!element) throw new Error('Element not found for click');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function firePointerDown(element: Element | Document) {
  act(() => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
}

function fireEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

function fireTransitionEnd(element: Element | null) {
  if (!element) throw new Error('Element not found for transitionend');
  act(() => {
    element.dispatchEvent(new Event('transitionend', { bubbles: true }));
  });
}

function menuItem(menu: HTMLElement | null, text: string): HTMLButtonElement {
  const item = Array.from(
    menu?.querySelectorAll<HTMLButtonElement>('.server-session-controls__item') ?? [],
  ).find((element) => element.textContent?.includes(text));
  if (!item) throw new Error(`menu item not found: ${text}`);
  return item;
}

async function renderControls(overrides: Partial<React.ComponentProps<typeof ServerSessionControls>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const onChange = vi.fn();
  let props: React.ComponentProps<typeof ServerSessionControls> = {
    serverId: 'srv-1',
    serverName: '本地服务器',
    value: null,
    onChange,
    ...overrides,
  };
  await act(async () => {
    root.render(<ServerSessionControls {...props} />);
  });
  return {
    container,
    onChange,
    rerender: async (next: Partial<React.ComponentProps<typeof ServerSessionControls>>) => {
      props = { ...props, ...next };
      await act(async () => {
        root.render(<ServerSessionControls {...props} />);
      });
    },
    model: () => container.querySelector<HTMLButtonElement>('.server-session-controls__model'),
    agent: () => container.querySelector<HTMLButtonElement>('.server-session-controls__agent'),
    modelMenu: () =>
      container.querySelector<HTMLElement>('[role="listbox"][aria-label="服务器模型"]'),
    agentMenu: () =>
      container.querySelector<HTMLElement>('[role="listbox"][aria-label="服务器 Agent"]'),
    openModelMenu: () => fireClick(container.querySelector('.server-session-controls__model')),
    openAgentMenu: () => fireClick(container.querySelector('.server-session-controls__agent')),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('ServerSessionControls', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('loads providers and agents and defaults to the server default model and build agent', async () => {
    const servers = installApi();
    const { model, agent, modelMenu, openModelMenu, unmount } = await renderControls();

    expect(servers.providers).toHaveBeenCalledWith('srv-1');
    expect(servers.agents).toHaveBeenCalledWith('srv-1');
    expect(model()?.textContent?.trim()).toBe('模型二');
    expect(model()?.disabled).toBe(false);
    openModelMenu();
    expect(modelMenu()?.textContent).toContain('模型一');
    expect(modelMenu()?.textContent).toContain('模型三');
    expect(agent()?.textContent?.trim()).toBe('build');
    unmount();
  });

  it('shows the server name as a visible badge', async () => {
    installApi();
    const { container, unmount } = await renderControls();

    expect(container.querySelector('.server-session-badge')?.textContent).toBe('本地服务器');
    unmount();
  });

  it('prefers the session-stored model over the server default', async () => {
    installApi();
    const { model, unmount } = await renderControls({ sessionModelId: 'p2/m3' });

    expect(model()?.textContent?.trim()).toBe('模型三');
    unmount();
  });

  it('uses the controlled value when provided and marks it selected', async () => {
    installApi();
    const { model, agent, modelMenu, openModelMenu, unmount } = await renderControls({
      value: { providerID: 'p2', modelID: 'm3', agent: 'plan' },
    });

    expect(model()?.textContent?.trim()).toBe('模型三');
    expect(agent()?.textContent?.trim()).toBe('plan');
    openModelMenu();
    expect(menuItem(modelMenu(), '模型三').getAttribute('aria-selected')).toBe('true');
    expect(menuItem(modelMenu(), '模型一').getAttribute('aria-selected')).toBe('false');
    unmount();
  });

  it('ignores a controlled agent that the server no longer exposes', async () => {
    installApi();
    const { agent, agentMenu, openAgentMenu, unmount } = await renderControls({
      value: { providerID: 'p1', modelID: 'm1', agent: 'ghost' },
    });

    expect(agent()?.textContent?.trim()).toBe('build');
    openAgentMenu();
    expect(menuItem(agentMenu(), 'build').getAttribute('aria-selected')).toBe('true');
    expect(agentMenu()?.textContent).not.toContain('ghost');
    unmount();
  });

  it('falls back to the first model when the server has no default', async () => {
    installApi({
      providers: [{ id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: '模型一' }] }],
    });
    const { model, unmount } = await renderControls();

    expect(model()?.textContent?.trim()).toBe('模型一');
    unmount();
  });

  it('disambiguates duplicate model names with the provider id', async () => {
    installApi({
      providers: [
        { id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: '共享模型' }] },
        { id: 'p2', name: 'Provider Two', models: [{ id: 'm2', name: '共享模型' }] },
      ],
      default: { providerID: 'p1', modelID: 'm1' },
    });
    const { model, modelMenu, openModelMenu, unmount } = await renderControls();

    expect(model()?.textContent?.trim()).toBe('p1 · 共享模型');
    openModelMenu();
    expect(modelMenu()?.textContent).toContain('p1 · 共享模型');
    expect(modelMenu()?.textContent).toContain('p2 · 共享模型');
    unmount();
  });

  it('reports model switches with the current agent', async () => {
    installApi();
    const { model, modelMenu, onChange, openModelMenu, unmount } = await renderControls();

    openModelMenu();
    fireClick(menuItem(modelMenu(), '模型一'));

    expect(onChange).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm1', agent: 'build' });
    expect(model()?.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('reports agent switches with the current model', async () => {
    installApi();
    const { agent, agentMenu, onChange, openAgentMenu, unmount } = await renderControls();

    openAgentMenu();
    fireClick(menuItem(agentMenu(), 'plan'));

    expect(onChange).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm2', agent: 'plan' });
    expect(agent()?.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('closes the model menu on outside pointerdown', async () => {
    installApi();
    const { model, modelMenu, openModelMenu, unmount } = await renderControls();

    openModelMenu();
    const menu = modelMenu();
    expect(menu).not.toBeNull();

    firePointerDown(document.body);

    expect(menu!.getAttribute('data-motion-state')).toBe('closing');
    fireTransitionEnd(menu);
    expect(modelMenu()).toBeNull();
    expect(model()?.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('closes the model menu on Escape', async () => {
    installApi();
    const { model, modelMenu, openModelMenu, unmount } = await renderControls();

    openModelMenu();
    const menu = modelMenu();
    expect(menu).not.toBeNull();

    fireEscape();

    expect(menu!.getAttribute('data-motion-state')).toBe('closing');
    fireTransitionEnd(menu);
    expect(modelMenu()).toBeNull();
    expect(model()?.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('does not double-handle a pointerdown on the trigger', async () => {
    installApi();
    const { model, modelMenu, unmount } = await renderControls();
    const trigger = model();

    firePointerDown(trigger!);
    fireClick(trigger);
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');
    expect(modelMenu()).not.toBeNull();

    firePointerDown(trigger!);
    fireClick(trigger);
    expect(trigger!.getAttribute('aria-expanded')).toBe('false');
    unmount();
  });

  it('hides the agent dropdown when the server exposes no agents', async () => {
    installApi(PROVIDERS, []);
    const { model, agent, unmount } = await renderControls();

    expect(agent()).toBeNull();
    expect(model()?.textContent?.trim()).toBe('模型二');
    unmount();
  });

  it('shows a disabled placeholder when providers are empty', async () => {
    installApi({ providers: [] });
    const { container, model, agent, modelMenu, openModelMenu, unmount } = await renderControls();

    expect(model()?.disabled).toBe(true);
    openModelMenu();
    expect(modelMenu()).toBeNull();
    expect(container.textContent).toContain('无可用模型');
    expect(agent()).toBeNull();
    unmount();
  });

  it('shows a disabled loading placeholder until providers resolve', async () => {
    (window as any).electronAPI = {
      servers: {
        providers: vi.fn().mockReturnValue(new Promise(() => {})),
        agents: vi.fn().mockResolvedValue([]),
      },
    };
    const { container, model, unmount } = await renderControls();

    expect(model()?.disabled).toBe(true);
    expect(container.textContent).toContain('加载');
    expect(container.querySelector('.server-session-badge')?.textContent).toBe('本地服务器');
    unmount();
  });

  it('reloads providers and agents when the server changes', async () => {
    const servers = installApi();
    const { rerender, unmount } = await renderControls();

    await rerender({ serverId: 'srv-2' });

    expect(servers.providers).toHaveBeenCalledWith('srv-2');
    expect(servers.agents).toHaveBeenCalledWith('srv-2');
    unmount();
  });
});
