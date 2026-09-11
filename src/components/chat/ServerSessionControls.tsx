import { useEffect, useMemo, useState } from 'react';
import type { ServerAgentSummary, ServerProvidersResult } from '../../../shared/ipc';
import { usePresence } from '../../hooks/usePresence';
import { presenceRootProps } from '../../lib/presence-ui';
import { Icon } from '../Icon';

export interface ServerSessionSelection {
  providerID: string;
  modelID: string;
  agent?: string;
}

interface ServerSessionControlsProps {
  serverId: string;
  serverName: string;
  sessionModelId?: string;
  value: ServerSessionSelection | null;
  onChange: (value: ServerSessionSelection) => void;
}

interface ModelOption {
  providerID: string;
  modelID: string;
  name: string;
}

type OpenMenu = 'model' | 'agent';

const MODEL_MENU_LIMIT = 60;

function splitModelId(modelId: string | undefined): { providerID: string; modelID: string } | null {
  if (!modelId) return null;
  const slash = modelId.indexOf('/');
  if (slash <= 0 || slash === modelId.length - 1) return null;
  return { providerID: modelId.slice(0, slash), modelID: modelId.slice(slash + 1) };
}

/** 同名模型跨 provider 时用 providerID 前缀消歧义。 */
function displayModelName(model: ModelOption, models: ModelOption[]): string {
  const name = model.name || model.modelID;
  const duplicated = models.some(
    (other) =>
      other.name === model.name
      && (other.providerID !== model.providerID || other.modelID !== model.modelID),
  );
  return duplicated ? `${model.providerID} · ${name}` : name;
}

/**
 * 服务器会话的模型 / Agent 控件：加载远端 providers（含默认）与 agents。
 * 模型默认取「会话已存 modelId → 服务器 default → 第一个模型」；Agent 默认 build（无 agents 时隐藏）。
 * 下拉复用审批模式菜单的样式化菜单模式（向上展开、点外部 / Escape 关闭）。
 */
