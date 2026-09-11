import { randomUUID } from 'node:crypto';
import log from 'electron-log/main';
import type {
  CloudAccount,
  CloudAuthState,
  CloudPendingSignUp,
  CloudResult,
  CloudSignUpArgs,
} from '../../shared/ipc';
import {
  describeCloudError,
  getCloudAuth,
  isCloudConfigured,
  resetCloudClient,
} from '../cloud/cloudbase-client';
import { deleteCloudSecret, getCloudSecret, setCloudSecret } from '../config/secrets';
import { deleteLinkForLocalUser, getLinkForLocalUser, upsertCloudLink, type CloudLink } from '../store/cloud-links';
import { getCurrentLocalUser } from '../store/local-users';
import { toCloudAccount, type RawCloudUser } from './cloud-user';

/**
 * 云账号协调器（主进程）
 *
 * 职责：把 CloudBase SDK 的认证能力包成渲染层可用的稳定契约。
 *
 * 与 localAuth 的关系：
 * - localAuth 管「本机身份」，永远可用，不依赖网络
 * - cloudAuth 管「云账号」，可选；云账号**绑定到当前本地身份**（cloud_links 表）
 *
 * 安全：
 * - access/refresh token 只在本进程内流转，经 secrets.ts 加密落盘
 * - 任何情况下都不把 token 通过 IPC 交给渲染进程
 *
 * 会话恢复：
 * - 启动时若本地存有 token，用 setSession 恢复；失败则清空（静默降级为未登录）
 */

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';

/** 注册会话暂存有效期（验证码 10 分钟过期，略短一点保守处理） */
const PENDING_TTL_MS = 9 * 60 * 1000;

type VerifyOtpFn = (params: { token: string | number; messageId?: string }) => Promise<unknown>;

interface PendingSignUp {
  verifyOtp: VerifyOtpFn;
  email: string;
  createdAt: number;
}

/** 待校验的注册会话（SDK 的 verifyOtp 是函数，无法跨 IPC，只能主进程暂存） */
const pendingSignUps = new Map<string, PendingSignUp>();

function sweepPending(): void {
  const now = Date.now();
  for (const [id, item] of pendingSignUps) {
    if (now - item.createdAt > PENDING_TTL_MS) pendingSignUps.delete(id);
  }
}

/** SDK 抛错时统一包成 CloudResult */
function fail(err: unknown): { ok: false; error: ReturnType<typeof describeCloudError> } {
  if (!(err instanceof Error) || err.name !== 'CloudNotConfiguredError') {
    log.warn('cloudAuth 操作失败', err);
  }
  return { ok: false, error: describeCloudError(err) };
}

/**
 * 尽力从 SDK 响应里取出账号信息。
 *
 * 三层兜底（顺序有意义）：
 * 1. `data.user` —— 多数接口直接回
 * 2. `data.session.user` —— SDK 的 getSession() 会把 user 一并塞进 session
 * 3. 再调一次 `getUser()` —— 上面的都没有时
 *
 * 注意字段形态由 `toCloudAccount` 负责归一化（SDK v3 返回 Supabase 形状，
 * 顶层没有 uid/username/name），这里不要自己读 user 的字段。
 */
async function resolveAccount(
  data: { user?: unknown; session?: unknown } | null | undefined,
  fallbackToGetUser = true,
): Promise<CloudAccount | null> {
  const session = data?.session as { user?: unknown } | null | undefined;

  const account =
    toCloudAccount(data?.user as RawCloudUser | null | undefined) ??
    toCloudAccount(session?.user as RawCloudUser | null | undefined);
  if (account || !fallbackToGetUser) return account;

  const got = await getCloudAuth().getUser();
  return got.error ? null : toCloudAccount(got.data?.user as RawCloudUser | null | undefined);
}

/** CloudLink → 渲染层可见的账号元数据 */
function linkToAccount(link: CloudLink | null): CloudAccount | null {
  if (!link) return null;
  return {
    uid: link.cloudUid,
    email: link.email,
    username: link.username,
    displayName: link.displayName,
    phone: link.phone,
  };
}

/** 持久化会话 token（加密落盘） */
async function persistSession(session: { access_token?: string; refresh_token?: string } | null | undefined): Promise<void> {
  if (!session?.access_token || !session.refresh_token) return;
  await setCloudSecret(ACCESS_TOKEN_KEY, session.access_token);
  await setCloudSecret(REFRESH_TOKEN_KEY, session.refresh_token);
}

async function clearSession(): Promise<void> {
  await deleteCloudSecret(ACCESS_TOKEN_KEY);
  await deleteCloudSecret(REFRESH_TOKEN_KEY);
}

/** 当前本地身份（绑定操作的主体） */
function requireLocalUserId(): string {
  const user = getCurrentLocalUser();
  if (!user) throw new Error('本地用户未初始化，请先调用 initLocalUsers()');
  return user.id;
}

