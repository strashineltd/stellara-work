// electron/browser/tabs.ts
export interface Tab { id: string; url: string; title: string; sessionId: string; updatedAt: number; }
export class TabPool {
  private tabs = new Map<string, Tab[]>();
  constructor(private max = 5) {}
  list(sessionId: string): Tab[] { return [...(this.tabs.get(sessionId) ?? [])]; }
  create(sessionId: string, url: string): { tab: Tab; evicted?: Tab } {
    const arr = this.tabs.get(sessionId) ?? [];
    const tab: Tab = { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url, title: url, sessionId, updatedAt: Date.now() };
    arr.push(tab);
    let evicted: Tab | undefined;
    while (arr.length > this.max) {
      evicted = arr.shift();
    }
    this.tabs.set(sessionId, arr);
    return { tab, evicted };
  }
  close(sessionId: string, id: string): void {
    this.tabs.set(sessionId, (this.tabs.get(sessionId) ?? []).filter(t => t.id !== id));
  }
  select(sessionId: string, id: string): Tab {
    const t = (this.tabs.get(sessionId) ?? []).find(x => x.id === id);
    if (!t) throw new Error(`Tab 不存在: ${id}`);
    t.updatedAt = Date.now();
    return t;
  }
}
