import { useState } from 'react';
import type { ServerEntry, ServerInput } from '../../../shared/ipc';

interface ServerDialogProps {
  mode: 'add' | 'edit';
  entry?: ServerEntry;
  onCancel: () => void;
  onSaved: () => void;
}

export const DEFAULT_SERVER_URL = 'http://localhost:4096';
const DEFAULT_USERNAME = 'opencode';

/** 主进程错误 → 中文可读提示：401 鉴权 / 非法协议 / 其余透传 */
export function mapServerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized/i.test(message)) return '鉴权失败，请检查用户名或密码';
  if (/http/i.test(message)) return '服务器 URL 仅支持 http/https';
  return `连接失败：${message}`;
}

/**
 * 添加 / 编辑服务器对话框。
 * 密码 write-only：编辑时输入框始终为空，留空表示沿用已存凭据。
 */
export function ServerDialog({ mode, entry, onCancel, onSaved }: ServerDialogProps) {
  const [url, setUrl] = useState(mode === 'edit' && entry ? entry.url : DEFAULT_SERVER_URL);
  const [name, setName] = useState(mode === 'edit' && entry ? entry.name : '');
  const [username, setUsername] = useState(
    mode === 'edit' && entry ? entry.username ?? DEFAULT_USERNAME : DEFAULT_USERNAME,
  );
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (saving) return;
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError('请填写服务器 URL');
      return;
    }

    const payload: ServerInput = { url: trimmedUrl };
    const trimmedName = name.trim();
    if (trimmedName) payload.name = trimmedName;
    const trimmedUsername = username.trim();
    if (trimmedUsername && trimmedUsername !== (entry?.username ?? DEFAULT_USERNAME)) {
      payload.username = trimmedUsername;
    }
    if (password) payload.password = password;

    setSaving(true);
    setError(null);
    try {
      if (mode === 'edit' && entry) {
        await window.electronAPI.servers.update(entry.id, payload);
      } else {
        await window.electronAPI.servers.add(payload);
      }
      onSaved();
    } catch (e) {
      setError(mapServerError(e));
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'add' ? '添加服务器' : '编辑服务器';

  return (
    <div className="modal-backdrop server-dialog-backdrop" onClick={onCancel}>
      <div
        className="modal server-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="server-dialog__head">
          <h3>{title}</h3>
          <div className="sub">{mode === 'add' ? '连接远端 OpenCode 服务器' : entry?.url}</div>
        </header>

        <div className="server-dialog__body">
          <div className="form-row">
            <label htmlFor="server-url">服务器 URL</label>
            <input
              id="server-url"
              type="text"
              placeholder={DEFAULT_SERVER_URL}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
            <div className="form-hint">仅支持 http:// 或 https:// 地址</div>
          </div>
          <div className="form-row">
            <label htmlFor="server-name">名称</label>
            <input
              id="server-name"
              type="text"
              placeholder="可选，留空取主机名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="server-username">用户名</label>
            <input
              id="server-username"
              type="text"
              placeholder={DEFAULT_USERNAME}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="server-password">密码</label>
            <input
              id="server-password"
              type="password"
              placeholder={mode === 'edit' ? '保持不变（留空则不修改）' : '可选'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="server-dialog__error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="server-dialog__footer">
          <button className="btn btn-secondary server-dialog__cancel" onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="btn btn-primary server-dialog__save"
            onClick={() => void handleSave()}
            disabled={saving}
            type="button"
          >
            {saving ? '保存中…' : mode === 'add' ? '添加服务器' : '保存'}
          </button>
        </footer>
      </div>
    </div>
  );
}
