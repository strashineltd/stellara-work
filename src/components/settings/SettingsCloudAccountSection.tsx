import { useCallback, useEffect, useState } from 'react';
import type { CloudAuthState, CloudFailure, CloudResult } from '../../../shared/ipc';
import { Icon } from '../Icon';

/**
 * 设置面板「账号 → 云账号」区块（Phase 3 · 腾讯云 CloudBase）
 *
 * 与「本地身份」的区别：
 * - 本地身份：永远可用，数据只在本机
 * - 云账号：可选。只同步**账号元数据**（uid / 邮箱 / 用户名 / 昵称），
 *   工作区、会话、记忆一概不上云。
 *
 * 所有网络与 token 都在主进程完成；本组件只做表单与状态展示。
 */

interface SettingsCloudAccountSectionProps {
  /** 数据变更后通知外层刷新 */
  onChanged?: () => void;
  /** 外部变更信号（递增时重新拉取状态） */
  refreshKey?: number;
}

type Mode = 'signin' | 'signup';
type SignUpPhase = 'form' | 'code';

/**
 * 用户名规则 —— 必须与服务端 SignUpRequest 的校验正则逐字对齐：
 *   `^$|^[a-z][0-9a-z_-]{5,24}$`
 * 即：留空放行，否则 6-25 位、**首字符必须是小写字母**，
 * 其余只允许 `0-9 a-z _ -`（不接受大写字母，也不接受 . : + @）。
 */
const USERNAME_PATTERN = /^[a-z][0-9a-z_-]{5,24}$/;
const USERNAME_HINT = '6-25 位，以小写字母开头，仅可含小写字母、数字、下划线和连字符';

/**
 * 注册会话的模块级缓存。
 *
 * 为什么需要：设置面板切换页签时本组件会被卸载（SettingsPanel 用 `key={tab}` 重建内容），
 * 组件内 state 随之丢失。用户"拿到验证码 → 切个页签 → 切回来"就会丢掉 pendingId，
 * 表现为「注册会话已失效」。存到模块级即可跨卸载保留。
 *
 * 注意：只在渲染进程内存中，应用重启仍会丢失（主进程侧的会话同样在内存里）。
 */
let pendingSignUpCache: { pendingId: string; email: string; expiresAt: number } | null = null;

/** CloudBase 验证码有效期 10 分钟（与后端一致，用于界面倒计时） */
const CODE_TTL_MS = 10 * 60 * 1000;

