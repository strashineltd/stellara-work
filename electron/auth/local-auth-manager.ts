import {
  clearActiveLocalUser,
  createLocalUser,
  getCurrentLocalUser,
  getLocalUser,
  listLocalUsers,
  switchLocalUser,
  updateLocalUser,
  type LocalUser,
  type LocalUserPatch,
} from '../store/local-users';
import type { LocalIdentity } from '../../shared/ipc';

/**
 * 本地认证协调器（主进程）
 *
 * 职责：给 IPC 层提供稳定的"当前身份 / 列表 / 改名 / 新建 / 切换"入口。
 *
 * 为什么单独一层：
 * - 渲染层只认识 LocalUser，不感知底层是 SQLite 还是未来的云账号绑定
 * - Phase 3 接入 CloudBase 后，云账号绑定（cloud_links）挂在这一层，
 *   渲染层的 auth.local.* 调用签名保持不变
 *
 * 安全：本层不接触任何密钥；未来云 token 继续走 config/secrets（OS keychain）。
 */

/** 取当前身份；未初始化时抛错（initLocalUsers 已在启动时兜底创建） */
function requireCurrent(): LocalUser {
  const user = getCurrentLocalUser();
  if (!user) throw new Error('本地用户未初始化，请先调用 initLocalUsers()');
  return user;
}

/** 虚拟「本地默认」档：固定 id，不写入 local_users，不可删除/重命名（H10） */
export const DEFAULT_USER_ID = 'default';

/** 「本地默认」档显示名 */
export const DEFAULT_IDENTITY_NAME = '本地默认';

/** 活动身份 id：未激活任何本地用户时返回默认档 */
export function getActiveUserId(): string {
  return getCurrentLocalUser()?.id ?? DEFAULT_USER_ID;
}

/** 身份列表：默认档固定排第一，随后按创建时间升序的本地用户 */
export function listIdentities(): LocalIdentity[] {
  return [
    { id: DEFAULT_USER_ID, name: DEFAULT_IDENTITY_NAME, kind: 'default' },
    ...listLocalUsers().map((user): LocalIdentity => ({
      id: user.id,
      name: user.displayName,
      kind: 'user',
    })),
  ];
}

/** 按 id 取身份条目；未知 id 抛「用户不存在」（与 setActiveUserId 同一校验口径） */
export function getIdentity(id: string): LocalIdentity {
  const identity = listIdentities().find((item) => item.id === id);
  if (!identity) throw new Error(`用户不存在: ${id}`);
  return identity;
}

/**
 * 当前活动身份条目；没有活动用户（或用户行已消失）时返回默认档。
 * `identity:getCurrent` 契约要求永不抛错。
 */
export function getCurrentIdentity(): LocalIdentity {
  return (
    listIdentities().find((item) => item.id === getActiveUserId()) ?? {
      id: DEFAULT_USER_ID,
      name: DEFAULT_IDENTITY_NAME,
      kind: 'default',
    }
  );
}

/**
 * 设置活动身份。
 *
 * - `'default'` → 清空活动用户，回到默认档
 * - 已存在的本地用户 id → 切换过去
 * - 其他 → 抛 `用户不存在`，且不改变原活动身份
 */
export function setActiveUserId(id: string): void {
  if (id === DEFAULT_USER_ID) {
    clearActiveLocalUser();
    return;
  }
  if (!getLocalUser(id)) throw new Error(`用户不存在: ${id}`);
  switchLocalUser(id);
}

export const localAuth = {
  getCurrent(): LocalUser {
    return requireCurrent();
  },

  list(): LocalUser[] {
    return listLocalUsers();
  },

  /** 身份列表（含默认档），供账号 UI / identity IPC 使用 */
  listIdentities,

  create(displayName?: string): LocalUser {
    return createLocalUser(displayName);
  },

  /** 更新当前身份（渲染层不需要传 id，避免越权改别的用户） */
  update(patch: LocalUserPatch): LocalUser {
    return updateLocalUser(requireCurrent().id, patch);
  },

  /**
   * 切换活动身份；`'default'` 切回默认档并返回 null。
   * 未知 id 抛 `用户不存在`（与 setActiveUserId 同一校验）。
   */
  switch(id: string): LocalUser | null {
    setActiveUserId(id);
    return getCurrentLocalUser();
  },
};
