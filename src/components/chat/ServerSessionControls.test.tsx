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

function selectOption(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error('select not found');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
    model: () => container.querySelector<HTMLSelectElement>('.server-session-controls__model'),
    agent: () => container.querySelector<HTMLSelectElement>('.server-session-controls__agent'),
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
    const { model, agent, unmount } = await renderControls();

    expect(servers.providers).toHaveBeenCalledWith('srv-1');
    expect(servers.agents).toHaveBeenCalledWith('srv-1');
    expect(model()?.value).toBe('p1/m2');
    expect(model()?.textContent).toContain('模型一');
    expect(model()?.textContent).toContain('模型三');
    expect(agent()?.value).toBe('build');
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

    expect(model()?.value).toBe('p2/m3');
    unmount();
  });

  it('uses the controlled value when provided', async () => {
    installApi();
    const { model, agent, unmount } = await renderControls({
      value: { providerID: 'p2', modelID: 'm3', agent: 'plan' },
    });

    expect(model()?.value).toBe('p2/m3');
    expect(agent()?.value).toBe('plan');
    unmount();
  });

  it('ignores a controlled agent that the server no longer exposes', async () => {
    installApi();
    const { agent, unmount } = await renderControls({
      value: { providerID: 'p1', modelID: 'm1', agent: 'ghost' },
    });

    expect(agent()?.value).toBe('build');
    unmount();
  });

  it('falls back to the first model when the server has no default', async () => {
    installApi({
      providers: [{ id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: '模型一' }] }],
    });
    const { model, unmount } = await renderControls();

    expect(model()?.value).toBe('p1/m1');
    unmount();
  });

  it('reports model switches with the current agent', async () => {
    installApi();
    const { model, onChange, unmount } = await renderControls();

    selectOption(model(), 'p1/m1');

    expect(onChange).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm1', agent: 'build' });
    unmount();
  });

  it('reports agent switches with the current model', async () => {
    installApi();
    const { agent, onChange, unmount } = await renderControls();

    selectOption(agent(), 'plan');

    expect(onChange).toHaveBeenCalledWith({ providerID: 'p1', modelID: 'm2', agent: 'plan' });
    unmount();
  });

  it('hides the agent dropdown when the server exposes no agents', async () => {
    installApi(PROVIDERS, []);
    const { model, agent, unmount } = await renderControls();

    expect(agent()).toBeNull();
    expect(model()?.value).toBe('p1/m2');
    unmount();
  });

  it('shows a disabled placeholder when providers are empty', async () => {
    installApi({ providers: [] });
    const { container, model, agent, unmount } = await renderControls();

    expect(model()?.disabled).toBe(true);
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
