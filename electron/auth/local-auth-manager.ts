import {
  createLocalUser,
  getCurrentLocalUser,
  listLocalUsers,
  switchLocalUser,
  updateLocalUser,
  type LocalUser,
  type LocalUserPatch,
} from '../store/local-users';

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

export const localAuth = {
  getCurrent(): LocalUser {
    return requireCurrent();
  },

  list(): LocalUser[] {
    return listLocalUsers();
  },

  create(displayName?: string): LocalUser {
    return createLocalUser(displayName);
  },

  /** 更新当前身份（渲染层不需要传 id，避免越权改别的用户） */
  update(patch: LocalUserPatch): LocalUser {
    return updateLocalUser(requireCurrent().id, patch);
  },

  switch(id: string): LocalUser {
    return switchLocalUser(id);
  },
};
