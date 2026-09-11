import { useEffect, useState } from 'react';
import type { ServerEntry, ServerStatusEntry } from '../../../shared/ipc';
import type { ExecutionTarget } from '../../lib/navigation';
import { usePresence } from '../../hooks/usePresence';
import { presenceRootProps } from '../../lib/presence-ui';
import { Icon } from '../Icon';

interface ServerTargetSelectorProps {
  servers: ServerEntry[];
  statuses: ServerStatusEntry[];
  value: ExecutionTarget;
  onChange: (target: ExecutionTarget) => void;
  onManageServers: () => void;
  onReconnect: (serverId: string) => void;
}

const LOCAL_LABEL = '本地';

/**
 * 顶栏执行端选择器：trigger 显示当前目标 + 状态点；菜单列出本地 / 各服务器（含状态与错误行「重连」）
 * 与「管理服务器…」。复用 usePresence + 外部点击/Escape 关闭。
 */
export function ServerTargetSelector(props: ServerTargetSelectorProps) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open, 120);
  const serverId = props.value.kind === 'server' ? props.value.serverId : null;
  const selectedServer = serverId ? props.servers.find((server) => server.id === serverId) ?? null : null;
  const currentName = props.value.kind === 'local' || !selectedServer ? LOCAL_LABEL : selectedServer.name;
  const currentStatus = props.value.kind === 'server' && selectedServer
    ? props.statuses.find((status) => status.id === selectedServer.id)?.status ?? 'disconnected'
    : 'connected';

  // 点外部 / Escape 关闭执行端菜单（trigger 容器内的 pointerdown 交给 click 切换）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('.server-target')) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function select(target: ExecutionTarget) {
    props.onChange(target);
    setOpen(false);
  }

  return (
    <span className="server-target">
      <button
        className="execution-target-chip server-target__trigger"
        type="button"
        data-status={currentStatus}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="server-target__dot" aria-hidden="true" />
        <span>{currentName}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {presence.mounted && (
        <div className="server-target__menu" role="menu" aria-label="执行端" {...presenceRootProps(presence)}>
          <button
            className={`server-target__item${props.value.kind === 'local' ? ' active' : ''}`}
            type="button"
            role="menuitemradio"
            aria-checked={props.value.kind === 'local'}
            onClick={() => select({ kind: 'local' })}
          >
            <i className="server-target__dot" aria-hidden="true" />
            <span>{LOCAL_LABEL}</span>
          </button>
          {props.servers.map((server) => {
            const status = props.statuses.find((entry) => entry.id === server.id)?.status ?? 'disconnected';
            const selected = props.value.kind === 'server' && props.value.serverId === server.id;
            return (
              <div key={server.id} className="server-target__row" data-server-id={server.id}>
                <button
                  className={`server-target__item${selected ? ' active' : ''}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  data-status={status}
                  onClick={() => select({ kind: 'server', serverId: server.id })}
                >
                  <i className="server-target__dot" data-status={status} aria-hidden="true" />
                  <span>{server.name}</span>
                </button>
                {status === 'error' && (
                  <button
                    className="server-target__reconnect"
                    type="button"
                    onClick={() => props.onReconnect(server.id)}
                  >
                    重连
                  </button>
                )}
              </div>
            );
          })}
          <div className="server-target__divider" role="separator" />
          <button
            className="server-target__item server-target__manage"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              props.onManageServers();
            }}
          >
            <Icon name="server" size={13} />
            <span>管理服务器…</span>
          </button>
        </div>
      )}
    </span>
  );
}
