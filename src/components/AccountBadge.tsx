import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalIdentity } from '../../shared/ipc';
import { runAutosaveFlush } from '../lib/autosave-flush';
import { Icon } from './Icon';

/**
 * 本地身份入口（侧边栏）
 *
 * 展示当前身份（含「本地默认」档），点击展开菜单：切换身份 / 新建身份。
 * 身份数据来自主进程 identity.* IPC（H10）；新建本地身份仍走 auth.local.create。
 * 主进程广播 identity-changed 时同步刷新（设置面板切换 / 其他窗口切换）。
 */

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'U';
}

export function AccountBadge() {
  const [current, setCurrent] = useState<LocalIdentity | null>(null);
  const [identities, setIdentities] = useState<LocalIdentity[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [identity, all] = await Promise.all([
        window.electronAPI.identity.getCurrent(),
        window.electronAPI.identity.list(),
      ]);
      setCurrent(identity);
      setIdentities(all);
    } catch {
      // 非 Electron 环境（单测 / 浏览器预览）或主进程不可用时静默降级：不渲染身份入口
      setCurrent(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 主进程身份变更广播 → 同步角标（切换失败不会广播，保持原身份）
  useEffect(() => {
    const api = window.electronAPI?.identity;
    if (!api?.onChanged) return;
    return api.onChanged(() => {
      void refresh();
    });
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
      if (id === current?.id) {
        setOpen(false);
        return;
      }
      try {
        await runAutosaveFlush();
        const result = await window.electronAPI.identity.switch(id);
        if (result.ok) await refresh();
        // busy（有运行中任务）时不强制切换：完整确认流程在设置 → 账号
      } catch {
        // 切换失败时保持当前身份
      } finally {
        setOpen(false);
      }
    },
    [refresh, current?.id],
  );

  const handleCreate = useCallback(async () => {
    try {
      await window.electronAPI.auth.local.create();
      await refresh();
    } catch {
      // 新建失败时保持当前状态（侧边栏不承担错误展示，账号面板有完整报错）
    }
  }, [refresh]);

  if (!current) return null;

  return (
    <div className="account-badge" ref={rootRef}>
      <button
        className="account-badge__trigger"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`本地身份：${current.name}`}
        title={current.name}
      >
        <span className="account-avatar" aria-hidden="true">
          {initialOf(current.name)}
        </span>
        <span className="account-badge__name">{current.name}</span>
      </button>

      {open && (
        <div className="account-badge__menu" role="menu" aria-label="本地身份">
          <div className="account-badge__menu-title">本地身份</div>
          {identities.map((item) => {
            const active = item.id === current.id;
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
                  {initialOf(item.name)}
                </span>
                <span className="account-badge__item-name">{item.name}</span>
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