/** 登录成功后的统一收尾：落盘 token + 写绑定表 */
async function onAuthenticated(
  account: CloudAccount,
  session: { access_token?: string; refresh_token?: string } | null | undefined,
): Promise<void> {
  await persistSession(session);
  upsertCloudLink({
    localUserId: requireLocalUserId(),
    cloudUid: account.uid,
    email: account.email,
    username: account.username,
    displayName: account.displayName,
    phone: account.phone,
  });
}

/** 组装对外状态 */
function buildState(): CloudAuthState {
  const configured = isCloudConfigured();
  let linked: CloudLink | null = null;
  try {
    linked = getLinkForLocalUser(requireLocalUserId());
  } catch {
    // 本地用户表尚未初始化（极早期调用）—— 视为未绑定
    linked = null;
  }

  const hasToken = configured && getCloudSecret(REFRESH_TOKEN_KEY) !== null;

  return {
    configured,
    signedIn: hasToken,
    account: linkToAccount(linked),
  };
}

export const cloudAuth = {
  getState(): CloudAuthState {
    return buildState();
  },

  /**
   * 注册第一步：向邮箱发送验证码。
   * 同时把 SDK 返回的 verifyOtp 回调暂存到主进程，用 pendingId 引用。
   */
  async sendSignUpCode(args: CloudSignUpArgs): Promise<CloudResult<CloudPendingSignUp>> {
    const email = args.email.trim();
    if (!email) return { ok: false, error: { code: 'invalid_argument', message: '请填写邮箱', hint: '' } };
    if (!args.password) return { ok: false, error: { code: 'invalid_argument', message: '请设置密码', hint: '密码用于后续登录' } };

    try {
      sweepPending();
      const auth = getCloudAuth();
      const res = await auth.signUp({
        email,
        password: args.password,
        username: args.username?.trim() || undefined,
        name: args.displayName?.trim() || undefined,
      });

      if (res.error) return { ok: false, error: describeCloudError(res.error) };

      const verifyOtp = res.data?.verifyOtp;
      if (typeof verifyOtp !== 'function') {
        // 极少见：邮箱已注册且无需验证码时 SDK 可能直接返回会话
        const account = await resolveAccount(res.data);
        const session = res.data?.session;
        if (account) {
          await onAuthenticated(account, session);
          return {
            ok: true,
            data: { pendingId: '', email },
          };
        }
        log.warn('signUp 未返回 verifyOtp 回调，且无 user/session');
        return {
          ok: false,
          error: { code: 'unknown', message: '未收到验证码回调', hint: '请稍后重试，或改用「直接登录」' },
        };
      }

      const pendingId = randomUUID();
      // ⚠️ 必须以成员调用的形式持有该回调：SDK 的 verifyOtp 可能是绑定 this 的普通方法，
      //    先解构再单独调用会丢失 this，导致回调内部取不到上下文。
      const callVerifyOtp: VerifyOtpFn = (params) =>
        (res.data.verifyOtp as VerifyOtpFn)(params);
      pendingSignUps.set(pendingId, { verifyOtp: callVerifyOtp, email, createdAt: Date.now() });
      log.info(`云注册验证码已发送: ${email}（pendingId=${pendingId}）`);
      return { ok: true, data: { pendingId, email } };
    } catch (err) {
      return fail(err);
    }
  },

  /** 注册第二步：校验验证码，完成后 SDK 自动登录 */
  async verifySignUp(args: { pendingId: string; code: string }): Promise<CloudResult<CloudAuthState>> {
    const code = args.code.trim();
    if (!code) {
      return {
        ok: false,
        error: { code: 'invalid_argument', message: '请填写验证码', hint: '验证码在邮件正文里，通常是 6 位数字' },
      };
    }
    if (!args.pendingId) {
      log.warn('verifySignUp 收到空 pendingId');
      return {
        ok: false,
        error: {
          code: 'invalid_argument',
          message: '没有进行中的注册会话',
          hint: '请返回注册表单，重新点击「获取验证码」',
        },
      };
    }

    const pending = pendingSignUps.get(args.pendingId);
    if (!pending) {
      // 最常见原因：发码后应用重启（会话暂存在内存），或停留超过 9 分钟
      log.warn(`verifySignUp 找不到注册会话: pendingId=${args.pendingId}`);
      return {
        ok: false,
        error: {
          code: 'invalid_argument',
          message: '注册会话已失效',
          hint: '应用重启或停留过久会导致会话丢失。请返回注册表单重新点击「获取验证码」，并尽快填入新收到的验证码',
        },
      };
    }

    try {
      const res = (await pending.verifyOtp({ token: code })) as {
        data?: { user?: unknown; session?: unknown };
        error?: unknown;
      };
      if (res.error) {
        log.warn(`verifySignUp 校验被拒绝: ${JSON.stringify(res.error).slice(0, 300)}`);
        return { ok: false, error: describeCloudError(res.error) };
      }

      pendingSignUps.delete(args.pendingId);

      const session = res.data?.session as { access_token?: string; refresh_token?: string } | null | undefined;
      // 回调可能只回会话不回 user —— resolveAccount 内含 session.user 与 getUser() 两层兜底
      const account = await resolveAccount(res.data);
      if (!account) {
        return { ok: false, error: { code: 'unknown', message: '注册成功但未取到用户信息', hint: '请尝试直接登录' } };
      }

      await onAuthenticated(account, session);
      log.info(`云账号注册并绑定成功: ${account.email ?? account.uid}`);
      return { ok: true, data: buildState() };
    } catch (err) {
      return fail(err);
    }
  },

  /** 标识符 → SDK 入参（含 @ 视为邮箱，否则视为用户名） */
  async signInWithPassword(args: { identifier: string; password: string }): Promise<CloudResult<CloudAuthState>> {
    const identifier = args.identifier.trim();
    if (!identifier) return { ok: false, error: { code: 'invalid_argument', message: '请填写邮箱或用户名', hint: '' } };
    if (!args.password) return { ok: false, error: { code: 'invalid_argument', message: '请填写密码', hint: '' } };

    try {
      const auth = getCloudAuth();
      const params = identifier.includes('@')
        ? { email: identifier, password: args.password }
        : { username: identifier, password: args.password };

      const res = await auth.signInWithPassword(params);
      if (res.error) return { ok: false, error: describeCloudError(res.error) };

      const account = await resolveAccount(res.data);
      if (!account) {
        return { ok: false, error: { code: 'unknown', message: '登录成功但未取到用户信息', hint: '请重试' } };
      }

      await onAuthenticated(account, res.data?.session as never);
      log.info(`云账号登录成功: ${account.email ?? account.username ?? account.uid}`);
      return { ok: true, data: buildState() };
    } catch (err) {
      return fail(err);
    }
  },

  /** 登出：清会话，但**保留绑定**（下次可用同一账号登录） */
  async signOut(): Promise<CloudResult<CloudAuthState>> {
    try {
      await getCloudAuth().signOut();
    } catch (err) {
      // 网络失败也要把本地会话清干净，否则用户无法切账号
      log.warn('云账号 signOut 调用失败，仍清除本地会话', err);
    }
    await clearSession();
    resetCloudClient();
    return { ok: true, data: buildState() };
  },

  /** 解绑：清会话 + 删绑定（local-first：本地身份与数据不受影响） */
  async unlink(): Promise<CloudResult<CloudAuthState>> {
    try {
      await getCloudAuth().signOut();
    } catch {
      // 忽略：解绑以本地状态为准
    }
    await clearSession();
    resetCloudClient();
    deleteLinkForLocalUser(requireLocalUserId());
    log.info('云账号已解绑');
    return { ok: true, data: buildState() };
  },

  /** 用户名占用预检 */
  async isUsernameRegistered(username: string): Promise<CloudResult<boolean>> {
    const name = username.trim();
    if (!name) return { ok: false, error: { code: 'invalid_argument', message: '请填写用户名', hint: '' } };
    try {
      const registered = await getCloudAuth().isUsernameRegistered(name);
      return { ok: true, data: registered };
    } catch (err) {
      return fail(err);
    }
  },

  /**
   * 启动时恢复会话：本地有 refresh_token 就 setSession 试一次。
   * 失败（过期 / 被吊销 / 网络不可用）一律静默降级为未登录，绝不阻塞启动。
   */
  async restoreSession(): Promise<void> {
    if (!isCloudConfigured()) return;
    const accessToken = getCloudSecret(ACCESS_TOKEN_KEY);
    const refreshToken = getCloudSecret(REFRESH_TOKEN_KEY);
    if (!accessToken || !refreshToken) return;

    try {
      const auth = getCloudAuth();
      const res = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (res.error) throw res.error;

      // setSession 可能只回会话，resolveAccount 会补一次 user 用于刷新绑定元数据
      const account = await resolveAccount(res.data);

      if (!account) throw new Error('会话恢复后未取到用户信息');

      await onAuthenticated(account, res.data?.session as never);
      log.info(`云账号会话已恢复: ${account.email ?? account.uid}`);
    } catch (err) {
      log.warn('云账号会话恢复失败，已登出', err);
      await clearSession();
      resetCloudClient();
    }
  },

  /** 清空数据 / 切换本地身份时的内部清理（不触碰绑定表） */
  async dropSession(): Promise<void> {
    await clearSession();
    resetCloudClient();
  },
};
