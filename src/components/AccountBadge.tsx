import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalUser } from '../../shared/ipc';
import { Icon } from './Icon';

/**
 * 本地身份入口（侧边栏）
 *
 * 展示当前本地用户，点击展开菜单：切换身份 / 新建身份。
 * 数据全部来自主进程的 auth.local.* IPC —— 本组件自己拉取，不依赖 Sidebar props。
 *
 * Phase 1 说明：切换身份目前只切换"当前使用者"标识；
 * 会话/记忆按用户分区归属在后续阶段接入，届时无需改动本组件。
 */

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'U';
}

export function AccountBadge() {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [current, all] = await Promise.all([
        window.electronAPI.auth.local.getCurrent(),
        window.electronAPI.auth.local.list(),
      ]);
      setUser(current);
      setUsers(all);
    } catch {
      // 非 Electron 环境（单测 / 浏览器预览）或主进程不可用时静默降级：不渲染身份入口
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 点击外部 / Esc → 关闭菜单
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSwitch = useCallback(
    async (id: string) => {
      if (id === user?.id) {
        setOpen(false);
        return;
      }
      try {
        await window.electronAPI.auth.local.switch(id);
        await refresh();
      } catch {
        // 切换失败时保持当前身份
      } finally {
        setOpen(false);
      }
    },
    [refresh, user?.id],
  );

  const handleCreate = useCallback(async () => {
    try {
      await window.electronAPI.auth.local.create();
      await refresh();
    } catch {
      // 新建失败时保持当前状态（侧边栏不承担错误展示，账号面板有完整报错）
    }
  }, [refresh]);

  if (!user) return null;

  return (
    <div className="account-badge" ref={rootRef}>
      <button
        className="account-badge__trigger"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.displayName}
      >
        <span className="account-avatar" aria-hidden="true">
          {initialOf(user.displayName)}
        </span>
        <span className="account-badge__name">{user.displayName}</span>
        <Icon name="chevron-down" size={13} />
      </button>

      {open && (
        <div className="account-badge__menu" role="menu" aria-label="本地身份">
          <div className="account-badge__menu-title">本地身份</div>
          {users.map((item) => {
            const active = item.id === user.id;
            return (
              <button
                key={item.id}
                className={`account-badge__item${active ? ' is-active' : ''}`}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => void handleSwitch(item.id)}
              >
                <span className="account-avatar account-avatar--sm" aria-hidden="true">
                  {initialOf(item.displayName)}
                </span>
                <span className="account-badge__item-name">{item.displayName}</span>
                {active && <Icon name="check" size={13} />}
              </button>
            );
          })}

          <div className="account-badge__divider" />

          <button
            className="account-badge__item"
            type="button"
            role="menuitem"
            onClick={() => void handleCreate()}
          >
            <Icon name="plus" size={13} />
            <span className="account-badge__item-name">新建本地身份</span>
          </button>

          <p className="account-badge__hint">
            本地身份仅保存在本机；云账号绑定将在后续版本提供。
          </p>
        </div>
      )}
    </div>
  );
}
