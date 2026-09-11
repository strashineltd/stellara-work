import { useCallback, useEffect, useState } from 'react';
import type { LocalUser } from '../../../shared/ipc';
import { Icon } from '../Icon';
import { SettingsCloudAccountSection } from './SettingsCloudAccountSection';

interface SettingsAccountPanelProps {
  /** 数据变更后通知 SettingsPanel（同窗口刷新同步） */
  onChanged?: () => void;
  /** 外部数据变更信号（其他窗口广播 settings-changed 时递增） */
  refreshKey?: number;
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || 'U';
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 设置窗口「账号」面板。
 *
 * Phase 1 只覆盖本地身份：改名 / 切换 / 新建。
 * 云账号（腾讯云 CloudBase）区块先占位，Phase 3 接入后替换为真实的注册/登录入口。
 *
 * 说明：本地身份不涉及任何密钥，所有操作都经过主进程 auth.local.* IPC。
 */
export function SettingsAccountPanel({ onChanged, refreshKey = 0 }: SettingsAccountPanelProps) {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [current, all] = await Promise.all([
        window.electronAPI.auth.local.getCurrent(),
        window.electronAPI.auth.local.list(),
      ]);
      setUser(current);
      setUsers(all);
      setNameDraft(current.displayName);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function handleSaveName() {
    if (!user || busy) return;
    const next = nameDraft.trim();
    if (!next || next === user.displayName) return;
    setBusy(true);
    try {
      await window.electronAPI.auth.local.update({ displayName: next });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitch(id: string) {
    if (busy || id === user?.id) return;
    setBusy(true);
    try {
      await window.electronAPI.auth.local.switch(id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (busy) return;
    setBusy(true);
    try {
      const created = await window.electronAPI.auth.local.create();
      await window.electronAPI.auth.local.switch(created.id);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty = !!user && !!nameDraft.trim() && nameDraft.trim() !== user.displayName;

  return (
    <div className="settings-panel-root">
      <div className="settings-panel-head">
        <div>
          <h2>账号</h2>
          <div className="sub">管理本机身份，不依赖云服务</div>
        </div>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon">
            <Icon name="alert" size={17} />
          </span>
          <div className="error-text">{error}</div>
        </div>
      )}

      {!user ? (
        <p className="empty-hint">加载中…</p>
      ) : (
        <>
          <div className="settings-section">
            <div className="settings-section__title">当前本地身份</div>
            <div className="settings-group">
              <div className="settings-item">
                <span className="account-avatar" aria-hidden="true">
                  {initialOf(user.displayName)}
                </span>
                <div className="settings-item__grow">
                  <div className="settings-item__title">{user.displayName}</div>
                  <div className="settings-item__hint">本地身份 · 创建于 {formatDateTime(user.createdAt)}</div>
                </div>
                <span className="account-tag">当前使用中</span>
              </div>
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__label">用户 ID</div>
                  <div className="settings-item__hint">
                    <code className="account-code">{user.id}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">显示名</div>
            <div className="settings-group">
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__label">名称</div>
                  <div className="settings-item__hint">仅在本机显示，不会上传</div>
                </div>
                <input
                  className="account-input"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveName();
                  }}
                  placeholder="Local User"
                  aria-label="本地身份显示名"
                  maxLength={48}
                />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void handleSaveName()}
                  disabled={busy || !dirty}
                >
                  保存
                </button>
              </div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section__title">
              全部本地身份 <span className="count">{users.length}</span>
            </div>
            <div className="settings-group">
              {users.map((item) => {
                const active = item.id === user.id;
                return (
                  <div key={item.id} className="settings-item">
                    <span className="account-avatar account-avatar--sm" aria-hidden="true">
                      {initialOf(item.displayName)}
                    </span>
                    <div className="settings-item__grow">
                      <div className="settings-item__title">{item.displayName}</div>
                      <div className="settings-item__hint">
                        {active ? '当前使用中' : `创建于 ${formatDateTime(item.createdAt)}`}
                      </div>
                    </div>
                    {active ? (
                      <Icon name="check" size={15} />
                    ) : (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSwitch(item.id)}
                      >
                        切换
                      </button>
                    )}
                  </div>
                );
              })}

              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__label">新建本地身份</div>
                  <div className="settings-item__hint">创建后会立即切换过去</div>
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCreate()}
                >
                  <Icon name="plus" size={14} />
                  <span>新建</span>
                </button>
              </div>
            </div>
          </div>

          <SettingsCloudAccountSection refreshKey={refreshKey} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}
