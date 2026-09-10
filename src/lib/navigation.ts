export type AppSection = 'home' | 'tasks' | 'memory' | 'files' | 'pull-requests' | 'scheduled';

export interface NavState {
  section: AppSection;
  sessionId: string | null;
}

export const INITIAL_NAV: NavState = { section: 'home', sessionId: null };

export type ApprovalMode = 'auto' | 'step' | 'plan';
