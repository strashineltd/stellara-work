import { useCallback, useEffect, useRef, useState } from 'react';
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
 *
 * 交互约定（0.9.3.1 界面重构）：
 * 1. 登录 / 注册用分段控件切换，注册分两步（账号信息 → 邮箱验证）并有步骤条
 * 2. 校验前置：邮箱格式 / 用户名规则与占用 / 密码强度 / 确认密码都在**填写时**反馈，
 *    不再等提交后才报错（CloudBase 的用户名错误要到「提交验证码」那一步才抛回，
 *    详见 electron/cloud/cloudbase-client.ts 的 FIELD_RULE_ERRORS 注释）
 * 3. 错误分层：能归因到某个字段的错误挂字段下（inline），其余才进顶部横幅
 * 4. 验证码为 6 格分格输入，支持自动跳格 / 退格回退 / 整段粘贴
 */

interface SettingsCloudAccountSectionProps {
  /** 数据变更后通知外层刷新 */
  onChanged?: () => void;
  /** 外部变更信号（递增时重新拉取状态） */
  refreshKey?: number;
}

type Mode = 'signin' | 'signup';
type SignUpPhase = 'form' | 'code';

/** 可挂错误的字段（也是 fieldErrors 的键） */
type FieldKey =
  | 'identifier'
  | 'signinPassword'
  | 'email'
  | 'username'
  | 'password'
  | 'confirm'
  | 'code';
type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * 用户名规则 —— 必须与服务端 SignUpRequest 的校验正则逐字对齐：
 *   `^$|^[a-z][0-9a-z_-]{5,24}$`
 * 即：留空放行，否则 6-25 位、**首字符必须是小写字母**，
 * 其余只允许 `0-9 a-z _ -`（不接受大写字母，也不接受 . : + @）。
 */
const USERNAME_PATTERN = /^[a-z][0-9a-z_-]{5,24}$/;
const USERNAME_HINT = '6-25 位，以小写字母开头，仅可含小写字母、数字、下划线和连字符';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;
const CODE_LENGTH = 6;
/** 重新发送冷却（与 CloudBase 的发送频率限制对齐，避免用户白点） */
const RESEND_COOLDOWN_MS = 60_000;

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

/** 密码强度评分：0 = 空，1 = 偏弱，2 = 中等，3 = 较强 */
function scorePassword(value: string): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  if (value.length < MIN_PASSWORD_LENGTH) return 1;
  let score = 1;
  if (/\d/.test(value) && /[A-Za-z]/.test(value)) score += 1;
  if (value.length >= 10 || /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 3) as 1 | 2 | 3;
}

const STRENGTH_LABEL: Record<1 | 2 | 3, string> = { 1: '偏弱', 2: '中等', 3: '较强' };