/** 剩余毫秒 → "mm:ss"；已过期返回 null */
function formatRemaining(expiresAt: number, now: number): string | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  const total = Math.floor(left / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function SettingsCloudAccountSection({ onChanged, refreshKey = 0 }: SettingsCloudAccountSectionProps) {
  const [state, setState] = useState<CloudAuthState | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  // 有未完成的注册会话时直接回到验证码步骤，避免切页签后进度丢失
  const [phase, setPhase] = useState<SignUpPhase>(() => (pendingSignUpCache ? 'code' : 'form'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CloudFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 登录表单
  const [identifier, setIdentifier] = useState('');
  const [signinPassword, setSigninPassword] = useState('');

  // 注册表单
  const [email, setEmail] = useState(() => pendingSignUpCache?.email ?? '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  // 验证码步骤
  const [pendingId, setPendingId] = useState<string | null>(() => pendingSignUpCache?.pendingId ?? null);
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(() => pendingSignUpCache?.expiresAt ?? null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // 验证码有效期倒计时（仅在有会话时每秒刷新）
  useEffect(() => {
    if (!expiresAt || phase !== 'code') return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, phase]);

  const load = useCallback(async () => {
    try {
      const next = await window.electronAPI.auth.cloud.getState();
      setState(next);
    } catch (e) {
      setError({ code: 'unknown', message: e instanceof Error ? e.message : String(e), hint: '' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  /** 统一拆包 CloudResult：失败时落 error 并返回 null */
  function unwrap<T>(res: CloudResult<T>): T | null {
    if (res.ok) return res.data;
    setError(res.error);
    return null;
  }

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setPhase('form');
    setPendingId(null);
    setExpiresAt(null);
    setCode('');
    pendingSignUpCache = null;
    resetMessages();
  }

  async function handleSignIn() {
    if (busy) return;
    resetMessages();
    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.signInWithPassword({
        identifier,
        password: signinPassword,
      }));
      if (!data) return;
      setState(data);
      setSigninPassword('');
      setNotice('已登录云账号');
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function handleSendCode() {
    if (busy) return;
    resetMessages();

    if (!email.trim()) {
      setError({ code: 'invalid_argument', message: '请填写邮箱', hint: '验证码将发送到该邮箱' });
      return;
    }
    if (username.trim() && !USERNAME_PATTERN.test(username.trim())) {
      setError({
        code: 'invalid_argument',
        message: '用户名格式不符合要求',
        hint: USERNAME_HINT,
      });
      return;
    }
    if (signupPassword.length < 6) {
      setError({ code: 'invalid_argument', message: '密码至少 6 位', hint: '' });
      return;
    }

    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.sendSignUpCode({
        email: email.trim(),
        password: signupPassword,
        username: username.trim() || undefined,
        displayName: displayName.trim() || undefined,
      }));
      if (!data) return;

      // 极少数情况：该邮箱已注册且 SDK 直接返回了会话，无需验证码
      if (!data.pendingId) {
        await load();
        setNotice('该邮箱已有账号，已直接登录');
        onChanged?.();
        return;
      }

      const expires = Date.now() + CODE_TTL_MS;
      pendingSignUpCache = { pendingId: data.pendingId, email: data.email, expiresAt: expires };
      setPendingId(data.pendingId);
      setExpiresAt(expires);
      setNowTick(Date.now());
      setPhase('code');
      setNotice(`验证码已发送至 ${data.email}，请查收（含垃圾邮件箱）`);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (busy || !pendingId) return;
    resetMessages();
    if (!code.trim()) {
      setError({ code: 'invalid_argument', message: '请填写验证码', hint: '' });
      return;
    }

    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.verifySignUp({
        pendingId,
        code: code.trim(),
      }));
      if (!data) return;
      setState(data);
      pendingSignUpCache = null;
      setPhase('form');
      setPendingId(null);
      setExpiresAt(null);
      setCode('');
      setSignupPassword('');
      setNotice('注册成功，已登录并绑定到当前本地身份');
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (busy) return;
    resetMessages();
    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.signOut());
      if (data) {
        setState(data);
        setNotice('已登出云账号；本地身份与数据不受影响');
        onChanged?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (busy) return;
    resetMessages();
    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.unlink());
      if (data) {
        setState(data);
        setMode('signin');
        setNotice('已解绑云账号');
        onChanged?.();
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------- 未配置 Publishable Key ----------
  if (state && !state.configured) {
    return (
      <div className="settings-section">
        <div className="settings-section__title">云账号</div>
        <div className="settings-group">
          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">尚未配置云端环境</div>
              <div className="settings-item__hint">
                {"需要在应用数据目录的 .env 中配置 "}
                <code className="account-code">STELLARA_CLOUDBASE_PUBLISHABLE_KEY</code>
                {"（Publishable Key 可从云开发控制台「API Key 配置」获取）"}
              </div>
            </div>
            <span className="account-tag account-tag--muted">未启用</span>
          </div>
        </div>
      </div>
    );
  }

  const account = state?.account ?? null;
  const signedIn = state?.signedIn === true;
  /** 验证码剩余有效期（"mm:ss"）；null = 已过期或未申请 */
  const remaining = expiresAt ? formatRemaining(expiresAt, nowTick) : null;

  return (
    <div className="settings-section">
      <div className="settings-section__title">云账号</div>

      {notice && (
        <div className="cloud-note" role="status">
          <Icon name="check" size={14} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon">
            <Icon name="alert" size={17} />
          </span>
          <div className="error-text">
            <div>{error.message}</div>
            {error.hint && <div className="cloud-error-hint">{error.hint}</div>}
            {error.code && error.code !== 'invalid_argument' && (
              <div className="cloud-error-hint">
                <code className="account-code">{error.code}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------- 已绑定账号 ---------- */}
      {account ? (
        <div className="settings-group">
          <div className="settings-item">
            <span className="account-avatar" aria-hidden="true">
              {(account.displayName ?? account.email ?? account.username ?? 'C').trim().charAt(0).toUpperCase()}
            </span>
            <div className="settings-item__grow">
              <div className="settings-item__title">
                {account.displayName ?? account.email ?? account.username ?? account.uid}
              </div>
              <div className="settings-item__hint">
                {[account.email, account.username && `@${account.username}`, account.phone]
                  .filter(Boolean)
                  .join(' · ') || `uid ${account.uid}`}
              </div>
            </div>
            <span className={`account-tag${signedIn ? '' : ' account-tag--muted'}`}>
              {signedIn ? '已登录' : '已登出'}
            </span>
          </div>

          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">云端用户 ID</div>
              <div className="settings-item__hint">
                <code className="account-code">{account.uid}</code>
              </div>
            </div>
          </div>

          <div className="settings-item">
            <div className="settings-item__grow">
              <div className="settings-item__label">{signedIn ? '登出云账号' : '云账号已断开'}</div>
              <div className="settings-item__hint">
                {signedIn
                  ? '登出后本地身份、会话与记忆完全不受影响，绑定关系保留'
                  : '本地保存的登录态已失效或已登出，可用同一账号重新登录'}
              </div>
            </div>
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void handleSignOut()}>
              {signedIn ? '登出' : '清理登录态'}
            </button>
            <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void handleUnlink()}>
              解绑
            </button>
          </div>
        </div>
      ) : (
        /* ---------- 未绑定：登录 / 注册 ---------- */
        <div className="settings-group">
          <div className="cloud-tabs" role="tablist" aria-label="云账号操作">
            <button
              className={`cloud-tab${mode === 'signin' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
            >
              登录
            </button>
            <button
              className={`cloud-tab${mode === 'signup' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => switchMode('signup')}
            >
              注册
            </button>
          </div>

          {mode === 'signin' ? (
            <>
              <label className="cloud-field">
                <span className="cloud-field__label">邮箱或用户名</span>
                <input
                  className="account-input cloud-field__input"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSignIn();
                  }}
                />
              </label>
              <label className="cloud-field">
                <span className="cloud-field__label">密码</span>
                <input
                  className="account-input cloud-field__input"
                  type="password"
                  value={signinPassword}
                  onChange={(e) => setSigninPassword(e.target.value)}
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSignIn();
                  }}
                />
              </label>
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    登录后仅同步账号元数据；工作区、会话与记忆始终保留在本机。
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !identifier.trim() || !signinPassword}
                  onClick={() => void handleSignIn()}
                >
                  登录
                </button>
              </div>
            </>
          ) : phase === 'form' ? (
            <>
              <label className="cloud-field">
                <span className="cloud-field__label">邮箱</span>
                <input
                  className="account-input cloud-field__input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>
              <label className="cloud-field">
                <span className="cloud-field__label">用户名（选填，用于后续登录）</span>
                <input
                  className="account-input cloud-field__input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="stellara_user"
                  autoComplete="username"
                  spellCheck={false}
                />
                <span className="settings-item__hint">6-25 位，以小写字母开头，仅可含小写字母、数字、下划线和连字符</span>
              </label>
              <label className="cloud-field">
                <span className="cloud-field__label">昵称（选填）</span>
                <input
                  className="account-input cloud-field__input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                />
              </label>
              <label className="cloud-field">
                <span className="cloud-field__label">密码</span>
                <input
                  className="account-input cloud-field__input"
                  type="password"
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSendCode();
                  }}
                />
              </label>
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    CloudBase 要求注册必须验证邮箱；我们会向该邮箱发送验证码。
                  </div>
                </div>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSendCode()}>
                  获取验证码
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="cloud-field">
                <span className="cloud-field__label">邮箱验证码</span>
                <input
                  className="account-input cloud-field__input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位数字"
                  inputMode="numeric"
                  maxLength={8}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleVerify();
                  }}
                />
              </label>
              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    {remaining
                      ? `验证码已发送至 ${email.trim()}，剩余有效期 ${remaining}`
                      : `验证码已过期（发送至 ${email.trim()}），请重新获取`}
                    {!pendingId && ' · 会话已失效，请返回重新获取'}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    pendingSignUpCache = null;
                    setPendingId(null);
                    setExpiresAt(null);
                    setCode('');
                    resetMessages();
                    setPhase('form');
                  }}
                >
                  返回
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !code.trim() || !pendingId || !remaining}
                  onClick={() => void handleVerify()}
                >
                  {remaining ? '完成注册' : '验证码已过期'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
