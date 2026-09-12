import { useEffect, useState } from 'react';
import type { ServerEntry, ServerRuntimeStatus } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { mapServerError, ServerDialog } from './ServerDialog';

interface SettingsServerPanelProps {
  /** 数据变更后通知 SettingsPanel（同窗口刷新同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

type DialogState = { mode: 'add' } | { mode: 'edit'; entry: ServerEntry } | null;

const STATUS_LABELS: Record<ServerRuntimeStatus, string> = {
  connected: '已连接',
  connecting: '连接中',
  error: '连接失败',
  disconnected: '未连接',
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 设置窗口「服务器」面板：服务器卡片列表（状态点 + `…` 菜单）+ 添加/编辑对话框。
 * 凭据只存在主进程，行内仅展示 hasPassword 派生的信息。
 */
export function SettingsServerPanel({ onChanged, refreshKey = 0 }: SettingsServerPanelProps) {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerRuntimeStatus>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [list, statusList] = await Promise.all([
        window.electronAPI.servers.list(),
        window.electronAPI.servers.status(),
      ]);
      const next: Record<string, ServerRuntimeStatus> = {};
      for (const status of statusList) next[status.id] = status.status;
      setServers(list);
      setStatuses(next);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  useEffect(() => {
    void load();
    // 仅在 refreshKey 变化时重载；load 每次渲染重建，故意不列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // 主进程状态广播：点状态实时更新，无需重开设置
  useEffect(() => {
    const unsubscribe = window.electronAPI.servers.onStatusChanged((statusList) => {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const status of statusList) next[status.id] = status.status;
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // 点外部 / Escape 关闭行内 `…` 菜单（触发按钮自身不重复处理，交给 click 切换）
  useEffect(() => {
    if (menuFor === null) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.settings-server-row__menu, .settings-server-row__menu-btn')) {
        return;
      }
      setMenuFor(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuFor]);

  async function handleTest(entry: ServerEntry) {
    setMenuFor(null);
    try {
      const result = await window.electronAPI.servers.test(entry.id);
      const text = result.ok
        ? `连接成功${result.version ? ` · v${result.version}` : ''}`
        : result.error
          ? mapServerError(result.error)
          : '连接失败';
      setTestResults((prev) => ({ ...prev, [entry.id]: { ok: result.ok, text } }));
      setStatuses((prev) => ({ ...prev, [entry.id]: result.status }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [entry.id]: { ok: false, text: mapServerError(e) } }));
    }
    onChanged?.();
  }

  async function handleSetDefault(entry: ServerEntry) {
    setMenuFor(null);
    try {
      await window.electronAPI.servers.setDefault(entry.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function handleDelete(entry: ServerEntry) {
    setMenuFor(null);
    if (!window.confirm(`删除服务器「${entry.name}」？侧栏中该服务器的会话记录将一并移除。`)) return;
    try {
      await window.electronAPI.servers.remove(entry.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function handleSaved() {
    setDialog(null);
    await load();
    onChanged?.();
  }

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>服务器</h2>
          <div className="sub">连接远端 OpenCode 服务器</div>
        </div>
        <button
          className="btn btn-secondary btn-small settings-server-add"
          onClick={() => setDialog({ mode: 'add' })}
          type="button"
        >
          <Icon name="plus" size={14} />
          添加服务器
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon"><Icon name="alert" size={17} /></span>
          <div className="error-text">{error}</div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section__title">
          服务器 <span className="count">{servers.length}</span>
        </div>
        <div className="settings-group">
          {servers.length === 0 && <p className="empty-hint">还没有服务器</p>}
          {servers.map((entry) => {
            const status = statuses[entry.id] ?? 'disconnected';
            const result = testResults[entry.id];
            return (
              <div key={entry.id} className="settings-item settings-server-row" data-server-id={entry.id}>
                <span
                  className="server-status-dot"
                  data-status={status}
                  title={STATUS_LABELS[status]}
                  aria-label={STATUS_LABELS[status]}
                />
                <div className="settings-item__grow">
                  <div className="settings-item__title">
                    {entry.name}
                    {entry.isDefault && <span className="settings-server-badge">默认</span>}
                  </div>
                  <div className="settings-item__hint">{entry.url}</div>
                  {result && (
                    <div
                      className={`settings-server-row__result${result.ok ? '' : ' is-error'}`}
                      role="status"
                    >
                      {result.text}
                    </div>
                  )}
                </div>
                <button
                  className="icon-btn settings-server-row__menu-btn"
                  title="更多操作"
                  aria-label={`${entry.name} 操作`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === entry.id}
                  onClick={() => setMenuFor((current) => (current === entry.id ? null : entry.id))}
                  type="button"
                >
                  <Icon name="more" size={15} />
                </button>
                {menuFor === entry.id && (
                  <div className="settings-server-row__menu" role="menu">
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuFor(null);
                        setDialog({ mode: 'edit', entry });
                      }}
                    >
                      编辑
                    </button>
                    <button role="menuitem" type="button" onClick={() => void handleTest(entry)}>
                      测试连接
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      disabled={entry.isDefault}
                      onClick={() => void handleSetDefault(entry)}
                    >
                      设为默认
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      className="danger"
                      onClick={() => void handleDelete(entry)}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {dialog?.mode === 'add' && (
        <ServerDialog mode="add" onCancel={() => setDialog(null)} onSaved={() => void handleSaved()} />
      )}
      {dialog?.mode === 'edit' && (
        <ServerDialog
          mode="edit"
          entry={dialog.entry}
          onCancel={() => setDialog(null)}
          onSaved={() => void handleSaved()}
        />
      )}
    </div>
  );
}
