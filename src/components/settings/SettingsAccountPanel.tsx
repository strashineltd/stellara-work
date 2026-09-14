import { useCallback, useEffect, useState } from 'react';
import type { LocalIdentity, LocalUser } from '../../../shared/ipc';
import { runAutosaveFlush } from '../../lib/autosave-flush';
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
 * H10：身份状态一律来自 identity.* IPC（默认档不再让 auth.local.getCurrent 抛错挂起）。
 * 切换身份经 identity.switch；有运行中任务时先弹内联确认，确认后带 force 重试。
 *
 * 云账号（腾讯云 CloudBase）区块保持原样：登录/登出只同步账号元数据。
 */
export function SettingsAccountPanel({ onChanged, refreshKey = 0 }: SettingsAccountPanelProps) {
  const [current, setCurrent] = useState<LocalIdentity | null>(null);
  const [identities, setIdentities] = useState<LocalIdentity[]>([]);
  const [detail, setDetail] = useState<LocalUser | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ id: string; count: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [identity, all] = await Promise.all([
        window.electronAPI.identity.getCurrent(),
        window.electronAPI.identity.list(),
      ]);
      setCurrent(identity);
      setIdentities(all);
      if (identity.kind === 'user') {
        // 增强信息（创建时间）；默认档没有本地用户行，跳过，避免整面板挂起
        const profile = await window.electronAPI.auth.local.getCurrent().catch(() => null);
        setDetail(profile);
        setNameDraft(profile?.displayName ?? identity.name);
      } else {
        setDetail(null);
        setNameDraft('');
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function handleSaveName() {
    if (!detail || busy) return;
    const next = nameDraft.trim();
    if (!next || next === detail.displayName) return;
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

  async function performSwitch(id: string, force?: boolean) {
    await runAutosaveFlush();
    const result = await window.electronAPI.identity.switch(id, force);
    if (!result.ok) {
      setPendingSwitch({ id, count: result.count });
      return;
    }
    setPendingSwitch(null);
    await load();
    onChanged?.();
  }

  async function runSwitch(id: string, force?: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await performSwitch(id, force);
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
      await performSwitch(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dirty = !!detail && !!nameDraft.trim() && nameDraft.trim() !== detail.displayName;

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

      {!current ? (
        <p className="empty-hint">加载中…</p>
      ) : (
        <>
          <div className="settings-section">
            <div className="settings-section__title">当前本地身份</div>
            <div className="settings-group">
              <div className="settings-item">
                <span className="account-avatar" aria-hidden="true">
                  {initialOf(current.name)}
                </span>
                <div className="settings-item__grow">
                  <div className="settings-item__title">{current.name}</div>
                  <div className="settings-item__hint">
                    {current.kind === 'default'
                      ? '系统默认档'
                      : detail
                        ? `本地身份 · 创建于 ${formatDateTime(detail.createdAt)}`
                        : '本地身份'}
                  </div>
                </div>
                <span className="account-tag">当前使用中</span>
              </div>
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__label">身份 ID</div>
                  <div className="settings-item__hint">
                    <code className="account-code">{current.id}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {current.kind === 'user' && detail && (
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
          )}

          <div className="settings-section">
            <div className="settings-section__title">
              全部本地身份 <span className="count">{identities.length}</span>
            </div>
            <div className="settings-group">
              {identities.map((item) => {
                const active = item.id === current.id;
                return (
                  <div key={item.id} className="settings-item">
                    <span className="account-avatar account-avatar--sm" aria-hidden="true">
                      {initialOf(item.name)}
                    </span>
                    <div className="settings-item__grow">
                      <div className="settings-item__title">{item.name}</div>
                      <div className="settings-item__hint">
                        {active ? '当前使用中' : item.kind === 'default' ? '系统默认档' : '本地身份'}
                      </div>
                    </div>
                    {active ? (
                      <Icon name="check" size={15} />
                    ) : (
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => void runSwitch(item.id)}
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

              {pendingSwitch && (
                <div className="settings-item" role="alert">
                  <div className="settings-item__grow">
                    <div className="settings-item__title">
                      切换将中断 {pendingSwitch.count} 个运行中的任务
                    </div>
                    <div className="settings-item__hint">强制切换后，正在执行的任务会停止。</div>
                  </div>
                  <div className="settings-item__ops">
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => void runSwitch(pendingSwitch.id, true)}
                    >
                      继续切换
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => setPendingSwitch(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <SettingsCloudAccountSection refreshKey={refreshKey} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}
