import type { IdentitySwitchResult, LocalIdentity } from '../shared/ipc';
import { DEFAULT_USER_ID } from './auth/local-auth-manager';

/**
 * H10 身份切换语义（从 main.ts 提取，便于单测）。
 *
 * - 有运行中任务且未 force → 返回 busy，不做任何变更；
 * - force 或空闲 → 校验并设置目标身份（未知 id 抛「用户不存在」），
 *   执行云会话一致性守卫，最后广播 `identity-changed`。
 */
export interface IdentitySwitchDeps {
  /** 运行中的聊天流数量（chatStreams 活动集合） */
  activeStreamCount: () => number;
  /** 校验并设置活动身份，返回新身份条目；未知 id 抛「用户不存在」 */
  setActive: (userId: string) => LocalIdentity;
  /** 云会话一致性守卫（不匹配时清理云会话并广播账号状态） */
  guardCloud: (activeUserId: string) => void | Promise<void>;
  /** 广播 `identity-changed`（payload 为新身份） */
  broadcast: (user: LocalIdentity) => void;
}

export async function switchIdentity(
  deps: IdentitySwitchDeps,
  userId: string,
  force = false,
): Promise<IdentitySwitchResult> {
  if (!force) {
    const count = deps.activeStreamCount();
    if (count > 0) return { ok: false, busy: true, count };
  }

  const user = deps.setActive(userId);
  await deps.guardCloud(user.id);
  deps.broadcast(user);
  return { ok: true, user };
}

export interface IdentityBackfillDeps {
  getActiveUserId: () => string;
  migrate: (userId: string) => number;
}

/**
 * R2：启动时一次性回填历史 `default` 数据到活动身份。
 * 仅当活动身份是真实用户时执行 —— 默认档的数据保持归属默认档，
 * 之后切换身份不会重新回填（switchIdentity 不触碰迁移）。
 */
export function backfillIdentityOwnership(deps: IdentityBackfillDeps): number {
  const activeId = deps.getActiveUserId();
  if (activeId === DEFAULT_USER_ID) return 0;
  return deps.migrate(activeId);
}
