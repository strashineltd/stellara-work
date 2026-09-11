import { useEffect, useState, type ChangeEvent } from 'react';
import type { ServerAgentSummary, ServerProvidersResult } from '../../../shared/ipc';

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

function splitModelId(modelId: string | undefined): { providerID: string; modelID: string } | null {
  if (!modelId) return null;
  const slash = modelId.indexOf('/');
  if (slash <= 0 || slash === modelId.length - 1) return null;
  return { providerID: modelId.slice(0, slash), modelID: modelId.slice(slash + 1) };
}

/**
 * 服务器会话的模型 / Agent 控件：加载远端 providers（含默认）与 agents。
 * 模型默认取「会话已存 modelId → 服务器 default → 第一个模型」；Agent 默认 build（无 agents 时隐藏）。
 */
export function ServerSessionControls(props: ServerSessionControlsProps) {
  const [providers, setProviders] = useState<ServerProvidersResult | null>(null);
  const [agents, setAgents] = useState<ServerAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProviders(null);
    setAgents([]);
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

  if (loading) {
    return (
      <span className="server-session-controls" data-state="loading" title={`${props.serverName}：正在加载模型…`}>
        <select className="server-session-controls__model" aria-label="服务器模型" disabled>
          <option value="">加载模型…</option>
        </select>
      </span>
    );
  }

  const models: ModelOption[] = (providers?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ providerID: provider.id, modelID: model.id, name: model.name })),
  );

  if (models.length === 0) {
    return (
      <span className="server-session-controls" data-state="empty" title={`${props.serverName}：无可用模型`}>
        <select className="server-session-controls__model" aria-label="服务器模型" disabled>
          <option value="">无可用模型</option>
        </select>
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
  const selectedModel = (hasModel(props.value) ? props.value : null)
    ?? (hasModel(storedModel) ? storedModel : null)
    ?? (hasModel(defaultValue) ? defaultValue : null)
    ?? models[0];

  const agentNames = agents.map((agent) => agent.name);
  const defaultAgent = agentNames.includes('build') ? 'build' : agentNames[0];
  const selectedAgent = props.value?.agent && agentNames.includes(props.value.agent)
    ? props.value.agent
    : (defaultAgent ?? '');

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>) {
    const [providerID, ...rest] = event.target.value.split('/');
    const modelID = rest.join('/');
    if (!providerID || !modelID) return;
    props.onChange({
      providerID,
      modelID,
      ...(selectedAgent ? { agent: selectedAgent } : {}),
    });
  }

  function handleAgentChange(event: ChangeEvent<HTMLSelectElement>) {
    props.onChange({
      providerID: selectedModel.providerID,
      modelID: selectedModel.modelID,
      agent: event.target.value,
    });
  }

  return (
    <span className="server-session-controls" data-state="ready" title={props.serverName}>
      <select
        className="server-session-controls__model"
        aria-label="服务器模型"
        value={`${selectedModel.providerID}/${selectedModel.modelID}`}
        onChange={handleModelChange}
      >
        {models.map((model) => (
          <option
            key={`${model.providerID}/${model.modelID}`}
            value={`${model.providerID}/${model.modelID}`}
          >
            {model.name}
          </option>
        ))}
      </select>
      {selectedAgent !== '' && (
        <select
          className="server-session-controls__agent"
          aria-label="服务器 Agent"
          value={selectedAgent}
          onChange={handleAgentChange}
        >
          {agents.map((agent) => (
            <option key={agent.name} value={agent.name}>
              {agent.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