export function ServerSessionControls(props: ServerSessionControlsProps) {
  const [providers, setProviders] = useState<ServerProvidersResult | null>(null);
  const [agents, setAgents] = useState<ServerAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const modelMenuOpen = openMenu === 'model';
  const agentMenuOpen = openMenu === 'agent';
  const modelPresence = usePresence(modelMenuOpen, 120);
  const agentPresence = usePresence(agentMenuOpen, 120);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProviders(null);
    setAgents([]);
    setOpenMenu(null);
    void (async () => {
      const api = window.electronAPI?.servers;
      if (!api) {
        if (!cancelled) setLoading(false);
        return;
      }
      const [providersResult, agentList] = await Promise.all([
        api.providers(props.serverId).catch(() => ({ providers: [] } as ServerProvidersResult)),
        api.agents(props.serverId).catch(() => [] as ServerAgentSummary[]),
      ]);
      if (cancelled) return;
      setProviders(providersResult);
      setAgents(agentList);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.serverId]);

  // 点外部 / Escape 关闭服务器模型 / Agent 下拉
  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.server-session-controls')) return;
      setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const models: ModelOption[] = useMemo(
    () =>
      (providers?.providers ?? []).flatMap((provider) =>
        provider.models.map((model) => ({
          providerID: provider.id,
          modelID: model.id,
          name: model.name,
        })),
      ),
    [providers],
  );

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (query === '') return models;
    return models.filter((model) => {
      const haystack = `${model.providerID} ${model.modelID} ${displayModelName(model, models)}`;
      return haystack.toLowerCase().includes(query);
    });
  }, [modelQuery, models]);

  const visibleModels = filteredModels.slice(0, MODEL_MENU_LIMIT);
  const hiddenModelCount = filteredModels.length - visibleModels.length;

  if (loading) {
    return (
      <span className="server-session-controls" data-state="loading" title={`${props.serverName}：正在加载模型…`}>
        <span className="server-session-badge">{props.serverName}</span>
        <button
          className="server-session-controls__model server-session-controls__trigger"
          type="button"
          aria-label="服务器模型"
          disabled
        >
          <span className="server-session-controls__trigger-label">加载模型…</span>
        </button>
      </span>
    );
  }

  if (models.length === 0) {
    return (
      <span className="server-session-controls" data-state="empty" title={`${props.serverName}：无可用模型`}>
        <span className="server-session-badge">{props.serverName}</span>
        <button
          className="server-session-controls__model server-session-controls__trigger"
          type="button"
          aria-label="服务器模型"
          disabled
        >
          <span className="server-session-controls__trigger-label">无可用模型</span>
        </button>
      </span>
    );
  }

  const hasModel = (
    candidate: { providerID: string; modelID: string } | null | undefined,
  ): candidate is { providerID: string; modelID: string } =>
    !!candidate && models.some(
      (model) => model.providerID === candidate.providerID && model.modelID === candidate.modelID,
    );

  const storedModel = splitModelId(props.sessionModelId);
  const defaultValue = providers?.default;
  const selectedModelRef = (hasModel(props.value) ? props.value : null)
    ?? (hasModel(storedModel) ? storedModel : null)
    ?? (hasModel(defaultValue) ? defaultValue : null)
    ?? models[0];
  const selectedModel = models.find(
    (model) =>
      model.providerID === selectedModelRef.providerID && model.modelID === selectedModelRef.modelID,
  ) ?? models[0];

  const agentNames = agents.map((agent) => agent.name);
  const defaultAgent = agentNames.includes('build') ? 'build' : agentNames[0];
  const selectedAgent = props.value?.agent && agentNames.includes(props.value.agent)
    ? props.value.agent
    : (defaultAgent ?? '');

  function commitModel(providerID: string, modelID: string) {
    props.onChange({
      providerID,
      modelID,
      ...(selectedAgent ? { agent: selectedAgent } : {}),
    });
  }

  function commitAgent(agent: string) {
    props.onChange({
      providerID: selectedModel.providerID,
      modelID: selectedModel.modelID,
      agent,
    });
  }

  return (
    <span className="server-session-controls" data-state="ready" title={props.serverName}>
      <span className="server-session-badge">{props.serverName}</span>
      <span className="server-session-controls__field">
        <button
          className="server-session-controls__model server-session-controls__trigger"
          type="button"
          aria-label="服务器模型"
          aria-haspopup="listbox"
          aria-expanded={modelMenuOpen}
          onClick={() => {
            if (modelMenuOpen) {
              setOpenMenu(null);
            } else {
              setModelQuery('');
              setOpenMenu('model');
            }
          }}
        >
          <span className="server-session-controls__trigger-label">
            {displayModelName(selectedModel, models)}
          </span>
          <Icon name="chevron-down" size={12} />
        </button>
        {modelPresence.mounted && (
          <div
            className="server-session-controls__menu"
            role="listbox"
            aria-label="服务器模型"
            {...presenceRootProps(modelPresence)}
          >
            <input
              className="server-session-controls__search"
              type="search"
              autoFocus
              placeholder="搜索模型…"
              aria-label="搜索模型"
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
            />
            {visibleModels.map((model) => {
              const active = model.providerID === selectedModel.providerID
                && model.modelID === selectedModel.modelID;
              return (
                <button
                  key={`${model.providerID}/${model.modelID}`}
                  className={`server-session-controls__item${active ? ' active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setOpenMenu(null);
                    commitModel(model.providerID, model.modelID);
                  }}
                >
                  {displayModelName(model, models)}
                </button>
              );
            })}
            {hiddenModelCount > 0 && (
              <div className="server-session-controls__more">
                还有 {hiddenModelCount} 个匹配，继续输入以筛选
              </div>
            )}
          </div>
        )}
      </span>
      {selectedAgent !== '' && (
        <span className="server-session-controls__field">
          <button
            className="server-session-controls__agent server-session-controls__trigger"
            type="button"
            aria-label="服务器 Agent"
            aria-haspopup="listbox"
            aria-expanded={agentMenuOpen}
            onClick={() => setOpenMenu(agentMenuOpen ? null : 'agent')}
          >
            <span className="server-session-controls__trigger-label">{selectedAgent}</span>
            <Icon name="chevron-down" size={12} />
          </button>
          {agentPresence.mounted && (
            <div
              className="server-session-controls__menu"
              role="listbox"
              aria-label="服务器 Agent"
              {...presenceRootProps(agentPresence)}
            >
              {agents.map((agent) => {
                const active = agent.name === selectedAgent;
                return (
                  <button
                    key={agent.name}
                    className={`server-session-controls__item${active ? ' active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setOpenMenu(null);
                      commitAgent(agent.name);
                    }}
                  >
                    {agent.name}
                  </button>
                );
              })}
            </div>
          )}
        </span>
      )}
    </span>
  );
}