/** 剩余毫秒 → "mm:ss"；已过期返回 null */
function formatRemaining(expiresAt: number, now: number): string | null {
  const left = expiresAt - now;
  if (left <= 0) return null;
  const total = Math.floor(left / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * 错误码 → 该挂到哪个字段。
 * 能归因到字段的就不进顶部横幅（用户能自己改的，别用系统级提示吓他）。
 */
const FIELD_BY_CODE: Record<string, FieldKey> = {
  invalid_credentials: 'signinPassword',
  user_not_found: 'identifier',
  verification_failed: 'code',
};

export function SettingsCloudAccountSection({ onChanged, refreshKey = 0 }: SettingsCloudAccountSectionProps) {
  const [state, setState] = useState<CloudAuthState | null>(null);
  const [mode, setMode] = useState<Mode>('signin');
  // 有未完成的注册会话时直接回到验证码步骤，避免切页签后进度丢失
  const [phase, setPhase] = useState<SignUpPhase>(() => (pendingSignUpCache ? 'code' : 'form'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CloudFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // 登录表单
  const [identifier, setIdentifier] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [showSigninPassword, setShowSigninPassword] = useState(false);

  // 注册表单
  const [email, setEmail] = useState(() => pendingSignUpCache?.email ?? '');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  /** 用户名占用预检结果 */
  const [usernameCheck, setUsernameCheck] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const usernameCheckSeq = useRef(0);

  // 验证码步骤
  const [pendingId, setPendingId] = useState<string | null>(() => pendingSignUpCache?.pendingId ?? null);
  const [otp, setOtp] = useState<string[]>(() => Array<string>(CODE_LENGTH).fill(''));
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [expiresAt, setExpiresAt] = useState<number | null>(() => pendingSignUpCache?.expiresAt ?? null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const codeValue = otp.join('');
  const resendLeft = resendAt ? Math.max(0, Math.ceil((resendAt - nowTick) / 1000)) : 0;
  const passwordScore = scorePassword(signupPassword);

  // 倒计时（验证码有效期 / 重新发送冷却）每秒刷新
  useEffect(() => {
    if (phase !== 'code') return;
    if (!expiresAt && !resendAt) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, resendAt, phase]);

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

  // ---------- 字段错误辅助 ----------

  function setFieldError(key: FieldKey, message?: string) {
    setFieldErrors((prev) => {
      if (!message) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  }

  function clearFieldErrors(...keys: FieldKey[]) {
    setFieldErrors((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const key of keys) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  /** 单字段校验：返回错误文案，undefined 表示通过 */
  function validateField(key: FieldKey): string | undefined {
    switch (key) {
      case 'identifier':
        return identifier.trim() ? undefined : '请填写邮箱或用户名';
      case 'signinPassword':
        return signinPassword ? undefined : '请填写密码';
      case 'email': {
        const value = email.trim();
        if (!value) return '请填写邮箱，验证码会发送到该邮箱';
        return EMAIL_PATTERN.test(value) ? undefined : '邮箱格式不正确';
      }
      case 'username': {
        const value = username.trim();
        if (!value) return undefined; // 选填
        if (!USERNAME_PATTERN.test(value)) return USERNAME_HINT;
        return usernameCheck === 'taken' ? '该用户名已被占用，换一个试试' : undefined;
      }
      case 'password':
        return signupPassword.length >= MIN_PASSWORD_LENGTH
          ? undefined
          : `密码至少 ${MIN_PASSWORD_LENGTH} 位`;
      case 'confirm':
        return confirmPassword === signupPassword ? undefined : '两次输入的密码不一致';
      default:
        return undefined;
    }
  }

  function blurField(key: FieldKey) {
    setFieldError(key, validateField(key));
  }

  /** 注册表单整表校验（点「获取验证码」时用），返回是否通过 */
  function validateSignupForm(): boolean {
    const keys: FieldKey[] = ['email', 'username', 'password', 'confirm'];
    const next: FieldErrors = {};
    for (const key of keys) {
      const message = validateField(key);
      if (message) next[key] = message;
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  /** 登录表单整表校验，返回是否通过 */
  function validateSigninForm(): boolean {
    const next: FieldErrors = {};
    const identifierMessage = validateField('identifier');
    if (identifierMessage) next.identifier = identifierMessage;
    const passwordMessage = validateField('signinPassword');
    if (passwordMessage) next.signinPassword = passwordMessage;
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  /**
   * 统一拆包 CloudResult：失败时按错误码决定挂字段还是顶部横幅，并返回 null。
   */
  function unwrap<T>(res: CloudResult<T>): T | null {
    if (res.ok) return res.data;
    routeFailure(res.error);
    return null;
  }

  function routeFailure(failure: CloudFailure) {
    let field: FieldKey | null = FIELD_BY_CODE[failure.code] ?? null;
    // 服务端字段级规则错误：文案里已经指明了是哪个字段
    if (failure.code === 'field_rule') {
      field = failure.message.includes('用户名') ? 'username' : 'password';
    }
    // 占用类错误：填了用户名就归到用户名，否则归到邮箱
    if (failure.code === 'precondition_failed') {
      field = username.trim() ? 'username' : 'email';
    }
    if (field) setFieldError(field, failure.message);
    else setError(failure);
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
    setResendAt(null);
    setOtp(Array<string>(CODE_LENGTH).fill(''));
    pendingSignUpCache = null;
    setFieldErrors({});
    resetMessages();
  }

  /** 回到「账号信息」步（保留已填内容，方便改完直接重发） */
  function backToForm() {
    pendingSignUpCache = null;
    setPendingId(null);
    setExpiresAt(null);
    setResendAt(null);
    setOtp(Array<string>(CODE_LENGTH).fill(''));
    setFieldErrors({});
    resetMessages();
    setPhase('form');
  }

  // ---------- 用户名占用预检 ----------

  async function checkUsernameAvailability() {
    const name = username.trim();
    if (!name || !USERNAME_PATTERN.test(name)) {
      setUsernameCheck('idle');
      return;
    }
    const seq = usernameCheckSeq.current + 1;
    usernameCheckSeq.current = seq;
    setUsernameCheck('checking');
    try {
      const res = await window.electronAPI.auth.cloud.isUsernameRegistered(name);
      if (seq !== usernameCheckSeq.current) return; // 已有更新的请求，丢弃
      if (!res.ok) {
        setUsernameCheck('idle');
        return;
      }
      setUsernameCheck(res.data ? 'taken' : 'available');
      if (res.data) setFieldError('username', '该用户名已被占用，换一个试试');
    } catch {
      if (seq === usernameCheckSeq.current) setUsernameCheck('idle');
    }
  }

  // ---------- 动作 ----------

  async function handleSignIn() {
    if (busy) return;
    resetMessages();
    if (!validateSigninForm()) return;

    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.signInWithPassword({
        identifier: identifier.trim(),
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

  /**
   * 发送验证码（首次与「重新发送」共用）。
   * 注意：CloudBase 这一步**不校验用户名**，所以本地校验必须做足，
   * 否则「用户名不合规」会拖到用户填完验证码才报错。
   */
  async function handleSendCode(opts: { resend?: boolean } = {}) {
    if (busy) return;
    if (opts.resend && resendLeft > 0) return;
    resetMessages();

    if (!validateSignupForm()) {
      // 重发时字段已不可见，表单异常只能落到顶部横幅，否则用户看不到任何反馈
      if (opts.resend) {
        setError({ code: 'invalid_argument', message: '注册信息不完整', hint: '请返回上一步检查邮箱、用户名与密码' });
      }
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
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      setNowTick(Date.now());
      setOtp(Array<string>(CODE_LENGTH).fill(''));
      setPhase('code');
      setNotice(
        opts.resend
          ? `验证码已重新发送至 ${data.email}`
          : `验证码已发送至 ${data.email}，请查收（含垃圾邮件箱）`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (busy || !pendingId) return;
    resetMessages();
    clearFieldErrors('code');
    if (codeValue.length < CODE_LENGTH) {
      setFieldError('code', `请输入完整的 ${CODE_LENGTH} 位验证码`);
      return;
    }

    setBusy(true);
    try {
      const data = unwrap(await window.electronAPI.auth.cloud.verifySignUp({
        pendingId,
        code: codeValue,
      }));
      if (!data) return;
      setState(data);
      pendingSignUpCache = null;
      setPhase('form');
      setPendingId(null);
      setExpiresAt(null);
      setResendAt(null);
      setOtp(Array<string>(CODE_LENGTH).fill(''));
      setSignupPassword('');
      setConfirmPassword('');
      setFieldErrors({});
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

  // ---------- 验证码分格输入 ----------

  function writeOtp(index: number, digits: string) {
    setOtp((prev) => {
      const next = [...prev];
      for (let i = 0; i < digits.length && index + i < CODE_LENGTH; i += 1) {
        next[index + i] = digits[i];
      }
      return next;
    });
    clearFieldErrors('code');
  }

  function handleOtpChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    clearFieldErrors('code');
    if (!digits) {
      setOtp((prev) => {
        const next = [...prev];
        next[index] = '';
        return next;
      });
      return;
    }
    // 整段粘贴时会把后续格子一起填上
    writeOtp(index, digits);
    const focusAt = Math.min(index + digits.length, CODE_LENGTH - 1);
    otpRefs.current[focusAt]?.focus();
  }

  function handleOtpKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) {
      event.preventDefault();
      otpRefs.current[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) otpRefs.current[index + 1]?.focus();
    if (event.key === 'Enter') void handleVerify();
  }

  function handleOtpPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!digits) return;
    event.preventDefault();
    writeOtp(0, digits);
    otpRefs.current[Math.min(digits.length, CODE_LENGTH - 1)]?.focus();
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
  const otpComplete = codeValue.length === CODE_LENGTH;

  return (
    <div className="settings-section">
      <div className="settings-section__title">云账号</div>

      {notice && (
        <div className="cloud-note" role="status">
          <Icon name="check" size={14} />
          <span>{notice}</span>
        </div>
      )}

      {/* 顶部横幅只放「不指向具体字段」的系统级错误；能归因到字段的走各自 fields 的 inline 提示 */}
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-icon">
            <Icon name="alert" size={17} />
          </span>
          <div className="error-text">
            <div>{error.message}</div>
            {error.hint && <div className="cloud-error-hint">{error.hint}</div>}
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
          <div className="cloud-segmented" role="tablist" aria-label="云账号操作">
            <button
              className={`cloud-segmented__item${mode === 'signin' ? ' is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => switchMode('signin')}
            >
              登录
            </button>
            <button
              className={`cloud-segmented__item${mode === 'signup' ? ' is-active' : ''}`}
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
                  className={`account-input cloud-field__input${fieldErrors.identifier ? ' is-invalid' : ''}`}
                  type="text"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    clearFieldErrors('identifier');
                  }}
                  onBlur={() => blurField('identifier')}
                  placeholder="you@example.com"
                  autoComplete="username"
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.identifier)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSignIn();
                  }}
                />
                {fieldErrors.identifier && (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.identifier}</span>
                )}
              </label>

              <label className="cloud-field">
                <span className="cloud-field__label">密码</span>
                <span className="cloud-input-wrap">
                  <input
                    className={`account-input cloud-field__input${fieldErrors.signinPassword ? ' is-invalid' : ''}`}
                    type={showSigninPassword ? 'text' : 'password'}
                    value={signinPassword}
                    onChange={(e) => {
                      setSigninPassword(e.target.value);
                      clearFieldErrors('signinPassword');
                    }}
                    onBlur={() => blurField('signinPassword')}
                    autoComplete="current-password"
                    aria-invalid={Boolean(fieldErrors.signinPassword)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSignIn();
                    }}
                  />
                  <button
                    className="cloud-link"
                    type="button"
                    onClick={() => setShowSigninPassword((prev) => !prev)}
                    aria-label={showSigninPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showSigninPassword ? '隐藏' : '显示'}
                  </button>
                </span>
                {fieldErrors.signinPassword && (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.signinPassword}</span>
                )}
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
                  {busy ? '登录中…' : '登录'}
                </button>
              </div>
            </>
          ) : phase === 'form' ? (
            <>
              <div className="cloud-steps" aria-label="注册进度">
                <div className="cloud-step is-active">
                  <span className="cloud-step__index">1</span>
                  <span className="cloud-step__label">账号信息</span>
                </div>
                <span className="cloud-step__line" />
                <div className="cloud-step">
                  <span className="cloud-step__index">2</span>
                  <span className="cloud-step__label">邮箱验证</span>
                </div>
              </div>

              <label className="cloud-field">
                <span className="cloud-field__label">邮箱</span>
                <input
                  className={`account-input cloud-field__input${fieldErrors.email ? ' is-invalid' : ''}`}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearFieldErrors('email');
                  }}
                  onBlur={() => blurField('email')}
                  placeholder="you@example.com"
                  autoComplete="email"
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                {fieldErrors.email ? (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.email}</span>
                ) : (
                  <span className="cloud-field__msg cloud-field__msg--hint">
                    验证码将发送到该邮箱，请确认可正常收信
                  </span>
                )}
              </label>

              <label className="cloud-field">
                <span className="cloud-field__label">
                  用户名
                  <span className="cloud-field__optional">选填</span>
                </span>
                <span className="cloud-input-wrap">
                  <input
                    className={`account-input cloud-field__input${
                      fieldErrors.username
                        ? ' is-invalid'
                        : usernameCheck === 'available'
                          ? ' is-valid'
                          : ''
                    }`}
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setUsernameCheck('idle');
                      clearFieldErrors('username');
                    }}
                    onBlur={() => {
                      blurField('username');
                      void checkUsernameAvailability();
                    }}
                    placeholder="stellara_user"
                    autoComplete="username"
                    spellCheck={false}
                    aria-invalid={Boolean(fieldErrors.username)}
                  />
                  {usernameCheck === 'available' && !fieldErrors.username && (
                    <span className="cloud-field__badge cloud-field__badge--ok">可用</span>
                  )}
                </span>
                {fieldErrors.username ? (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.username}</span>
                ) : usernameCheck === 'checking' ? (
                  <span className="cloud-field__msg cloud-field__msg--hint">检查用户名是否可用…</span>
                ) : (
                  <span className="cloud-field__msg cloud-field__msg--hint">{USERNAME_HINT}</span>
                )}
              </label>

              <label className="cloud-field">
                <span className="cloud-field__label">
                  昵称
                  <span className="cloud-field__optional">选填</span>
                </span>
                <input
                  className="account-input cloud-field__input"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                  placeholder="显示在账号卡片上的名字"
                />
              </label>

              <label className="cloud-field">
                <span className="cloud-field__label">密码</span>
                <span className="cloud-input-wrap">
                  <input
                    className={`account-input cloud-field__input${fieldErrors.password ? ' is-invalid' : ''}`}
                    type={showSignupPassword ? 'text' : 'password'}
                    value={signupPassword}
                    onChange={(e) => {
                      setSignupPassword(e.target.value);
                      clearFieldErrors('password');
                    }}
                    onBlur={() => blurField('password')}
                    autoComplete="new-password"
                    aria-invalid={Boolean(fieldErrors.password)}
                  />
                  <button
                    className="cloud-link"
                    type="button"
                    onClick={() => setShowSignupPassword((prev) => !prev)}
                    aria-label={showSignupPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showSignupPassword ? '隐藏' : '显示'}
                  </button>
                </span>
                {passwordScore > 0 && (
                  <span className="cloud-strength">
                    {[1, 2, 3].map((level) => (
                      <span
                        key={level}
                        className={`cloud-strength__bar${level <= passwordScore ? ` is-on cloud-strength__bar--${passwordScore}` : ''}`}
                      />
                    ))}
                    <span className={`cloud-strength__label cloud-strength__label--${passwordScore}`}>
                      {passwordScore === 1 && signupPassword.length < MIN_PASSWORD_LENGTH
                        ? `至少 ${MIN_PASSWORD_LENGTH} 位`
                        : `强度${STRENGTH_LABEL[passwordScore as 1 | 2 | 3]}`}
                    </span>
                  </span>
                )}
                {fieldErrors.password ? (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.password}</span>
                ) : (
                  <span className="cloud-field__msg cloud-field__msg--hint">
                    至少 {MIN_PASSWORD_LENGTH} 位 · 建议含数字与大小写字母 · 不要与其他站点相同
                  </span>
                )}
              </label>

              <label className="cloud-field">
                <span className="cloud-field__label">确认密码</span>
                <input
                  className={`account-input cloud-field__input${fieldErrors.confirm ? ' is-invalid' : ''}`}
                  type={showSignupPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearFieldErrors('confirm');
                  }}
                  onBlur={() => blurField('confirm')}
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.confirm)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSendCode();
                  }}
                />
                {fieldErrors.confirm && (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.confirm}</span>
                )}
              </label>

              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    CloudBase 要求注册必须验证邮箱；点下一步会向该邮箱发送验证码。
                  </div>
                </div>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSendCode()}>
                  {busy ? '发送中…' : '发送验证码'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="cloud-steps" aria-label="注册进度">
                <div className="cloud-step is-done">
                  <span className="cloud-step__index">
                    <Icon name="check" size={12} />
                  </span>
                  <span className="cloud-step__label">账号信息</span>
                </div>
                <span className="cloud-step__line is-done" />
                <div className="cloud-step is-active">
                  <span className="cloud-step__index">2</span>
                  <span className="cloud-step__label">邮箱验证</span>
                </div>
              </div>

              <div className="cloud-recap">
                <div className="cloud-recap__grow">
                  <div className="cloud-recap__label">验证码已发送至</div>
                  <div className="cloud-recap__value">{email.trim()}</div>
                </div>
                <button className="cloud-link" type="button" disabled={busy} onClick={backToForm}>
                  修改
                </button>
              </div>

              <div className="cloud-field">
                <span className="cloud-field__row">
                  <span className="cloud-field__label">邮箱验证码</span>
                  <span className="cloud-field__counter">
                    {remaining ? `剩余 ${remaining}` : '验证码已过期'}
                  </span>
                </span>
                <div className="cloud-otp">
                  {otp.map((digit, index) => (
                    <input
                      // 位置即身份，索引做 key 是安全的
                      key={index}
                      ref={(el) => {
                        otpRefs.current[index] = el;
                      }}
                      className={`account-input cloud-otp__cell${fieldErrors.code ? ' is-invalid' : ''}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      maxLength={1}
                      value={digit}
                      aria-label={`验证码第 ${index + 1} 位`}
                      aria-invalid={Boolean(fieldErrors.code)}
                      disabled={busy}
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={handleOtpPaste}
                    />
                  ))}
                </div>
                {fieldErrors.code ? (
                  <span className="cloud-field__msg cloud-field__msg--error">{fieldErrors.code}</span>
                ) : (
                  <span className="cloud-field__msg cloud-field__msg--hint">
                    没收到？先看垃圾邮件箱，邮件可能延迟 1-2 分钟
                  </span>
                )}
                <span className="cloud-field__row cloud-field__row--end">
                  <button
                    className="cloud-link"
                    type="button"
                    disabled={busy || resendLeft > 0}
                    onClick={() => void handleSendCode({ resend: true })}
                  >
                    {resendLeft > 0 ? `重新发送 ${resendLeft}s` : '重新发送'}
                  </button>
                </span>
              </div>

              <div className="settings-item">
                <div className="settings-item__grow">
                  <div className="settings-item__hint">
                    注册成功后会自动登录，并把云账号绑定到当前本地身份。
                  </div>
                </div>
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={backToForm}>
                  返回
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy || !otpComplete || !pendingId || !remaining}
                  onClick={() => void handleVerify()}
                >
                  {busy ? '验证中…' : remaining ? '完成注册' : '验证码已过期'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
