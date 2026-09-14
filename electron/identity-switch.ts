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
  try {
    await deps.guardCloud(user.id);
  } catch (e) {
    // 云会话守卫失败不阻塞切换：身份已生效，必须广播保持一致
    console.error('Cloud identity guard failed:', e);
  }
  deps.broadcast(user);
  return { ok: true, user };
}

export interface IdentityBackfillDeps {
  getActiveUserId: () => string;
  migrate: (userId: string) => number;
  /** 「迁移已评估一次」标记是否已落（持久化在 db，跨重启生效） */
  isDone: () => boolean;
  /** 迁移评估完成后写入一次性标记（无论本次是否真的迁移了数据） */
  markDone: () => void;
}

/**
 * R2：启动时一次性回填历史 `default` 数据到活动身份。
 *
 * 标记语义是「迁移已评估一次」，不是「迁移发生过」：
 * - 首次启动后一律落标记（活动身份是默认档也落，因为迁移时刻已经过去）；
 * - 仅当活动身份是真实用户时才把历史 `default` 行迁过去；
 * - 否则保持默认档归属（spec §3：迁移时已有用户则归活动用户，否则归默认）。
 *
 * 若默认档不落标记，用户「先在默认档用到 H10 之后、再创建身份重启」时，
 * 这些新数据会被误划给新身份 —— 因此标记必须与是否迁移解耦。
 */
export function backfillIdentityOwnership(deps: IdentityBackfillDeps): number {
  if (deps.isDone()) return 0;
  const activeId = deps.getActiveUserId();
  const migrated = activeId === DEFAULT_USER_ID ? 0 : deps.migrate(activeId);
  deps.markDone();
  return migrated;
}
