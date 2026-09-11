export type AppSection = 'home' | 'tasks' | 'memory' | 'files' | 'pull-requests' | 'scheduled';

export interface NavState {
  section: AppSection;
  sessionId: string | null;
}

export const INITIAL_NAV: NavState = { section: 'home', sessionId: null };

export type ApprovalMode = 'auto' | 'step' | 'plan';

/** 新会话执行端：本地或某台已配置服务器 */
export type ExecutionTarget = { kind: 'local' } | { kind: 'server'; serverId: string };
