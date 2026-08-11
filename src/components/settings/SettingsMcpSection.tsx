import { useEffect, useState } from 'react';
import type { McpServerConfig, McpTestResult, McpToolInfo } from '../../../shared/ipc';
import { Icon } from '../Icon';

interface SettingsMcpSectionProps {
  /** 设置变更后通知 SettingsWindow（跨窗口同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 解析参数输入：支持 "双引号" / '单引号' 分组（引号内空格不拆分），空段自动忽略
 */
function parseArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/**
 * 设置窗口「技能与 MCP」面板的 MCP 区块：服务器列表（传输徽章 / 启用开关 / 删除确认 / 展开工具白名单勾选），
 * 折叠式添加表单（stdio → command+args，http → url）+ 测试连接（结果 tools 缓存用于勾选回显）。
 * 白名单语义：tools 空数组 = 默认启用全部工具；勾选变化即时 mcp.update 保存。
 */
export function SettingsMcpSection({ onChanged, refreshKey = 0 }: SettingsMcpSectionProps) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const [toolErrors, setToolErrors] = useState<Record<string, string>>({});
  /** 展开区测试连接得到的工具列表缓存（本会话有效） */
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolInfo[]>>({});
  /** 勾选状态：null = 默认全选（tools 存 []）；Set = 白名单 */
  const [checkedByServer, setCheckedByServer] = useState<Record<string, Set<string> | null>>({});

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const list = await window.electronAPI.mcp.list();
        setServers(list);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshKey]);

  function toggleEnabled(server: McpServerConfig) {
    const nextEnabled = !server.enabled;
    void window.electronAPI.mcp
      .update(server.id, { enabled: nextEnabled })
      .then(() => {
        setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, enabled: nextEnabled } : s)));
      })
      .catch((e) => setError(errorMessage(e)));
    onChanged?.();
  }

  function confirmDelete(server: McpServerConfig) {
    setConfirmingDelete(server.id);
  }

  async function doDelete(id: string) {
    try {
      await window.electronAPI.mcp.remove(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
      setConfirmingDelete(null);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function loadServerTools(server: McpServerConfig) {
    void window.electronAPI.mcp
      .test(server)
      .then((res) => {
        if (!res.ok) {
          setToolErrors((prev) => ({ ...prev, [server.id]: res.error ?? '未知错误' }));
          return;
        }
        setToolCounts((prev) => ({ ...prev, [server.id]: res.toolCount ?? 0 }));
        if (!res.tools) return;
        setToolsByServer((prev) => ({ ...prev, [server.id]: res.tools! }));
        setCheckedByServer((prev) => {
          if (prev[server.id] !== undefined) return prev;
          const whitelist =
            server.tools && server.tools.length > 0 ? new Set(server.tools) : null;
          return { ...prev, [server.id]: whitelist };
        });
      })
      .catch((e) => setToolErrors((prev) => ({ ...prev, [server.id]: errorMessage(e) })));
  }

  function toggleExpand(server: McpServerConfig) {
    const isOpen = expanded.has(server.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(server.id);
      else next.add(server.id);
      return next;
    });
    // 首次展开：用当前配置测试连接，取工具列表（白名单勾选 + 回显）
    if (!isOpen && toolCounts[server.id] === undefined && !toolErrors[server.id]) {
      loadServerTools(server);
    }
  }

  function toggleTool(server: McpServerConfig, toolName: string, checked: boolean) {
    const names = (toolsByServer[server.id] ?? []).map((t) => t.name);
    if (names.length === 0) return;
    const prev = checkedByServer[server.id] ?? new Set(names);
    const next = new Set(prev);
    if (checked) next.add(toolName);
    else next.delete(toolName);
    // 全部勾选 → tools 存 []（默认启用全部）
    const whitelist = names.every((n) => next.has(n)) ? [] : names.filter((n) => next.has(n));
    setCheckedByServer((p) => ({ ...p, [server.id]: whitelist.length === 0 ? null : new Set(whitelist) }));
    void window.electronAPI.mcp
      .update(server.id, { tools: whitelist })
      .catch((e) => setError(errorMessage(e)));
    onChanged?.();
  }

  /** 表单字段变更时清掉过期测试结果（测试的是旧字段） */
  function clearTestResult() {
    setTestResult(null);
  }

  function resetForm() {
    setName('');
    setTransport('stdio');
    setCommand('');
    setArgs('');
    setUrl('');
    setTestResult(null);
  }

  function openForm() {
    resetForm();
    setShowForm(true);
  }

  async function handleTest() {
    const cfg = buildFormConfig();
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.electronAPI.mcp.test(cfg));
    } catch (e) {
      setTestResult({ ok: false, error: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  }

  function buildFormConfig(): McpServerConfig {
    const base = {
      id: `mcp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      enabled: true,
    };
    if (transport === 'http') {
      return { ...base, transport: 'http' as const, url: url.trim() };
    }
    return {
      ...base,
      transport: 'stdio' as const,
      command: command.trim(),
      args: parseArgs(args),
    };
  }

  async function handleSave() {
    try {
      await window.electronAPI.mcp.add(buildFormConfig());
      setShowForm(false);
      resetForm();
      const list = await window.electronAPI.mcp.list();
      setServers(list);
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section__title">
        MCP 服务器 <span className="count">{loading ? '加载中…' : servers.length}</span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}
      <div className="settings-group">
        {servers.length === 0 && !loading && (
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__hint">
                还没有 MCP 服务器。添加 MCP 服务器后，代理可以从服务器调用工具，点击「添加服务器」开始。
              </div>
            </div>
          </div>
        )}
        {servers.map((server) => {
          const isOpen = expanded.has(server.id);
          const count = toolCounts[server.id];
          const toolError = toolErrors[server.id];
          const toolList = toolsByServer[server.id];
          const checkedSet = checkedByServer[server.id];
          return (
            <div key={server.id} className="settings-item settings-mcp-row" data-server={server.id}>
              <button
                className="settings-mcp-expand"
                aria-expanded={isOpen}
                aria-label={isOpen ? `收起 ${server.name} 详情` : `展开 ${server.name} 详情`}
                onClick={() => toggleExpand(server)}
                type="button"
              >
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
              <div className="settings-item__grow">
                <div className="settings-item__top">
                  <div className="settings-item__title">{server.name}</div>
                  <span className="settings-mcp-badge">{server.transport}</span>
                </div>
                <div className="settings-item__hint">
                  {server.transport === 'stdio' ? server.command : server.url}
                </div>
                {isOpen && (
                  <div className="settings-mcp-tools">
                    {count !== undefined ? (
                      <div className="settings-mcp-tools__count">{`可用工具 ${count} 个`}</div>
                    ) : toolError ? (
                      <div className="settings-mcp-tools__error">{toolError}</div>
                    ) : (
                      <div className="settings-mcp-tools__loading">正在连接获取工具…</div>
                    )}
                    {toolList && (
                      <div className="settings-mcp-tools__list">
                        {toolList.map((t) => {
                          const checked = checkedSet === null || checkedSet.has(t.name);
                          return (
                            <label key={t.name} className="settings-mcp-tool">
                              <input
                                type="checkbox"
                                className="settings-mcp-tool__checkbox"
                                checked={checked}
                                onChange={(e) => toggleTool(server, t.name, e.target.checked)}
                              />
                              <span className="settings-mcp-tool__name">{t.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <div className="settings-mcp-tools__hint">
                      勾选要启用的工具；全部勾选 = 默认启用全部工具
                    </div>
                  </div>
                )}
              </div>
              <button
                className={`settings-switch ${server.enabled ? 'on' : ''}`}
                role="switch"
                aria-checked={server.enabled}
                aria-label={`${server.enabled ? '停用' : '启用'} ${server.name}`}
                title={server.enabled ? '停用该服务器' : '启用该服务器'}
                onClick={() => toggleEnabled(server)}
                type="button"
              />
              {confirmingDelete === server.id ? (
                <div className="settings-item__ops">
                  <button
                    className="btn btn-danger"
                    onClick={() => void doDelete(server.id)}
                    type="button"
                  >
                    确认删除
                  </button>
                  <button
                    className="icon-btn"
                    aria-label="取消删除"
                    onClick={() => setConfirmingDelete(null)}
                    type="button"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ) : (
                <button
                  className="icon-btn danger settings-mcp-delete"
                  aria-label={`删除 ${server.name}`}
                  title="删除服务器"
                  onClick={() => confirmDelete(server)}
                  type="button"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!showForm ? (
        <button
          className="btn btn-secondary settings-mcp-add-trigger"
          onClick={openForm}
          type="button"
        >
          <Icon name="plus" size={14} />
          添加服务器
        </button>
      ) : (
        <div className="settings-add-form settings-mcp-form">
          <div className="form-row settings-mcp-field-name">
            <label htmlFor="mcp-name">名称</label>
            <input
              id="mcp-name"
              type="text"
              placeholder="例如 GitHub API"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearTestResult();
              }}
            />
          </div>
          <div className="form-row">
            <label htmlFor="mcp-transport">传输方式</label>
            <select
              id="mcp-transport"
              className="settings-mcp-transport"
              value={transport}
              onChange={(e) => {
                setTransport(e.target.value as 'stdio' | 'http');
                clearTestResult();
              }}
            >
              <option value="stdio">stdio（本地进程）</option>
              <option value="http">http（远程服务器）</option>
            </select>
          </div>
          {transport === 'stdio' ? (
            <>
              <div className="form-row settings-mcp-field-command">
                <label htmlFor="mcp-command">命令</label>
                <input
                  id="mcp-command"
                  type="text"
                  placeholder="例如 npx"
                  value={command}
                  onChange={(e) => {
                    setCommand(e.target.value);
                    clearTestResult();
                  }}
                />
              </div>
              <div className="form-row settings-mcp-field-args">
                <label htmlFor="mcp-args">参数</label>
                <input
                  id="mcp-args"
                  type="text"
                  placeholder="例如 -y @modelcontextprotocol/server-filesystem"
                  value={args}
                  onChange={(e) => {
                    setArgs(e.target.value);
                    clearTestResult();
                  }}
                />
              </div>
            </>
          ) : (
            <div className="form-row settings-mcp-field-url">
              <label htmlFor="mcp-url">URL</label>
              <input
                id="mcp-url"
                type="text"
                placeholder="https://mcp.example.com/github"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  clearTestResult();
                }}
              />
            </div>
          )}
          {testResult && (
            <div
              className={`settings-mcp-test-result ${testResult.ok ? 'ok' : 'error'}`}
              role="status"
            >
              {testResult.ok
                ? `连接成功，可用工具 ${testResult.toolCount ?? 0} 个`
                : `连接失败：${testResult.error ?? '未知错误'}`}
            </div>
          )}
          <div className="settings-add-actions">
            <button
              className="btn btn-secondary"
              onClick={() => setShowForm(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-secondary settings-mcp-test"
              onClick={() => void handleTest()}
              disabled={testing}
              type="button"
              title="用当前表单内容尝试连接并列出工具数"
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button
              className="btn btn-primary settings-mcp-save"
              onClick={() => void handleSave()}
              type="button"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
